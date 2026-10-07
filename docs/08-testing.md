# 8. Testing

The project has **143 tests** total: 99 backend (pytest) + 44 frontend
(Vitest). Both suites run in CI on every push/PR.

---

## 8.1 Backend (pytest)

### Running

```bash
cd backend
pytest tests/ -v
```

tests exercise the keyword-fallback path explicitly, so this is
correct in CI and dev.

### With coverage

```bash
pytest tests/ -v --cov=app --cov-report=term --cov-report=html
open htmlcov/index.html   # macOS; or just open it in a browser
```

Current overall coverage: **~67 %**. Big gaps are intentional:
- `services/photo.py` — only the `analyze_photos` happy path is
  covered; Pillow corner cases would need real test fixtures.
- `services/news.py` — RSS scraping is mocked, the full network
  fetch path isn't covered.
- `services/geocode.py` / `weather.py` — external HTTP, mocked at
  call sites in routes.

### Test files

| File | What it covers |
|---|---|
| `test_auth.py` | register, login, validation |
| `test_alerts.py` | CRUD, role guards, witness, invalid IDs, share-link, heatmap, ETA |
| `test_endpoints_extras.py` | photos endpoint, flag endpoint, profile patch, webhook payload |
| `test_new_features.py` | trust score, escalation, rate limiter, resources, inbound, responder tracking |
| `test_news_service.py` | authenticity scoring, topic detection, domain matching |
| `test_photo_service.py` | photo evidence pipeline (Pillow real images) |
| `test_stats_users.py` | landing-page stats, user me, news endpoint |
| `test_verification.py` | composite scoring, weather match, AI heuristic fallback |
| `test_websocket_routing.py` | `ConnectionManager` skill-aware broadcast |

### Mock pattern

`tests/conftest.py` provides a `client` fixture that swaps the
real Mongo client for a `MagicMock`. Tests configure individual
mocked methods per case — e.g.:

```python
db.alerts.find_one = AsyncMock(return_value={"_id": ObjectId(), ...})
db.alerts.insert_one = AsyncMock(return_value=MagicMock(inserted_id=ObjectId()))
```

For cursors, build a chainable `MagicMock` whose `.sort` / `.limit`
methods return an async generator. Pattern is repeated several
times in `test_alerts.py` — copy-paste it.

### Running a single test

```bash
pytest tests/test_alerts.py::test_get_nearby_is_public -v
```

### Markers

The suite uses `pytest-asyncio` with `asyncio_mode = auto` (set in
`pytest.ini`), so any `async def test_*` is auto-marked. No need to
add `@pytest.mark.asyncio` manually on async tests.

---

## 8.2 Frontend (Vitest + Testing Library)

### Running

```bash
cd frontend
npm test            # one-shot
npm run test:watch  # interactive watch mode
```

### Test files

| File | What it covers |
|---|---|
| `utils/error.test.js` | apiError flattening, axios shapes |
| `utils/translate.test.js` | gtx success, cache, fallback, LS persistence |
| `utils/photo.test.js` | approxKb, compress non-image rejection |
| `utils/offlineQueue.test.js` | enqueue, retry, drop after 10 attempts |
| `utils/i18n.test.jsx` | language switch, fallback to English |
| `hooks/useVoiceAlert.test.js` | locale mapping, supported flag, default-on, persistence |
| `components/Button.test.jsx` | variants, loading, disabled |
| `components/Skeleton.test.jsx` | shimmer primitive, list role |
| `components/AutoDispatch.test.jsx` | category-specific tel: links |

### How the test environment is set up

`src/test/setup.js` runs before every test file. It:

- Adds `@testing-library/jest-dom` matchers (`toBeInTheDocument`, etc).
- Stubs jsdom holes:
  - `matchMedia`
  - `IntersectionObserver`
  - `<canvas>` `getContext` / `toDataURL`
  - `FileReader.readAsDataURL`
  - `<img>.src` (auto-fires onload with default 800×600 dims)
  - `navigator.geolocation`
  - `Notification`
  - `SpeechRecognition`
- Resets `localStorage` and `sessionStorage` between tests via
  `afterEach(cleanup)`.

`fake-indexeddb` is auto-imported in `offlineQueue.test.js` so the
IDB-backed queue is testable without a real browser.

### Patterns

**Component tests** use Testing Library's user-centric queries:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

