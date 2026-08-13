# 9. Troubleshooting

A short list of "I hit X, what do I do?" answers. Roughly ordered by
how often they come up.

---

## 9.1 The website is slow

Most likely cause: **photo payloads in list endpoints**. This was the
biggest bug pre-fix. Confirm:

```bash
curl -s "http://localhost:8000/api/alerts/nearby?lat=30.73&lng=76.78" | wc -c
```

If the response is multi-MB, photos are leaking through. Fix:
- The list response should never contain a `photos` array.
- Check `_LIST_PROJECTION` in `routes/alerts.py` — should be
  `{"photos": 0, "photo_checks": 0, "flagged_by": 0, "witnessed_by": 0}`.

Other slow-page suspects:

- Background polling running while the tab is hidden — should be
  gated by `document.visibilityState === 'hidden'` (Home.jsx,
  MapDashboard.jsx).
- WebSocket reconnecting on every GPS tick — confirm
  `useWebSocket.js` only depends on `[token]` for the connect effect,
  with a separate effect that pushes coord updates over the open
  socket.
- Photo decode on a slow phone — already capped to `MAX_EDGE = 1280`
  in `utils/photo.js`. Lower if your audience is on $80 Android phones.

---

## 9.2 GitHub Actions is failing

Check `.github/workflows/ci.yml`. Common failures:

| Symptom | Fix |
|---|---|
| `Missing script: "test"` | `frontend/package.json` doesn't have the `test` script. Add it. |
| `Could not find a version that satisfies pytest-asyncio` | Pin a version compatible with the matrix Python version. 0.23+ supports 3.11/3.12. |
| `pip-audit` red despite `continue-on-error` | The job-level flag only blocks dependents. Append `\|\| true` to the step. |
| `npm ci` fails with `EUSAGE` | `package.json` and `package-lock.json` are out of sync. Run `npm install` locally and commit the lockfile. |
| `ruff check` red on a new file | The file has an actual syntax error. Run `ruff check app` locally. |

Local simulation:

```bash
# backend
cd backend && pytest tests/ --cov=app

# frontend
cd frontend && npm ci && npm run lint && npm test && npm run build
```

If those four pass, CI will pass.

---

## 9.3 The map shows blank tiles

OpenStreetMap occasionally throttles bursty requests. `MapView.jsx`
uses `https://{s}.tile.openstreetmap.org/...` which round-robins
across `a/b/c.tile.openstreetmap.org`. If you're showing the map to
many users at once, you'll start seeing rate-limited tiles.

