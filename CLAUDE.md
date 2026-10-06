# NeighbourAid

Community emergency-alert app. Reporters post alerts (optionally anonymously,
optionally offline); volunteers see them on a live map and respond. FastAPI +
MongoDB backend, React/Vite frontend, Capacitor android shell.

## Layout

- `backend/app/` — FastAPI. `routes/` endpoints, `services/` logic (AI triage,
  geocode, news, websocket), `models/` pydantic schemas, `db/client.py` Mongo.
- `frontend/src/` — React 19. `pages/` routes, `components/`, `utils/`,
  `hooks/`, `i18n/` (11 languages).
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

## Local models (all optional, all off by default)

Triage works with no model at all. Each of these is additive and degrades to
the previous behaviour when its weights are absent:

- `LLM_MODEL_PATH` — text model, consulted only where the keyword classifier
  matched nothing (`urgency_reason == "keyword:default"`, ~20% of reports).
  Raises urgency on implied danger, and rewrites truncated headlines.
  Measured with `python -m tests.eval_hybrid`.
- `LLM_VISION_MODEL_PATH` + `LLM_VISION_MMPROJ_PATH` — vision model. Captions
  an attached photo; `vision.verdict_for` decides whether the caption matches
  the claimed category, and only a clear contradiction subtracts points.

Both run inside background enrichment, never on the request path, and
`NA_DISABLE_AI_MODEL=1` turns off every one of them.

## Tooling in this repo

- `.mcp.json` — graphify only. It indexes the repo's call/dependency graph and
  answers "who calls this / what breaks if I change it" without reading files.
  Needs a one-time OAuth sign-in: run `/mcp` and authorize it. context7,
  github and chrome-devtools were configured here and removed — none of them
  got used, and every connected server's tool schemas load on every turn.
- `.claude/hooks/` — on every backend write, ruff runs the same four rules CI
  gates on (E9,F63,F7,F82) and fails the turn with its output; same idea for
  eslint on frontend writes. Deliberately not a formatter: this codebase is
  knowingly not ruff-clean, so `--fix` would bury real changes under
  reformatting.
- `.ignore` — keeps code search out of the committed build bundles.