render(<Button onClick={onClick}>Go</Button>)
await userEvent.click(screen.getByRole('button'))
```

**Hook tests** use `renderHook` + `act`:

```js
import { renderHook, act } from '@testing-library/react'

const { result } = renderHook(() => useVoiceAlert())
act(() => result.current.setEnabled(false))
```

**Network calls** mock `global.fetch`:

```js
global.fetch = vi.fn(async () => ({
  ok: true,
  json: async () => [...],
}))
```

---

## 8.3 CI

The workflow is at `.github/workflows/ci.yml`. Five checks:

1. **`backend-test`** — matrix on Python 3.12 + 3.13. Installs deps,
   runs ruff (`E9,F63,F7,F82` only — show-stoppers), pytest with
   coverage and JUnit reports, retained even when tests fail.
2. **`frontend-lint`** — Node 22, `npm ci`, lint, **`npm test`**,
   `npm run test:tools`, private-file guard, direct-API/edge/demo builds;
   validates Worker packaging with a credential-free Wrangler dry run and
   uploads the real edge `dist/` with tested SHA/run metadata as an artifact.
3. **`security-audit`** — Python and npm run independently. Known Python
   vulnerabilities and high/critical browser-runtime vulnerabilities block CI.
   Full npm tooling findings appear in the summary and report artifact;
   audit-service errors fail instead of silently passing.
4. **`workflow-lint`** — checksum-verified actionlint checks workflow syntax,
   expressions and jobs; Node tests exercise release/deployment safety policies.
5. **`ci-success`** — stable required check, fails if any prerequisite failed,
   was cancelled or was skipped. Use it in branch protection/merge queues.

CI does not build Docker images, start containers or deploy a backend. The API,
MongoDB and tunnel run only on the laptop. With that stack online, run
`npm run server:test` from `frontend/` for auth/readiness checks; optionally use
`-- --restart` when a brief API/database interruption is acceptable to verify
persistence. These local integration tests are not part of CI.

`concurrency` is set so push spam cancels in-flight runs of the
same ref. `permissions: contents: read` keeps the runner least-priv.

Production uses the exact edge artifact from current-main successful CI. Manual
deployments require the same successful commit/run and stale runs are rejected.
CI tools are pinned in `backend/requirements-ci.txt`; external actions are pinned
to immutable SHAs, and Dependabot proposes updates weekly.

The separate Android workflow builds debug APKs, and publishes signed APKs on
relevant `main` pushes, `v*` tag pushes or manual `main` runs when all four signing
secrets are configured and main CI passed for the exact release commit. PRs and
manual runs on other branches cannot publish. Gradle wrapper validation and
read-only signed caches protect signing; private signing files are always removed.
`frontend/scripts/workflows.test.mjs` checks the actual release condition and
runs `.github/scripts/check-android-signing.sh` with fake credentials. Explicit
releases fail on missing secret names; ordinary main pushes warn and retain
their debug artifact. Tests also guard the local-only backend policy: no Docker
CI job or remote hosting configs, while the laptop API/database/tunnel remain.

---

## 8.4 Adding a new test

### Backend

1. Pick or create `tests/test_<area>.py`.
2. If the test needs the FastAPI client, accept the `client`
   fixture: `async def test_x(client): c, db = client; ...`.
3. Mock any DB call you actually use. Don't mock things the route
   doesn't touch — the test will pass without you noticing the
   mock is wrong.
4. Run `pytest tests/test_<area>.py::test_x -v` until green.

### Frontend

1. Place the test next to the file it covers, named `*.test.js` or
   `*.test.jsx`.
2. If the file imports something jsdom doesn't ship (Web Speech,
   etc.), add a stub to `src/test/setup.js`.
3. Run `npm test`.

---

## 8.5 What's *not* tested

Be aware of these gaps:

- **Real browser smoke test** — there's no Cypress / Playwright
  suite. The Service Worker, Leaflet map, geolocation, and
  notification permission flows aren't exercised end-to-end.
- **Real WebSocket roundtrip** — the `ConnectionManager` is
  unit-tested, but the FastAPI WebSocket endpoint glue (auth →
  first-frame parsing → register) only has integration coverage
  via manual smoke testing.
- **Photo compression on realistic JPEGs** — the test stubs
  `<canvas>.toDataURL` to a fixed string, so we don't actually
  measure the budget loop's behaviour on real images.

If you're tightening the test surface, those are the next three
places to look.