**Fix:** swap to a free alternative:
- [Stamen / Stadia tiles](https://docs.stadiamaps.com/) — free for low traffic.
- [Mapbox raster tiles](https://docs.mapbox.com/) — free up to 50k tile loads/month, needs an API key.
- Self-host with [`tilemaker` + nginx](https://github.com/systemed/tilemaker).

The change is one line in `MapView.jsx`'s `<TileLayer url=...>` prop.

---

## 9.4 Notifications don't fire

Mobile-specific landmines first:

- **iOS Safari:** native web notifications require iOS 16.4+ AND the
  PWA must be installed via **Share → Add to Home Screen**. From a
  regular Safari tab they will not fire.
- **Android Chrome:** notifications work from a tab, but the user
  must explicitly grant permission. The "Enable" banner in
  VolunteerFeed triggers `Notification.requestPermission()`.

Diagnostics:

```js
// Run in DevTools console on the page:
console.log('permission:', Notification.permission)
console.log('SW:', await navigator.serviceWorker.getRegistration())
```

Both should return `granted` and a registration object. If the SW is
missing, check `main.jsx` is calling `navigator.serviceWorker.register`.

For TTS specifically (`useVoiceAlert`):
- Some browsers require a user gesture before `speechSynthesis.speak`
  fires. The first time the user toggles "Voice alerts on" counts.
- iOS Safari often has no `hi-IN` / `pa-IN` voice installed — TTS
  falls back to a default voice silently.

---

## 9.5 WebSocket disconnects every few seconds

Common causes:

1. **Behind a reverse proxy with idle timeout.** nginx defaults to 60 s
   `proxy_read_timeout` — the WS will get killed. Bump it:
   ```nginx
   location /ws/ {
     proxy_read_timeout 3600s;
     proxy_pass http://backend:8000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
   }
   ```
2. **Render free tier sleeping.** Set up a `/health` ping every 10
   minutes via cron-job.org.
3. **Frontend reconnecting itself.** `useWebSocket.js` has a 3 s
   backoff on unexpected close. If you see reconnects in DevTools'
   Network tab every ~3 s, it's the backend dropping the socket —
   check Render logs for an exception in the WS handler.

---

## 9.6 Backend test failures after `git pull`

Three things to try in order:

1. `pip install -r backend/requirements.txt` — a new dep may have
   been added.
2. `mongosh "..." --eval "db.dropDatabase()"` — your local DB may
   have docs in a shape the new code doesn't expect.
3. `pip install --upgrade pytest pytest-asyncio` — `pytest-asyncio`
   has had several breaking changes; if you're stuck on an older
   version you'll see weird `RuntimeWarning: coroutine ... was never
   awaited` errors.

---

## 9.7 Frontend won't build: "Could not resolve X"

Almost always means a file was deleted or renamed but its import
wasn't updated. Run:

```bash
npm run lint
```

ESLint catches almost all of these. If the build still fails after
lint passes:

```bash
npm ci          # nuke node_modules and reinstall from lockfile
```

If `npm ci` itself fails — the lockfile is out of date relative to
`package.json`. Re-sync:

```bash
rm package-lock.json
npm install
git add package-lock.json
```

---

## 9.8 `verified_score` looks wrong

Walk through `services/verification.py::compute_verified_score`:

- Witnesses contribute up to 40 (capped at 5 unique witnesses × 8).
- Corroboration up to 40 (per-event +15, capped).
- Weather match adds exactly 20.
- Photo evidence adds up to 30 (added separately in
  `routes/alerts.py::create_alert`).
- Total clamped to 100.

If a score seems off, check if the alert document was written before
the photo system landed (`photo_evidence_score` will be 0).

---

## 9.9 An anonymous report keeps getting blocked

`POST /api/alerts/anonymous` is rate-limited to 10/hour per source IP.

- During testing, use `RateLimiter.reset()` (only available from
  Python; expose a debug endpoint if you really need it).
- `_client_ip()` honours the first `X-Forwarded-For` header so a
  proxy NAT translation will all share the same bucket — that's
  intentional, but it means a community computer in a cyber café
  caps at 10/hour combined.

---

## 9.10 Triage looks less accurate than expected

There is no model to run out of memory any more — classification is a local
keyword + pattern matcher (`app/services/vocab.py`) costing ~0.05 ms and no
RAM. If urgency looks wrong:

1. Reproduce it against the labelled set:

   ```bash
   cd backend && python -m tests.eval_triage
   ```

   It prints per-language accuracy and every miss, marking whether each was
   **under-ranked** (dangerous — shown below genuinely less urgent alerts) or
   over-ranked.

2. If the report's danger is *described but never named* — "won't answer",
   "bol nahi rahe" — that belongs in `CRITICAL_PATTERNS`, not the keyword
   lists.

3. Do **not** fix a miss by pasting its exact words into `vocab.py`. That is
   memorising the test: the score rises and the classifier gets no better on
   the next report. Add the underlying concept in every language, or record
   it as a known limit.

Current baseline: **90%** overall, CRITICAL 17/17, 2 under-ranked.


## 9.11 Real GPS shows the wrong city

The default fallback center is **Chandigarh** (`[30.7333, 76.7794]`).
If geolocation is denied or the request times out, the user sees
the map there.

- Check if `navigator.geolocation` is denied — Chrome blocks HTTP
  origins from prompting (HTTPS only). Localhost is exempt.
- The fallback is in `MapDashboard.jsx`, `Home.jsx`, etc. Override
  there if you want a different default.

---

## 9.12 Translations don't apply

Two layers to debug:

1. **Static UI strings** (`t('nav_map')`):
   - Open `frontend/src/utils/i18n.jsx`.
   - Confirm the key is present in *all three* language objects.
   - Check the active language: `localStorage.getItem('lang')`.

2. **Auto-translation of user content** (`<TranslatableText>`):
   - The Google `translate_a/single` endpoint is sometimes blocked
     by corporate firewalls. The fallback returns the original text
     silently.
   - Open DevTools → Network tab and look for failing
     `translate.googleapis.com` requests.
   - Workaround: disable auto-translate via the i18n preference.

---

## 9.13 Backend crashes at startup with `No default database name defined or provided`

Your `MONGO_URL` connection string is missing the database segment.
Atlas's "Connect" wizard hands you a URL of the form:

```
mongodb+srv://user:pass@cluster.xxx.mongodb.net/?retryWrites=true&w=majority
                                                ^ no /dbname here
```

Without a database name in the path, `get_default_database()` raises
`ConfigurationError`.

**Quick fix.** Add `/neighbouraid` before the `?`:

```
mongodb+srv://user:pass@cluster.xxx.mongodb.net/neighbouraid?retryWrites=true&w=majority
```

Save the env var; the host (HF Spaces / Render / etc.) restarts the
container automatically.

The code also has a defensive fallback: if `get_default_database()`
raises, `app/db/client.py` falls back to a database literally named
`neighbouraid`. Either form of the connection string works after
that fix landed.

---

## 9.14 Render redeploy ran but I'm still seeing old code

Vercel and Render deploy independently. If you only changed the
frontend, you don't need a Render redeploy — Vercel handles it. But
the **frontend build is cached aggressively** by the Service Worker:
on first load after deploy, users may see the old shell.

The SW handles this automatically:
- `CACHE = 'neighbouraid-v2'` in `service-worker.js`. Bumping the
  string busts the cache.
- The activate handler drops old caches.
- Vite emits hashed asset filenames, so even cached HTML pulls fresh
  CSS/JS.

If users report stale UI, ask them to **fully close** the tab (not
just refresh) or clear site data once. After that, the new SW takes
over silently.
