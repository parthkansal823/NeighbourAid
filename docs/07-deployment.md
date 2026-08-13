# 7. Deployment — free, no credit card

This guide walks through getting NeighbourAid live on the public
internet using **only services that don't require a credit card**:

| Layer | Service | Free tier |
|---|---|---|
| Frontend | **Cloudflare Pages** | Free, no card, 5+ India PoPs (Mumbai/Delhi/Bangalore/Hyderabad/Chennai) |
| Backend | **HuggingFace Spaces** (Docker SDK) | 2 vCPU + 16 GB RAM, no card, never sleeps |
| Database | **MongoDB Atlas M0** | 512 MB, no card, Mumbai region |

**Total time:** ~25 minutes start to finish.

You'll need four accounts (all free, all signup-with-email or
GitHub-OAuth):
1. [GitHub](https://github.com) — to push code
2. [Cloudflare](https://dash.cloudflare.com/sign-up) — for the frontend
3. [HuggingFace](https://huggingface.co/join) — for the backend
4. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) — for the database

Push your code to `https://github.com/pk23nk21/NeighbourAid` first —
both Cloudflare Pages and HuggingFace pull source from GitHub.

> **Why Cloudflare Pages?** It has the deepest CDN coverage in India
> (5+ city PoPs vs Vercel's 1 vs Netlify's 0). For a crisis-response
> app where a few hundred milliseconds matter, this is the right pick.

---

## Step 1 — MongoDB Atlas (5 min)

1. Go to <https://www.mongodb.com/cloud/atlas/register> → sign up
   with email or Google. **No card asked.**
2. Click **Build a Database** → choose **M0 (Free)** → Provider
   `AWS`, Region **Mumbai (ap-south-1)** → **Create**.
3. **Create database user**: pick a username, click *Autogenerate
   Secure Password*, copy it somewhere. Then click *Create User*.
4. **Network access**: click *Add IP Address* → *Allow access from
   anywhere* (`0.0.0.0/0`). Easiest for free-tier hosts whose IPs
   change.
5. Click **Connect** → *Drivers* → copy the connection string. It
   looks like:

   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

6. Replace `<password>` with your real password and append the DB
   name `neighbouraid` before the `?`:

   ```
   mongodb+srv://parth:HUNTER2@cluster0.xxxxx.mongodb.net/neighbouraid?retryWrites=true&w=majority
   ```

   Save this string — you'll paste it into the backend env vars in
   Step 2.

---

## Step 2 — Backend on HuggingFace Spaces (10 min)

HuggingFace Spaces is a free hosting platform meant for ML demos,
but the **Docker SDK** option lets us run any container — including
a full FastAPI server with WebSockets. The free tier is 2 vCPU and
**16 GB RAM**, which is more than enough to run our backend with the
real HF triage model loaded if you want.

### 2a. Create the Space

1. Go to <https://huggingface.co/new-space>.
2. **Owner**: your username.
3. **Space name**: `neighbouraid-api` (or whatever).
4. **License**: `mit` (or whichever — required by the form).
5. **Select the SDK**: choose **Docker** → *Blank*.
6. **Space hardware**: keep `CPU basic · 2 vCPU · 16 GB · FREE`.
7. **Visibility**: Public. (Private also works, but volunteers'
   browsers can't connect to a private Space's API.)
8. Click **Create Space**.

### 2b. Connect your GitHub backend folder

HuggingFace Spaces is itself a Git repo. The cleanest way to get
your `backend/` folder up there is to **push the contents of
`backend/`** into the Space's git repo as the root.

```bash
# in a new throwaway folder
git clone https://huggingface.co/spaces/<your-hf-user>/neighbouraid-api
cd neighbouraid-api

# copy backend/ into the Space root
cp -r /path/to/NeighbourAid/backend/. .

# Spaces needs a README with frontmatter telling it the SDK + port
cat > README.md <<'EOF'
---
title: NeighbourAid API
emoji: 🛟
colorFrom: orange
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# NeighbourAid backend

FastAPI backend for NeighbourAid. Source in
[github.com/pk23nk21/NeighbourAid](https://github.com/pk23nk21/NeighbourAid).
EOF

git add .
git commit -m "Initial deploy"
git push
```

The Space starts building immediately. Watch progress at
`https://huggingface.co/spaces/<you>/neighbouraid-api/logs` — the
first build takes 6–8 min because it pre-downloads the HF triage
model. (Set `SKIP_MODEL_DOWNLOAD=1` as a *Variable* under Space
settings if you want a 30-second build that uses the keyword
fallback.)

> **Why `app_port: 7860`?** Spaces' Docker SDK exposes a single port
> via their reverse proxy, fixed at 7860. Our Dockerfile honours
> `$PORT` so the same image works on any host.

### 2c. Add secrets

Open your Space → **Settings** → **Variables and secrets**:

| Name | Type | Value |
|---|---|---|
| `JWT_SECRET` | secret | Run `openssl rand -hex 32` and paste |
| `MONGO_URL` | secret | The Atlas string from Step 1 |
| `NA_DISABLE_AI_MODEL` | variable | `0` to load the real model, `1` for fallback |
| `FRONTEND_ORIGINS` | variable | We'll fill this in Step 3 — leave for now |

Save and the Space rebuilds automatically.

### 2d. Verify the backend is up

Hit `https://<you>-neighbouraid-api.hf.space/health` in a browser
or with curl:

```bash
curl https://<you>-neighbouraid-api.hf.space/health
# → {"status":"ok"}
```

The Swagger UI is at `https://<you>-neighbouraid-api.hf.space/docs`.

**Note the URL pattern:** it's `<owner>-<spacename>.hf.space`, with
**dashes** between owner and space name, not slashes.

---

## Step 3 — Frontend on Cloudflare Pages (5 min)

1. Push your code to GitHub if you haven't:
   ```bash
   git push origin main
   ```
2. Sign in at <https://dash.cloudflare.com>.
3. In the left sidebar: **Workers & Pages** → **Create** →
   **Pages** tab → **Connect to Git**.
4. Authorise GitHub when prompted, pick `pk23nk21/NeighbourAid`,
   click **Begin setup**.
5. **Build configuration**:

   | Field | Value |
   |---|---|
   | Project name | `neighbouraid` (or whatever — becomes part of the URL) |
   | Production branch | `main` |
   | Framework preset | **Vite** |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | **Root directory (advanced)** | **`frontend`** ← important |

6. **Environment variables** — click *Add variable* for each:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://<you>-neighbouraid-api.hf.space` |
   | `VITE_WS_URL` | `wss://<you>-neighbouraid-api.hf.space` |

7. Set both to **Production** environment. Click **Save and Deploy**.
8. Cloudflare builds in ~60–90 seconds. Your live URL is
   `https://neighbouraid.pages.dev` (or
   `https://neighbouraid-xxxxx.pages.dev` if the name was taken).

> **What about SPA routing?** The repo ships
> `frontend/public/_redirects` and `frontend/public/_headers` —
> Cloudflare Pages reads both at deploy time. The `_redirects` file
> rewrites all unmatched paths to `/index.html` so React Router can
> handle `/alert/:id` etc. The `_headers` file applies the same
> security-header set the backend does, plus aggressive caching for
> hashed assets and a no-cache rule for `/service-worker.js`.

---

## Step 4 — Tell the backend about the frontend (1 min)

Back to your HuggingFace Space → Settings → Variables → edit
`FRONTEND_ORIGINS`:

```
https://neighbouraid.pages.dev
```

(Comma-separate if you have multiple — preview branches, a custom
domain, etc.)

The Space redeploys automatically. Without this, the browser will
block your alert POSTs with a CORS error.

---

## Step 5 — Smoke test (3 min)

Open your Cloudflare Pages URL in two different browsers (or one
normal + one incognito):

1. **Reporter**: register as a reporter, post a test alert with GPS
   somewhere in your city.
2. **Volunteer**: register as a volunteer with your home GPS within
   5 km of the test alert. Open the **Volunteer Feed**.
3. The volunteer's feed should light up over WebSocket within a
   couple of seconds, with toast + audio ping.
4. Open `https://<you>-neighbouraid-api.hf.space/api/news/recent`
   in a tab — first call is slow (~5 s) as it scrapes the four RSS
   feeds; subsequent calls are instant for 5 minutes.

If WebSocket doesn't connect, open DevTools → Network → WS tab. The
URL should be `wss://<you>-neighbouraid-api.hf.space/ws/volunteer?
token=…` — if it's `ws://` instead, your Cloudflare Pages env vars
need the `wss://` (TLS) variant. After fixing them, retrigger a
deploy from the Cloudflare dashboard (env-var changes don't
auto-rebuild).

---

## Updating

- **Frontend changes**: `git push` → Cloudflare Pages auto-deploys in
  ~60–90 s. Each PR also gets a preview URL.
- **Backend changes**: push to your `huggingface.co/spaces/.../...`
  remote → the Space rebuilds automatically.

If you keep both repos in sync, the easiest workflow is a small
script that pushes `backend/` to the HF remote whenever you push to
GitHub. Or just `git push` to both manually — the Space repo and
the GitHub repo are independent.

---

## Alternatives (also no card)

- **Cloudflare Pages** — drop-in replacement for Vercel for the
  frontend. Free, fast CDN, no card.
- **Netlify** — same role as Vercel, also no-card.
- **Replit** — can host the backend in a Repl, but the free tier
  sleeps after inactivity, which kills the WebSocket. Use
  HuggingFace Spaces unless you need Repl-specific features.
- **GitHub Pages** — works for the frontend if you set
  `vite.config.js`'s `base` correctly. SPA routing requires a 404.html
  hack. HuggingFace Spaces won't accept WS to a GH-Pages origin
  without CORS, so prefer Vercel.

---

## Optional add-ons

### One-command Ubuntu VM (if you ever get a VM)

```bash
git clone https://github.com/pk23nk21/NeighbourAid.git
cd NeighbourAid && bash deploy/vm/setup.sh
```

[`deploy/vm/setup.sh`](../deploy/vm/setup.sh) is idempotent — installs Docker, clones
the repo, generates `JWT_SECRET`, runs `docker compose up -d`. Works
on AWS Lightsail, EC2, Oracle Always Free, DigitalOcean, Hetzner.

### Auto-redeploy on `git push` (CI hook)

The repo ships `.github/workflows/deploy.yml` that POSTs to a
configurable hook URL on every push to `main`. To use it with HF
Spaces (which doesn't expose a deploy-hook URL), instead set up a
GitHub Action that pushes `backend/` to the HF remote — pseudo-code
in the workflow's comment block.

---

## Troubleshooting deployment

| Symptom | Likely cause |
|---|---|
| HF Space build fails on `pip install transformers` | Out of disk during build. Set `SKIP_MODEL_DOWNLOAD=1` and use `NA_DISABLE_AI_MODEL=1`. |
| Frontend → backend gets blocked with CORS error | `FRONTEND_ORIGINS` in HF Space doesn't match your Vercel URL exactly. Include the full `https://...vercel.app`. |
| WebSocket disconnects every few seconds | Your `VITE_WS_URL` is `ws://` instead of `wss://`. Edit Vercel env vars, redeploy. |
| Atlas connection fails | Your IP allowlist isn't `0.0.0.0/0`, or the password in your connection string still has `<` and `>` literals. |
| HF Space says "App not running" | Look at *Logs* tab — usually a missing env var or syntax error. The `/health` endpoint must return 200 within 60 s of container start. |

---

For step-by-step user-facing docs (registering, posting, accepting
alerts), see [02-user-guide.md](02-user-guide.md). For dev setup,
see [06-development.md](06-development.md).
