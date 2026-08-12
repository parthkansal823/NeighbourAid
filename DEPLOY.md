# Deploying NeighbourAid

Everything here is free. No credit card, no paid tier, no API key anywhere.

| Piece | Host | Cost |
|---|---|---|
| Backend (FastAPI + WebSockets) | Hugging Face Space, **Gradio** SDK | Free |
| Database | MongoDB Atlas M0, Mumbai (`ap-south-1`) | Free |
| Frontend (React SPA) | Cloudflare Workers (static assets) | Free |
| Uptime + keep-warm | UptimeRobot → `/health/ready` | Free |
| Triage | Multilingual keyword classifier, in-process | Free |

**Order matters.** The database URL is needed to configure the backend, and
the backend URL is needed to build the frontend. Going 1 → 5 avoids
redeploying twice.

---

## Two things that decide the whole design

**1. The backend needs one long-lived process, and exactly one.**

`app/services/websocket.py` keeps connected volunteers in a plain in-process
dict. So:

- **No serverless.** Vercel/Netlify Functions, Lambda and Cloudflare Workers
  are all out for the backend — it must hold WebSocket connections open.
- **No second worker.** A second worker owns a second, invisible half of the
  volunteer pool, and an alert reaches only whoever shares its process.
  `deploy/huggingface/gradio/app.py` passes `workers=1` for this reason.

That is a ceiling, not a design. Moving the registry behind Redis pub/sub is
what unlocks scaling, and it is much easier to do before you have traffic.

**2. Gradio, not Docker.**

Docker Spaces are a paid feature on some Hugging Face accounts; **Gradio and
Static are free**. A Gradio Space simply runs `app.py` and proxies port 7860
— it never checks that what you started is actually Gradio, so it serves
FastAPI perfectly well. Verified in a container: `/health`, `/health/ready`,
`/docs` and `/api/...` all respond, at ~150 MB.

Docker files remain in `deploy/huggingface/` if your account has Docker
Spaces; they are the cleaner option when available.

---

## 1. Database — MongoDB Atlas

1. Create a free **M0** cluster in **Mumbai / `ap-south-1`**. Several database
   round trips happen per request, so this hop matters more than where the
   backend lives.
2. **Database Access** → add a user with a long random password.
3. **Network Access** → add `0.0.0.0/0`. Spaces have no static egress IP, so
   an allow-list is not available. The database password is the real access
   control — make it strong.
4. **Connect → Drivers** → copy the connection string:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/neighbouraid?retryWrites=true&w=majority
   ```

   Keep the `/neighbouraid` path segment. Without it the driver has no default
   database; `app/db/client.py` falls back to that same name, so it works
   either way, but explicit beats implicit in a connection string.

Indexes — including the `2dsphere` geo index the map and radius queries need
— are created on startup. Nothing to run by hand.

## 2. Backend — Hugging Face Space (Gradio SDK)

Create the Space at [huggingface.co/new-space](https://huggingface.co/new-space):

- **SDK:** Gradio — *not* Docker, which is the paid one
- **Template:** Blank
- **Hardware:** **CPU basic** — *not* ZeroGPU, even though ZeroGPU is
  pre-selected and also free

> **ZeroGPU will fail the build.** It makes the Space builder force-install
> `torch` and `spaces` on top of your requirements, for an app that never
> touches a GPU. Beyond the wasted image size, those extra pins collide with
> this project's and the build dies with `ResolutionImpossible`. Switch under
> **Settings → Hardware** if you already created the Space on ZeroGPU.

Push from this repo. **On Windows**:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\huggingface\push-gradio-space.ps1 <your-hf-username> neighbouraid-api
```

```bash
# macOS / Linux / Git Bash — also works on Windows, no policy flag needed
bash deploy/huggingface/push-gradio-space.sh <your-hf-username> neighbouraid-api
```

Two Windows traps, both of which fail in ways that don't point at the cause:

> **`./push-gradio-space.sh` from PowerShell does nothing.** PowerShell has no
> shebang handling, so it hands the file to whatever is associated with `.sh`
> — the script **opens in your editor**. It looks like it ran and printed
> itself. Prefix it with `bash`, or use the `.ps1`.

