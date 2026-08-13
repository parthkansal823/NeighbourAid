# Deploying NeighbourAid

| Piece | Host | Cost |
|---|---|---|
| Backend (FastAPI + WebSockets) | DigitalOcean droplet, Bangalore | $0 — GitHub Student Pack credit |
| Database | MongoDB Atlas M0, Mumbai (`ap-south-1`) | Free |
| Frontend (React SPA) | Cloudflare Workers (static assets) | Free |
| TLS | Caddy + Let's Encrypt, automatic | Free |
| Uptime | UptimeRobot → `/health/ready` | Free |
| Triage | Multilingual keyword classifier, in-process | Free |

**Order matters.** The database URL configures the backend, and the backend
URL is baked into the frontend at build time. Going 1 → 5 avoids deploying
twice.

---

## Two things that decide the whole design

**1. The backend needs one long-lived process, and exactly one.**

`app/services/websocket.py` keeps connected volunteers in a plain in-process
dict. So:

- **No serverless.** Vercel/Netlify Functions, Lambda and Cloudflare Workers
  are all out for the backend — it must hold WebSocket connections open. This
  is also why Hugging Face's free tier does not work (see below).
- **No second worker.** A second worker owns a second, invisible half of the
  volunteer pool, and an alert reaches only whoever shares its process.

That is a ceiling, not a design. Moving the registry behind Redis pub/sub is
what unlocks scaling, and it is far easier before there is traffic.

**2. TLS is mandatory, not a polish step.**

A browser blocks `ws://` from an `https://` page. Without a certificate the
volunteer feed **silently receives nothing** — no error, no clue, every REST
route working normally. `deploy/vm/` runs Caddy for exactly this reason.

### Free hosts that were tried and rejected

Recorded so nobody repeats the search:

| Host | Why not |
|---|---|
| Hugging Face Spaces | Free tier is **ZeroGPU only** — CPU basic now needs PRO. ZeroGPU allocates a GPU per decorated call and expects a Gradio demo; a stateful WebSocket API is the wrong shape, which is what produced the port-7860 double-bind. Docker Spaces are paid. |
| Render free | Works technically — the image was measured booting at **64 MB of 512 MB** with every endpoint green. But the 750 free instance-hours are **per account**, and one always-warm service uses ~730. Viable only if you have no other free service. |
| Oracle / Fly / Railway / AWS | Require a credit card. |
| Mappls / Google geocoding | Trial credit, not a free tier. |

---

## 1. Database — MongoDB Atlas

1. Free **M0** cluster in **Mumbai / `ap-south-1`**. Several database round
   trips happen per request, so this hop matters more than where the backend
   lives.
2. **Database Access** → add a user with a long random password.
3. **Network Access** → add `0.0.0.0/0`. A droplet has a static IP you
   *could* allow-list, and doing so is a genuine improvement once the IP is
   known — but get it working first.
4. **Connect → Drivers** → copy the connection string:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/neighbouraid?retryWrites=true&w=majority
   ```

   Keep the `/neighbouraid` segment. `app/db/client.py` falls back to that
   name anyway, but explicit beats implicit in a connection string.

Indexes — including the `2dsphere` geo index the map and radius queries need
— are created on startup. Nothing to run by hand.

## 2. Backend — DigitalOcean droplet

**Claim the credit:** [digitalocean.com/github-students](https://www.digitalocean.com/github-students)
gives $200 through the GitHub Student Developer Pack.

**Create the droplet:** Ubuntu LTS, region **Bangalore (BLR1)**, the $6/mo
Basic tier (1 GB / 1 vCPU). The API needs 64 MB of that, so the rest is
headroom — enough to run a local LLM later if you want one.

**Point a domain at it.** The Student Pack includes a free `.me` domain from
Namecheap. Add an **A record** for the droplet's IP and wait for it to
propagate:

```bash
dig +short YOUR_DOMAIN     # must print the droplet IP
```

Do this *before* the next step. Caddy proves domain ownership over port 80 to
get a certificate, and a failed attempt counts against a Let's Encrypt rate
limit that locks you out for a week. `setup.sh` checks DNS first and refuses
to start rather than burn one.

**Deploy:**

```bash
ssh root@YOUR_DROPLET_IP
git clone https://github.com/pk23nk21/NeighbourAid.git
cd NeighbourAid && bash deploy/vm/setup.sh
```

The first run installs Docker, writes `deploy/vm/.env` with a freshly
generated `JWT_SECRET`, and stops. Fill in three values:

| Variable | Value |
|---|---|
| `MONGO_URL` | the Atlas string from step 1 |
| `DOMAIN` | the domain whose A record you just set |
| `TLS_EMAIL` | where Let's Encrypt sends expiry warnings |

Re-run `bash deploy/vm/setup.sh`. It builds, starts, and verifies.

`ENVIRONMENT` is not in that list because it already defaults to
`production` in code — a deploy that sets nothing still refuses to boot on
the public dev signing key committed in this repo.

Verify:

```bash
curl https://YOUR_DOMAIN/health        # {"status":"ok"}
curl https://YOUR_DOMAIN/health/ready  # {"status":"ok","database":"ok"}
```

`503 database: unreachable` means the Atlas string or Network Access rule is
wrong. No certificate means DNS was not pointing here when Caddy started —
fix the A record and `docker compose restart caddy`.

**Lock the firewall down** once it works:

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

**Updating later:**

```bash
cd NeighbourAid && git pull && bash deploy/vm/setup.sh
```

## 3. Frontend — Cloudflare Workers

Point it at the backend from step 2:

```bash
# frontend/.env.production
VITE_API_URL=https://YOUR_DOMAIN
VITE_WS_URL=wss://YOUR_DOMAIN
```

**`wss://`, not `ws://`.** See the TLS note above — this fails silently.

