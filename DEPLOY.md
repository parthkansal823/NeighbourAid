# Deploying NeighbourAid

Everything below is free, and needs no credit card.

| Piece | Host | Cost |
|---|---|---|
| Backend (FastAPI + WebSockets) | Render, free web service, Singapore | Free |
| Database | MongoDB Atlas M0, Mumbai (`ap-south-1`) | Free |
| Frontend (React SPA) | Cloudflare Pages **or** Workers | Free |
| Uptime + keep-warm | UptimeRobot → `/health/ready` | Free |

> Hugging Face Spaces was the earlier recommendation, and the Docker files
> for it are still in `deploy/huggingface/` if your account has Docker Spaces
> available. They are gated behind a paid plan on some accounts, which is why
> Render is the default here.

## The constraint behind these choices

`app/services/websocket.py` keeps connected volunteers in a plain in-process
dict. Two consequences shape everything below:

1. **The backend cannot run serverless.** No Vercel/Netlify Functions, no
   Lambda, no Workers — it needs one long-lived process holding open sockets.
2. **The backend cannot run more than one worker.** A second worker holds a
   second, invisible half of the volunteer pool, and an alert reaches only
   whoever happens to share its process. The Space Dockerfile pins
   `--workers 1` for exactly this reason. Lifting that ceiling means moving
   the registry behind Redis pub/sub first.

## Why Render free (and how the sleep problem is solved)

Render's free plan sleeps after **15 minutes** without an inbound request and
takes roughly **50 seconds** to wake. For a side project that is a shrug; for
a crisis app it is unacceptable, because the first request after a quiet spell
is someone pressing SOS.

The fix is step 4: an UptimeRobot monitor polls `/health/ready` every 5
minutes, so the idle timer never reaches 15. Free instance-hours are 750 a
month against a calendar month's ~730, so one always-warm service fits — but
only one. A second free service on the same account pushes you over and both
get suspended.

The trade versus paid hosting is 512 MB RAM and 0.1 vCPU. That is fine here:
triage runs either on Anthropic's servers or on a keyword match, so nothing
heavy runs in your process.

---

## 1. Database — MongoDB Atlas

1. Create a free **M0** cluster in **Mumbai / `ap-south-1`**.
2. **Database Access** → add a user; use a long random password.
3. **Network Access** → add `0.0.0.0/0`. Spaces have no static egress IP, so
   an allow-list is not an option. The database password is the real access
   control here — make it strong.
4. Copy the connection string from **Connect → Drivers**:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/neighbouraid?retryWrites=true&w=majority
   ```

Indexes — including the `2dsphere` geo index the map and radius queries need —
are created on startup. Nothing to run by hand.

## 2. Backend — Hugging Face Space

Create the Space first: [huggingface.co/new-space](https://huggingface.co/new-space)
→ SDK **Docker**, template **blank**, visibility public.

Then push from this repo:

```bash
./deploy/huggingface/push-space.sh <your-hf-username> neighbouraid-api
```

The script runs the backend test suite, assembles the Space tree (`app/`,
`requirements.txt`, and the Docker/README files from `deploy/huggingface/`),
and force-pushes. The Space is a build artefact — edit code here, never in the
Space UI, or the next push discards it.

Then set secrets under **Settings → Variables and secrets**:

| Secret | Value |
|---|---|
| `MONGO_URL` | the Atlas string from step 1 |
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENVIRONMENT` | `production` |
| `ANTHROPIC_API_KEY` | optional — see step 5 |

`ENVIRONMENT=production` makes the app refuse to boot on the public dev
signing key committed in this repo, so a forgotten `JWT_SECRET` fails loudly
at deploy time instead of silently accepting forged tokens.

Verify:

```bash
curl https://<user>-neighbouraid-api.hf.space/health        # {"status":"ok"}
curl https://<user>-neighbouraid-api.hf.space/health/ready  # database + ai status
```

If `/health/ready` returns `503 database: unreachable`, the connection string
or the Network Access rule is wrong.

## 3. Frontend — Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Build settings:
   - Framework preset **Vite**, root directory `frontend`
   - Build command `npm run build`, output directory `dist`
3. Environment variables, for Production **and** Preview:

   ```
   VITE_API_URL = https://<user>-neighbouraid-api.hf.space
   VITE_WS_URL  = wss://<user>-neighbouraid-api.hf.space
   ```

   `wss://`, not `ws://`. A browser on an https:// page blocks insecure
   WebSockets, and it fails silently — the volunteer feed simply never
   receives anything, with no error to explain why.