> **`./push-gradio-space.ps1` is blocked by default** with *"running scripts
> is disabled on this system"*. Windows ships the `Restricted` execution
> policy. The `-ExecutionPolicy Bypass` flag above is scoped to that single
> process; prefer it over `Set-ExecutionPolicy -Scope CurrentUser`, which
> permanently loosens a machine-wide security setting for one script.

Add `-DryRun` (PowerShell) or `--dry-run` (bash) to assemble the tree and list
it without pushing. Worth doing once, since the real run force-pushes. Both
stage an identical 37-file tree.

The script runs the backend test suite first, then assembles the Space tree
(`app/`, `requirements.txt` + gradio, and `deploy/huggingface/gradio/app.py`
as the entry point) and force-pushes. It strips `.env`, `__pycache__` and
test files — a stray `.env` would override the Space's configured secrets
with whatever is on your laptop, most damagingly a `MONGO_URL` pointing at
localhost. The Space is a build artefact of this repo — edit code here, never
in the Space UI, or the next push discards it.

Two details in `app.py` that are load-bearing, in case you ever rewrite it:

- Gradio mounts at **`/ui`, not `/`**. At `/` its catch-all swallows
  `/api/...` requests, and the failure looks like a FastAPI routing bug.
- The port is **hardcoded 7860**, not read from `$PORT`. Spaces routes to the
  `app_port` in the Space README regardless of the environment, so inheriting
  a stray `PORT` binds the wrong port and the Space is unreachable with
  perfectly healthy-looking logs.

Then set secrets under **Settings → Variables and secrets**:

| Secret | Required | Value |
|---|---|---|
| `MONGO_URL` | Yes | the Atlas string from step 1 |
| `JWT_SECRET` | Yes | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENVIRONMENT` | Yes | `production` |
| `FRONTEND_ORIGINS` | No | only for a custom frontend domain |

`ENVIRONMENT=production` makes the app refuse to boot on the public dev
signing key committed in this repo, so a forgotten `JWT_SECRET` fails loudly
at deploy time instead of silently accepting forged tokens.

Verify:

```bash
curl https://<user>-neighbouraid-api.hf.space/health        # {"status":"ok"}
curl https://<user>-neighbouraid-api.hf.space/health/ready  # database + ai status
```

A `503` with `database: unreachable` means the connection string or the Atlas
Network Access rule is wrong.

## 3. Frontend — Cloudflare Workers

Point the frontend at the backend from step 2:

```bash
# frontend/.env.production
VITE_API_URL=https://<user>-neighbouraid-api.hf.space
VITE_WS_URL=wss://<user>-neighbouraid-api.hf.space
```

`wss://`, not `ws://`. A browser on an https:// page blocks insecure
WebSockets, and it fails **silently** — the volunteer feed simply never
receives anything, with no error explaining why.

Then deploy:

```bash
cd frontend
npm run deploy          # = npm run build && wrangler deploy
```

[`frontend/wrangler.jsonc`](frontend/wrangler.jsonc) already serves `./dist`
with `not_found_handling: "single-page-application"`, so React Router deep
links resolve at the edge. [`frontend/public/_headers`](frontend/public/_headers)
ships the CSP and security headers with the bundle.

### The failure mode to know about

**Cloudflare must build before it uploads.** `frontend/dist/` is gitignored,
so a Git-connected build with no build command has no `dist/` at all and ends
up serving the **source** directory. The console signature:

```
Failed to load module script: ... MIME type of "text/jsx"   (main.jsx)
GET /manifest.webmanifest  404
GET /service-worker.js     404
```

The browser is requesting `/src/main.jsx`, which only the *source*
`index.html` references — the built one points at `/assets/index-*.js`. The
two 404s follow because `manifest.webmanifest` and `service-worker.js` live
in `frontend/public/` and only reach the root after a build.

Quickest confirmation: request `/package.json` on the live site. **If it
returns 200, you are serving source.**

`npm run deploy` makes this impossible — the `&&` means it cannot ship
without building. If you deploy from the Cloudflare dashboard instead, set:

| Field | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

