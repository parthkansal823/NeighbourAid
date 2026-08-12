# Deploying NeighbourAid

Everything below is free, and needs no credit card.

| Piece | Host | Cost |
|---|---|---|
| Backend (FastAPI + WebSockets) | Hugging Face Space, **Gradio** SDK | Free |
| Database | MongoDB Atlas M0, Mumbai (`ap-south-1`) | Free |
| Frontend (React SPA) | Cloudflare Workers (static assets) | Free |
| Uptime + keep-warm | UptimeRobot → `/health/ready` | Free |
| AI triage | Multilingual keyword heuristic, in-process | Free |

> **Gradio, not Docker.** Docker Spaces are a paid feature on some Hugging
> Face accounts; Gradio and Static are free. A Gradio Space just runs
> `app.py` and proxies port 7860 — it never checks that what you started is
> actually Gradio, so it serves FastAPI perfectly well. Verified end to end:
> `/health`, `/health/ready`, `/docs` and `/api/...` all respond, at ~150 MB.
> The Docker files are still in `deploy/huggingface/` if your account has
> Docker Spaces.

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

## No Anthropic key needed

Triage used to load a 1.6 GB HuggingFace model into your own process, which
is where "the AI won't run on a free tier" came from. That is no longer true.
Urgency classification now runs on the keyword heuristic in
`app/services/vocab.py`: pure Python, no dependencies, no network, under a
millisecond, and **free forever**.

It covers all eight languages the UI ships in — English, Hindi in both
Devanagari and romanised form, Bengali, Tamil, Telugu, Marathi, Gujarati and
Punjabi. A real Tamil report posted through the running API classifies as:

```
CRITICAL   vulnerability=elderly   time=immediate   lang=ta   score=115
triggers: ['மயக்கமட', 'மூச்சு விடவில்லை']
```

Setting `ANTHROPIC_API_KEY` upgrades triage to Claude, which reads intent
rather than keywords and handles unusual phrasing far better. It is a genuine
improvement, and it is entirely optional — leave it unset and nothing breaks.

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

## 2. Backend — Hugging Face Space (Gradio SDK)

Create the Space: [huggingface.co/new-space](https://huggingface.co/new-space)

- **SDK:** Gradio (free — Docker is the paid one)
- **Template:** Blank
- **Hardware:** CPU basic (free)

Push from this repo:

```bash
./deploy/huggingface/push-gradio-space.sh <your-hf-username> neighbouraid-api
```

It runs the backend test suite first, then assembles the Space tree
(`app/`, `requirements.txt` + gradio, and `deploy/huggingface/gradio/app.py`
as the entry point) and force-pushes. The Space is a build artefact — edit
code here, never in the Space UI, or the next push discards it.

`app.py` mounts a small Gradio landing page at `/ui` and serves the real API
everywhere else. Gradio is mounted at `/ui` rather than `/` on purpose: at
`/` its catch-all would swallow `/api/...` requests, and the failure looks
like a FastAPI routing bug.

Then set secrets under **Settings → Variables and secrets**:

| Secret | Value |
|---|---|
| `MONGO_URL` | the Atlas string from step 1 |
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENVIRONMENT` | `production` |
| `ANTHROPIC_API_KEY` | optional — leave unset to stay free |

`ENVIRONMENT=production` makes the app refuse to boot on the public dev
signing key committed in this repo, so a forgotten `JWT_SECRET` fails loudly
at deploy time instead of silently accepting forged tokens.

Verify:

```bash
curl https://<user>-neighbouraid-api.hf.space/health        # {"status":"ok"}
curl https://<user>-neighbouraid-api.hf.space/health/ready  # database + ai status
```

If `/health/ready` returns `503 database: unreachable`, the connection string
or the Atlas Network Access rule is wrong.

## 3. Frontend — Cloudflare Workers

The config already exists at [`frontend/wrangler.jsonc`](frontend/wrangler.jsonc):
it serves `./dist` with `not_found_handling: "single-page-application"`, so
React Router deep links work at the edge.

Deploy with:

```bash
cd frontend
npm run deploy          # = npm run build && wrangler deploy
```

Set the API URLs first, or the app builds fine and talks to nothing:

```bash
# frontend/.env.production
VITE_API_URL=https://<user>-neighbouraid-api.hf.space
VITE_WS_URL=wss://<user>-neighbouraid-api.hf.space
```

`wss://`, not `ws://`. A browser on an https:// page blocks insecure
WebSockets, and it fails silently — the volunteer feed simply never receives
anything, with no error explaining why.

### If you deploy from the Cloudflare dashboard instead

**This is the setting that breaks deploys.** Cloudflare must build before it
uploads, because `frontend/dist/` is gitignored — a Git-connected build with
no build command has no `dist/` at all and ends up serving the *source*
directory. The symptom is unmistakable:

```
Failed to load module script: ... MIME type of "text/jsx"   (main.jsx)
GET /manifest.webmanifest  404
GET /service-worker.js     404
```

The browser is asking for `/src/main.jsx`, which only the source `index.html`
references — the built one points at `/assets/index-*.js`. Confirm it by
requesting `/package.json` on the live site: if that returns 200, you are
serving source. Correct settings:

| Field | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

`npm run deploy` avoids the whole class of problem, because the `&&` makes it
impossible to ship without building.

CORS needs no change: the regex in `app/main.py` allows `*.workers.dev`,
`*.pages.dev`, `*.hf.space`, `*.vercel.app` and `*.netlify.app`. For a custom
domain, add `FRONTEND_ORIGINS=https://your-domain.com` to the Space secrets.

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
