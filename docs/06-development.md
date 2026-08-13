# 6. Development setup

How to get the project running locally end-to-end. Allow ~10 minutes
the first time (`pip install` + `npm install` are the long parts).

---

## 6.1 Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | 3.12 also works; CI tests both |
| Node.js | 18+ | LTS is fine |
| MongoDB | 6+ | Local Docker or Atlas free tier |
| Docker | optional | Only needed for the all-in-one stack |
| `git` | any | Obvious |

Windows works (the project was developed on it). The shell snippets
below are bash-flavoured; use the equivalent on PowerShell / cmd if
you're on Windows.

---

## 6.2 Clone + install

```bash
git clone https://github.com/pk23nk21/NeighbourAid.git neighbouraid
cd neighbouraid
```

### Backend

```bash
cd backend
python -m venv venv
# macOS/Linux: source venv/bin/activate
# Windows:     venv\Scripts\activate
pip install -r requirements.txt

# Optional dev tooling (used in CI)
pip install ruff pytest-cov
```

### Frontend

```bash
cd ../frontend
npm install
```

---

## 6.3 Environment variables

Copy `.env.example` to `.env`:

```bash
cd ..   # back to repo root
cp .env.example .env
```

Edit `.env` if you want — none of the defaults block local dev.

| Var | Default | Notes |
|---|---|---|
| `JWT_SECRET` | `dev-secret-change-in-production` | Override in prod. |
| `MONGO_URL` | `mongodb://localhost:27017/neighbouraid` | Atlas string works. |
| `FRONTEND_ORIGINS` | empty | Extra CORS origins, comma-separated. |
| `ALERT_WEBHOOK_URL` | empty | Optional outbound webhook for n8n/Zapier. |
| `ALERT_WEBHOOK_TIMEOUT_SECONDS` | `4.0` | |
| `INBOUND_TOKEN` | empty | Empty disables the WhatsApp inbound route entirely. |
| `VITE_API_URL` | empty | Frontend backend URL (Vite proxies in dev). |
| `VITE_WS_URL` | empty | Frontend WS URL (Vite proxies in dev). |

The frontend reads `VITE_*` from `frontend/.env` if present —
typically you don't need one in dev because Vite proxies `/api` and
`/ws` to `:8000`.

---

## 6.4 Running everything

You'll need three processes: Mongo + backend + frontend.

### Mongo

```bash
docker run -d --name mongo -p 27017:27017 -v mongo_data:/data/db mongo:6
```

(or use a free Atlas M0 cluster and put its URL in `.env`.)

### Backend

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

Sanity-check at `http://localhost:8000/health` (returns
`{"status":"ok"}`) and `http://localhost:8000/docs` (Swagger UI).

### Frontend

```bash
cd frontend
npm run dev
```

Opens `http://localhost:3000`. Vite proxies `/api/*` to `:8000` and
`/ws/*` similarly, so the frontend doesn't need `VITE_API_URL`.

### Optional Android/iOS packaging via Capacitor

If you want a native shell around the same React app:

```bash
cd frontend
npm run mobile:doctor
npm run mobile:add:android
npm run mobile:android
```

Useful commands:

- `npm run mobile:sync` â€” rebuild the web app and sync native assets
- `npm run mobile:copy` â€” rebuild and copy only the web bundle
- `npm run mobile:open:android` â€” reopen the generated Android project
- `npm run mobile:add:ios` / `npm run mobile:ios` â€” iOS setup + open
  flow (**macOS only**)

`mobile:add:*` is a one-time command per platform. After that, the
usual loop is `npm run mobile:sync` and then build/run from Android
Studio or Xcode.

### One-shot via Docker Compose

If you'd rather run one command:

```bash
docker compose up --build
```

First run takes ~10 min because the backend image pre-downloads the
HF model. Subsequent builds are cached. Set
`SKIP_MODEL_DOWNLOAD=1` in `.env` to skip it.

---

## 6.5 Common dev workflows

### Make a code change

Both servers hot-reload:
- `uvicorn --reload` watches `app/`.
- `vite` watches `src/`.

### Add a new API endpoint

1. Create or pick a file under `backend/app/routes/`.
2. Define an `APIRouter`.
3. Register it in `backend/app/main.py`:
   ```python
   from .routes import resources, ...
   app.include_router(resources.router)
   ```
4. Run `pytest` — every endpoint is expected to have at least one
   integration test (auth gate + happy path + 404 path).

### Add a new frontend page

1. Create the file under `frontend/src/pages/`.
2. Wire the route in `frontend/src/App.jsx`.
3. Add a translation key for the navbar link in
   `frontend/src/utils/i18n.jsx` (all three languages).
4. Add the link in `frontend/src/components/Navbar.jsx` for both
   desktop and mobile menus.
5. Re-run `npm run lint` to catch missing keys / unused imports.

### Add a translation

Open `frontend/src/utils/i18n.jsx`, add the key under all three
language objects (`en`, `hi`, `pa`). Falling back to English happens
automatically if a key is missing in `hi` / `pa`, but eslint won't
warn you, so add all three.

### Reset the local database

```bash
mongosh "mongodb://localhost:27017/neighbouraid" --eval "db.dropDatabase()"
```

---

## 6.6 Linting

### Backend

```bash
cd backend
ruff check app --select=E9,F63,F7,F82
```

We're deliberately permissive — only show-stopper rules (syntax /
undefined names / import errors) are enforced. Add a `pyproject.toml`
ruff section if you want to widen this.

### Frontend

```bash
cd frontend
npm run lint
```

ESLint with `--max-warnings 0` — any warning fails the build. The
config disables `react/prop-types` and
`react-refresh/only-export-components`; everything else is the
default React + hooks ruleset.

---

## 6.7 IDE notes

Recommended VS Code extensions:
- **Python** + **Pylance** — for the backend.
- **ESLint** + **Tailwind CSS IntelliSense** — for the frontend.
- **Even Better TOML** — for `pyproject.toml` (when you add ruff config).
- **Docker** — for `deploy/vm/docker-compose.yml`.

The repo doesn't ship workspace settings; configure your IDE on
your own.
