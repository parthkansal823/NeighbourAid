# NeighbourAid

[![CI](https://img.shields.io/github/actions/workflow/status/parthkansal823/NeighbourAid/ci.yml?branch=main&label=CI&logo=github)](https://github.com/parthkansal823/NeighbourAid/actions/workflows/ci.yml)
[![Android](https://img.shields.io/github/actions/workflow/status/parthkansal823/NeighbourAid/android.yml?branch=main&label=Android&logo=android)](https://github.com/parthkansal823/NeighbourAid/actions/workflows/android.yml)

Community emergency alerts and everyday help. People report a problem, nearby
volunteers respond, and paid jobs—plumbing, electrical work, repairs and computer
support—have their own board.

- **[Real web app](https://neighbouraid.kansalp-parth.workers.dev/)** — live data works while its backend is running.
- **[Try the fictional demo](https://neighbouraid-demo.kansalp-parth.workers.dev/)** — separate website, Indian sample data, works in desktop and mobile browsers.
- **[Android downloads](https://github.com/parthkansal823/NeighbourAid/releases)** — signed APKs appear here after signing is configured and a release build succeeds. No Play Store account is needed.

> This is coordination software, not an emergency service. For immediate danger,
> call your local emergency number first. The fictional demo cannot place calls.

## What's included

- React/Vite web app and a Capacitor Android package sharing the same UI.
- FastAPI accounts, alerts, volunteer responses, resources, safety check-ins,
  paid-help requests and live WebSocket updates.
- Volunteer-feed search and All/Open/My accepted views. Active critical alerts
  stay visible even when a filter would otherwise hide them.
- Optional preferred visit windows for paid help, shown in each device's local
  time. Requesters and their accepted worker see a private work timeline; the
  worker can record a start and the requester can close the job. These are
  recorded actions, not a booking guarantee, live tracking or payment processing.
- An 11-language interface and a device-local offline report queue. Account
  reports wait for the app to reopen with the original account and a reachable
  server. Anonymous reports can also use best-effort browser Background Sync
  where supported; saving a report is not confirmation of delivery.
- Optional local AI, browser Web Push, inbound WhatsApp and outbound webhooks.
  Each needs its own configuration; none is required to start the app.
  Local models have bounded admission and strict text-output checks; an AI
  timeout or failed address/weather lookup keeps the fallback available.
- Android release notices with a download button. Installation still needs the
  phone owner's confirmation.

## Start the real app with Docker

Install Node.js 22+ and Docker Desktop using Linux containers. Keep the Docker
engine running. The Compose plugin must be 2.24+.

One-time setup, from the repository root:

```powershell
cd frontend
npm ci
npx wrangler login
# Check your account and CONFIG binding first; see DEPLOY.md.
npm run server:setup
# Create .env.production from .env.production.example only if missing.
# Use VITE_EDGE_PROXY=1; leave VITE_API_URL and VITE_WS_URL unset.
npm run deploy
```

Then, whenever you want the real server online:

```powershell
# Run from frontend/ with Docker Desktop open.
npm run server:connect
npm run server:status
npm run server:test
```

`server:connect` starts **MongoDB + FastAPI + cloudflared in Docker**, checks
database readiness, and updates the Worker's tunnel address. The browser and
APK keep using the same public Worker URL. You do not need host Python, a host
MongoDB installation, a host cloudflared executable, or an Atlas account for
this stack.

```powershell
npm run server:backup  # Saves a private database archive in backups/.
npm run server:stop    # Stops containers; keeps database volumes.
```

MongoDB uses a private Docker network with authentication. Neither MongoDB nor
the API publishes a host/LAN port. Generated credentials are in ignored
`deploy/laptop/*.private.*` files; the edge credential is in ignored
`deploy/laptop/edge.env`. Back them up securely along with the database.
Never use `docker compose down --volumes` or prune these volumes unless you
intend to erase the database.

This is a **separate local database**. Existing Atlas records are not moved or
deleted. Docker overrides `MONGO_URL` and `JWT_SECRET` from `backend/.env`;
that optional file is for integrations in this deployment.

For setup, recovery and troubleshooting, read **[DEPLOY.md](DEPLOY.md)**.

## Separate browser demo

The demo uses the real app's shared screens with a local mock API and fictional
Indian alerts, resources, help requests, check-ins and news. It never connects
to the real database. Changes are temporary, not shared between visitors, and
can reset on reload. There is no demo Android package.

```powershell
cd frontend
npm ci
npm run demo:deploy
```

It deploys independently of the real app and needs no backend, tunnel or API
credential. The demo is also built in CI.

The default fictional volunteer is **Ananya Parth**. Real and demo entries
share the same app and Leaflet styles. Map tiles still require an internet
connection; the demo does not include offline map downloads.

## Android APKs and updates

For a local test APK, install JDK 21 and Android SDK platform/build tools 36;
accept the SDK licences yourself. Then:

```powershell
cd frontend
npm run mobile:doctor
npm run mobile:apk
```

Output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
The package supports Android 7.0+ and uses the stable real Worker URL, not a
changing tunnel. The laptop server must still be running for live data.

The Android workflow builds a debug artifact on relevant pushes and pull
requests. With the four signing secrets configured, relevant **main-branch
pushes** also publish a signed GitHub Release containing `app-release.apk`
and its SHA-256 checksum. Version tags (`v*`) can publish named releases too.

Required GitHub repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Without these, main pushes keep the debug artifact but skip signed publication.
A version-tag release without the secrets fails with an explanation. See
[the signing setup](DEPLOY.md#android-signing-and-automatic-releases).

The installed app checks public latest-release metadata when opened and
roughly every four hours while active. A newer version offers **Download
update** or **Later**; GitHub being unavailable does not block app use. This
does not silently install an APK or bypass Android's confirmation.

Keep the same release signing key for updates. A debug APK has a different
signature and may need uninstalling before installing a signed release—send
pending offline reports first. Web UI changes need a web deployment; bundled
Android UI changes need a new APK. A new tunnel alone needs neither.

## Local development without Docker

For source development only: Python 3.11+, Node.js 22+ and a local MongoDB or
Atlas connection. Create a private `backend/.env` using [.env.example](.env.example)
and choose development settings with your own JWT secret.

```powershell
# Terminal 1, from the repository root
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```powershell
# Terminal 2, from the repository root
cd frontend
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Vite proxies to the host backend.
The Docker stack intentionally does not publish port 8000, so this host-dev
workflow is separate from `server:connect`.

## Checks

```powershell
cd frontend
npm run lint
npm test
npm run test:tools
npm run build
npm run demo:build
# With the Docker API/database running:
npm run server:test
```

```powershell
cd backend
.\venv\Scripts\python.exe -m ruff check app --select=E9,F63,F7,F82
.\venv\Scripts\python.exe -m pytest tests/ -q
```

CI tests Python 3.12/3.13, frontend lint/tests and build modes, Docker images,
and an authenticated MongoDB/API integration probe. Dependency audits report
findings but are currently non-blocking. The Android workflow separately
builds the APK; physical-phone testing remains necessary before distribution.

## Layout and limits

```text
backend/app/       FastAPI routes, models and services
frontend/src/      Shared React UI, i18n and browser/native utilities
frontend/android/  Generated Capacitor shell
frontend/worker/   Cloudflare edge proxy
deploy/laptop/     Private-network MongoDB, API and tunnel stack
deploy/vm/         Separate optional Caddy/VM setup (expects external MongoDB)
docs/              Longer technical documentation
```

Run one API worker: volunteer WebSockets are process-local. The laptop must
be awake and online for real requests. Quick Tunnels are for development/testing,
not an always-on emergency-service guarantee. Hospital/maps/routing data comes
from external services with their own coverage and usage limits.

More: [deployment guide](DEPLOY.md), [documentation index](docs/README.md),
[optional models](models/README.md), [proposed next features](docs/11-feature-roadmap.md).