Two files in `frontend/public/` already do work here:
[`_headers`](frontend/public/_headers) applies the CSP and security headers at
the edge, and [`_redirects`](frontend/public/_redirects) rewrites all paths to
`index.html` so a shared link to `/map` or a specific alert loads the app
instead of a 404.

CORS needs no change: the regex in `app/main.py` already allows both
`*.pages.dev` and `*.hf.space`. On a custom domain, add
`FRONTEND_ORIGINS=https://your-domain.com` to the Space secrets.

## 4. Keeping everything warm — UptimeRobot

Add one HTTP(s) monitor:

- **URL:** `https://<user>-neighbouraid-api.hf.space/health/ready`
- **Interval:** 5 minutes

Point it at `/health/ready`, not `/health`. That single poll does four things:

1. keeps the Space from reaching its 48-hour idle timeout
2. keeps the MongoDB connection pool open, so the first real query doesn't
   pay to re-establish a connection to Atlas
3. builds the Anthropic client if it isn't built, so the TLS handshake is
   already done when the next alert needs triage
4. returns **503** naming the broken component, so the alert email tells you
   *what* failed rather than only *that* something did

None of it costs an Anthropic API call, so the polling stays free at any
frequency.

`/health` exists for the opposite job — it deliberately checks nothing, so a
platform health check can never take the service down over a transient Atlas
blip. Use it only if a host requires a health path.

## 5. Making AI triage always run

Triage runs on Claude when `ANTHROPIC_API_KEY` is set and falls back to a
keyword heuristic when it isn't. **Right now no key is configured, so every
alert is being triaged by the heuristic.** It works — it covers English, Hindi
and Hinglish — but it matches literal keywords, so unusual phrasing gets
mis-ranked.

To turn Claude on, get a key at
[console.anthropic.com](https://console.anthropic.com/) and add
`ANTHROPIC_API_KEY` to the Space secrets. Roughly **$0.008 per alert**.

Confirm it took effect:

```bash
curl https://<user>-neighbouraid-api.hf.space/health/ready
```

The `ai` field reports which engine is live:

| Value | Meaning |
|---|---|
| `claude` | Working as intended |
| `heuristic` | No API key set |
| `heuristic-degraded` | Key is set but the client could not be built — check the key |
| `disabled` | `NA_DISABLE_AI_MODEL=1` is set (tests use this; never set it in production) |

The client no longer latches off permanently after a transient failure — it
backs off for 60 seconds and retries — so a brief network problem at startup
can't leave the Space silently running heuristic-only for days.

---

## Local development

Both `.env` files are now read regardless of which directory you launch from
(`app/core/config.py` resolves them from the repo root and `backend/`, not
from the working directory). Before, running `uvicorn` from `backend/` picked
up `backend/.env` and silently ignored the `JWT_SECRET` in the root `.env` —
falling back to the public dev secret without failing.

```bash
# backend  (from repo root or backend/, both work now)
cd backend && ./venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm run dev
```

Open **http://localhost:3000** — not `127.0.0.1:3000`. Vite binds the hostname
`localhost` only, so the numeric address refuses the connection. The dev proxy
forwards `/api` and `/ws` to port 8000, so the backend must be on 8000 for the
frontend to reach it.

## Post-deploy checks

Each of these fails differently, so run them in order:

1. `/health/ready` returns `database: ok` — Atlas is wired up.
2. Register an account on the Pages URL — API and CORS are wired up.
3. Open the volunteer feed in one tab, post an alert from another browser.
   The alert should appear **without a refresh** — that's the WebSocket, the
   piece most likely to be misconfigured (`wss://` vs `ws://`).
4. Deep-link straight to `/map` in a fresh tab — confirms `_redirects` landed.
5. Switch the language to Tamil and watch the network tab: exactly one small
   `ta-*.js` chunk should load, and the other six languages never fetched.

## Known limits

- **Single worker.** See the constraint section. First thing to fix if this
  gets real traffic.
- **US region.** ~100ms extra for Indian users versus a Singapore or Mumbai
  host. Atlas being in Mumbai keeps database round trips off that path, which
  matters more since several happen per request.
- **Spaces are ML-demo infrastructure.** Hugging Face may restart or rebuild
  them without notice. Fine at this stage; not a guarantee to build on.