Then:

```bash
cd frontend
npm run deploy          # = npm run build && wrangler deploy
```

First time only: `npx wrangler login` (opens a browser).

[`frontend/wrangler.jsonc`](frontend/wrangler.jsonc) serves `./dist` with
`not_found_handling: "single-page-application"`, so React Router deep links
resolve at the edge. [`frontend/public/_headers`](frontend/public/_headers)
ships the CSP and security headers with the bundle.

### The failure mode to know about

**Cloudflare must build before it uploads.** `frontend/dist/` is gitignored,
so a Git-connected build with no build command has no `dist/` at all and
serves the **source** directory. The console signature:

```
Failed to load module script: ... MIME type of "text/jsx"   (main.jsx)
GET /manifest.webmanifest  404
GET /service-worker.js     404
```

The browser is requesting `/src/main.jsx`, which only the *source*
`index.html` references. Quickest confirmation: request `/package.json` on
the live site — **if it returns 200, you are serving source.**

`npm run deploy` makes this impossible; the `&&` cannot ship without
building. If you deploy from the Cloudflare dashboard instead, set root
directory `frontend`, build command `npm ci && npm run build`, deploy command
`npx wrangler deploy`.

CORS needs no change: the regex in `app/main.py` allows `*.workers.dev`,
`*.pages.dev`, `*.hf.space`, `*.vercel.app` and `*.netlify.app`. For a custom
frontend domain, add `FRONTEND_ORIGINS=https://your-domain.com` to
`deploy/vm/.env`.

## 4. Uptime — UptimeRobot

One HTTP(s) monitor on `https://YOUR_DOMAIN/health/ready`, every 5 minutes.

A droplet does not sleep, so unlike a free-tier host this is **monitoring,
not a keep-alive**. Point it at `/health/ready` rather than `/health`,
because that is the one that returns **503 naming the broken component** —
so the alert email tells you Atlas is unreachable rather than just that
something is wrong.

`/health` exists for the opposite job: it deliberately checks nothing, so a
container health check can never restart a healthy service over a transient
database blip. That is what Docker's healthcheck uses.

## 5. Triage — local, free, no API key

Urgency classification runs entirely in-process:
[`app/services/vocab.py`](backend/app/services/vocab.py) matches a
multilingual crisis vocabulary plus a small set of patterns. Pure Python, no
dependencies, no network, no key, **~0.05 ms** per report.

Measured on the 40-case labelled set in
[`backend/tests/eval_dataset.py`](backend/tests/eval_dataset.py):

```
overall 90%  ·  CRITICAL 17/17  ·  implied danger 5/7  ·  under-ranked 2
```

Re-run it any time with `python -m tests.eval_triage` from `backend/`.

The pattern layer is what catches danger that is **described but never
named** — "won't answer", "bol nahi rahe", "दिख नहीं रहा". Keyword matching
alone scored 0/7 on those, ranking a drowning child below a power cut.

Honest limit: this reads stated danger, not inferred danger. A local LLM
scored 6/7 on implied cases and is benchmarked in
[`models/README.md`](models/README.md), but it is **not wired in** — 1 GB is
enough to run it, so that remains an option once the plain deploy is live.

---

## Post-deploy checks

Each fails differently, so run them in order:

1. `https://YOUR_DOMAIN/health/ready` returns `database: ok` — Atlas wired up.
2. The padlock shows in the browser — Caddy got its certificate.
3. Register an account on the frontend — API and CORS wired up.
4. Open the volunteer feed in one tab, post an alert from another browser.
   It should appear **without a refresh** — that is the WebSocket, the piece
   most likely to be misconfigured (`wss://` vs `ws://`).
5. Watch that same alert gain an **address** a few seconds after posting —
   that is the deferred enrichment re-broadcasting over the socket.
6. Deep-link to `/map` in a fresh tab — confirms the SPA fallback.
7. Post in Hindi or Tamil and check it is not ranked `MEDIUM` — confirms the
   multilingual vocabulary is live, not just English.
8. Switch the language to Tamil and watch the network tab: exactly one small
   `ta-*.js` chunk loads, the other six never fetched.

## Local development

Both `.env` files are read regardless of which directory you launch from —
`app/core/config.py` resolves them from the repo root and `backend/`, not the
working directory.

```bash
# backend — from repo root or backend/, both work
cd backend && ./venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm run dev
```

Open **http://localhost:3000**, not `127.0.0.1:3000` — Vite binds the
hostname `localhost` only. The dev proxy forwards `/api` and `/ws` to port
8000, so the backend must be on 8000.

Set `ENVIRONMENT=development` in `backend/.env` for local work. It relaxes
the "JWT_SECRET is the public dev default" and "MONGO_URL points at
localhost" checks from fatal errors into warnings.

```bash
cd backend  && ./venv/Scripts/python -m pytest -q && ./venv/Scripts/python -m ruff check .
cd frontend && npm test -- --run && npm run lint && npm run build
```

## Known limits

- **Single worker.** The first thing to fix if this gets real traffic; see the
  constraint section above.
- **Map tiles come from `tile.openstreetmap.org`**, whose
  [usage policy](https://operations.osmfoundation.org/policies/tiles/)
  prohibits production use. Fine while small; move to a free tile host with
  an SLA before users depend on it.
- **Triage reads stated danger, not inferred danger.** See step 5.
- **Addresses are best-effort.** OpenStreetMap has no road name for parts of
  India, so a label can be just a town and postcode. The **Navigate** button
  routes by coordinates, not by the address string, so navigation is exact
  regardless.
- **The $200 credit is finite.** A $6/mo droplet lasts a long time, but set a
  DigitalOcean billing alert so it does not expire unnoticed.