CORS needs no change: the regex in `app/main.py` allows `*.workers.dev`,
`*.pages.dev`, `*.hf.space`, `*.vercel.app` and `*.netlify.app`. For a custom
domain, add `FRONTEND_ORIGINS=https://your-domain.com` to the Space secrets.

## 4. Keeping everything warm — UptimeRobot

One HTTP(s) monitor:

- **URL:** `https://<user>-neighbouraid-api.hf.space/health/ready`
- **Interval:** 5 minutes

Point it at `/health/ready`, **not** `/health`. That single poll does four
things at once:

1. keeps the Space from reaching its 48-hour idle timeout, so nobody's SOS is
   the request that has to wait for a cold start
2. keeps the MongoDB connection pool open, so the first real query doesn't pay
   to re-establish a connection to Atlas
3. constructs the Anthropic client if a key is set, so the TLS handshake is
   already done when the next alert needs triage
4. returns **503 naming the broken component**, so the alert email tells you
   *what* failed rather than only *that* something did

It never makes an API call, so the polling is free at any frequency.

`/health` exists for the opposite job: it deliberately checks nothing, so a
platform health check can never take the service down over a transient Atlas
blip. Use it only where a host requires a health path.

## 5. Triage — local, free, no API key

Urgency classification runs entirely inside your process:
[`app/services/vocab.py`](backend/app/services/vocab.py) matches a
multilingual crisis vocabulary. Pure Python, no dependencies, no network, no
key, **0.013 ms** per report.

It covers all eight languages the UI ships in — English, Hindi in both
Devanagari and romanised form, Bengali, Tamil, Telugu, Marathi, Gujarati and
Punjabi. A Tamil report through the live API classifies as:

```
CRITICAL   vulnerability=elderly   time=immediate   lang=ta   score=115
triggers: ['மயக்கமட', 'மூச்சு விடவில்லை']
```

The honest limit: keywords catch *stated* danger, not *implied* danger. "He
is not breathing" classifies correctly; a report where severity is only
inferable from context will not. In exchange you get triage that cannot fail,
cannot rate-limit, and cannot bill anyone.

---

## Post-deploy checks

Each fails differently, so run them in order:

1. `/health/ready` returns `database: ok` — Atlas is wired up.
2. Register an account on the Workers URL — API and CORS are wired up.
3. Open the volunteer feed in one tab, post an alert from another browser. It
   should appear **without a refresh** — that's the WebSocket, the piece most
   likely to be misconfigured (`wss://` vs `ws://`).
4. Deep-link straight to `/map` in a fresh tab — confirms the SPA fallback in
   `wrangler.jsonc` is active.
5. Post an alert in Hindi or Tamil and check it isn't ranked `MEDIUM` — that
   confirms the multilingual vocabulary is live, not just English.
6. Switch the language to Tamil and watch the network tab: exactly one small
   `ta-*.js` chunk should load, and the other six language chunks never
   fetched.

## Local development

Both `.env` files are read regardless of which directory you launch from —
`app/core/config.py` resolves them from the repo root and `backend/`, not from
the working directory. Previously, running `uvicorn` from `backend/` picked up
`backend/.env` and silently ignored the `JWT_SECRET` in the root `.env`,
falling back to the public dev secret without failing.

```bash
# backend — from repo root or backend/, both work
cd backend && ./venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm run dev
```

Open **http://localhost:3000**, not `127.0.0.1:3000` — Vite binds the hostname
`localhost` only, so the numeric address refuses the connection. The dev proxy
forwards `/api` and `/ws` to port 8000, so the backend must be on 8000.

```bash
cd backend  && ./venv/Scripts/python -m pytest -q && ./venv/Scripts/python -m ruff check .
cd frontend && npm test -- --run && npm run lint && npm run build
```

## Known limits

- **Single worker.** The first thing to fix if this gets real traffic; see the
  constraint section above.
- **Spaces are US-hosted.** ~100 ms extra for Indian users. Keeping Atlas in
  Mumbai matters more, since several database round trips happen per request
  while the user-to-Space hop happens once.
- **Spaces are ML-demo infrastructure.** Hugging Face may restart or rebuild
  them without notice. Fine at this stage; not a guarantee to build on.
- **Heuristic triage misses implied danger.** See step 5.
