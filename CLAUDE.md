# NeighbourAid

Community emergency-alert app. Reporters post alerts (optionally anonymously,
optionally offline); volunteers see them on a live map and respond. FastAPI +
MongoDB backend, React/Vite frontend, Capacitor android shell.

## Layout

- `backend/app/` — FastAPI. `routes/` endpoints, `services/` logic (AI triage,
  geocode, news, websocket), `models/` pydantic schemas, `db/client.py` Mongo.
- `frontend/src/` — React 19. `pages/` routes, `components/`, `utils/`,
  `hooks/`, `i18n/` (8 languages).
- `frontend/android/` — generated Capacitor shell. Not hand-edited.
- `docs/` — the long-form documentation; `README.md` and `DEPLOY.md` at root.

## Commands

Backend (from `backend/`, using the venv interpreter directly — there is no
activate step in this workflow):

    ./venv/Scripts/python.exe -m pytest tests/ -q
    ./venv/Scripts/python.exe -m ruff check app

Frontend (from `frontend/`):

    npm run lint     # eslint, --max-warnings 0
    npm test         # vitest
    npm run build    # vite

## Things that bite

- **This machine has only Python 3.11**; CI runs the backend on 3.12 and 3.13,
  so a version-specific break can pass locally and still fail CI. If
  `backend/venv` ever errors with a missing `pythoncore-3.14` path, it was
  built by an interpreter that is gone: rebuild with `python -m venv venv
  --clear`, then reinstall `requirements.txt` plus `ruff` and `pytest-cov`.
- **PyMongo's async driver returns a coroutine from `aggregate()`**, unlike the
  Motor driver it replaced. A missing `await` there does not raise — the
  `async for` just iterates nothing and the endpoint quietly returns empty.
  Both occurrences in `routes/stats.py` are commented for this reason.
- **`pytest.ini` turns our own DeprecationWarnings into errors** (`app.*` only).
  Third-party deprecations stay warnings.
- **ESLint escalates `no-undef` / `react/jsx-no-undef` to errors** on purpose —
  a missing import used to reach the build instead of failing lint.
- `/post-alert` is deliberately public; `POST /api/alerts/anonymous` backs it.
- Secrets live in `.env` and `backend/.env`, both gitignored and both denied to
  Claude in `.claude/settings.json`.

## Tooling in this repo

- `.mcp.json` — graphify (code graph), context7 (library docs), github,
  chrome-devtools. **graphify and github need a one-time OAuth sign-in**: run
  `/mcp` in an interactive session and authorize them, or their tools stay
  unavailable. context7 and chrome-devtools need nothing.
  A mongodb server was configured and removed: it reads its connection string
  from `${MONGO_URL}`, which lives in `backend/.env` and so is never in Claude
  Code's environment, leaving it to hang for the full 30s connect timeout on
  every session start. To restore it, first export `MONGO_URL` in the OS
  environment (not a `.env` file), then re-add the entry.
- `.claude/hooks/` — ruff on backend writes, eslint on frontend writes
  (fails the turn with the eslint output so it gets fixed immediately),
  toolchain health at session start.
- `.ignore` — keeps code search out of the committed build bundles.
