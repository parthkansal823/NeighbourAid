# NeighbourAid — Hyperlocal Crisis & Help Network

[![CI](https://img.shields.io/github/actions/workflow/status/parthkansal823/NeighbourAid/ci.yml?branch=main&label=CI&logo=github)](https://github.com/parthkansal823/NeighbourAid/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-143_passing-brightgreen)](docs/08-testing.md)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)](backend/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)](backend/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](frontend/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](frontend/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6-47A248?logo=mongodb&logoColor=white)](deploy/vm/docker-compose.yml)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](frontend/public/manifest.webmanifest)

> Real-time, multi-source-verified community crisis response for India.
> Reporters post (text, GPS, optional photos, voice). AI triages
> urgency locally. Skill-matched volunteers nearby are paged over
> WebSockets. Every alert is cross-checked against community
> witnesses, corroborating reports, live weather, and photo evidence
> — on a free, open-source, zero-API-key stack.

---

## Table of contents

- [Why NeighbourAid](#why-neighbouraid)
- [Features at a glance](#features-at-a-glance)
- [Quick start](#quick-start)
- [Tech stack](#tech-stack)
- [Architecture (one-glance)](#architecture-one-glance)
- [API surface](#api-surface)
- [Documentation](#documentation)
- [Testing](#testing)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Roadmap](#roadmap)

---

## Why NeighbourAid

When something bad happens in an Indian neighbourhood, the typical
response is to call **100 / 108 / 101** and forward a panicked
WhatsApp message into a few housing-society groups. There is no
**structured, geolocated, verified** way to reach the nearest
*willing* helpers in real time.

NeighbourAid closes that gap with five ideas that no existing tool
combines:

1. **Hyperlocal volunteer dispatch** — WebSocket fan-out to volunteers
   within 5 km of the incident; extends to 15 km when the alert
   category matches the volunteer's skill set.
2. **AI urgency triage on-device** — `facebook/bart-large-mnli` runs
   inside the backend container. Zero-shot classification into
   `CRITICAL / HIGH / MEDIUM / LOW` plus vulnerability + time-
   sensitivity + language detection. No paid AI APIs.
3. **Multi-source verification** — composite `verified_score (0–100)`
   blends community witnesses, corroborating reports, live weather,
   and photo evidence.
4. **Built for India** — trilingual UI (English / हिन्दी / ਪੰਜਾਬੀ)
   with auto-translation of user content, India emergency dialer
   (112 / 100 / 108 / 101 / 1091 / 1098), and category-specific
   one-tap dispatch.
5. **Free and offline-tolerant** — no paid dependencies. Alerts can
   be queued in IndexedDB during outages and auto-deliver on
   reconnect.

---

## Features at a glance

### Reporting
- 📝 **Post a crisis** with category, free-text description, GPS,
  and up to **3 photos** (auto-compressed under 300 KB each).
- 🆘 **Quick SOS** — one-tap critical broadcast (~3 s panic-to-feed).
- 🎤 **Voice dictation** — Web Speech API in `en-IN` / `hi-IN` / `pa-IN`.
- 📡 **Offline alert queue** — IndexedDB-backed retry on reconnect,
  app-wide flusher.
- 🕶 **Anonymous reporting** — `POST /api/alerts/anonymous`,
  rate-limited 10/h per IP, for sensitive cases.

### Volunteer
- 🛟 **Live WebSocket feed** with audio ping + toast + native
  notification.
- ✨ **Skill-aware routing** — alerts within 5 km always; 15 km if
  the alert category matches your skills (medical / CPR / swim /
  driver / electrician / translator / elderly-care / child-care).
- 🚗 **Vehicle flag + ETA broadcast** so duplicate responders don't
  pile on.
- 🎯 **Trust score** — `resolved ÷ accepted` with sample-size
  smoothing, surfaced as `trusted / reliable / new / unproven` on
  the leaderboard and profile.
- 🔊 **Voice TTS for CRITICAL alerts** — hands-free for drivers,
  joggers, on-call.
- 💬 **Situational updates** + 👥 **witness button** within 2 km.

### Map
- 🗺 **Live map** (Leaflet + OSM) with urgency + category filters,
  15 s auto-refresh, urgency-coloured pins, reverse-geocoded
  addresses.
- 📍 **Live user marker** with accuracy circle. Map follows only
  when the user has moved >10 m (no GPS jitter).
- 🔥 **Heatmap overlay** (toggleable) — dependency-free canvas
  layer, 72 h density weighted by urgency × verification.
- 🧭 **One-tap directions** — Google Maps with the alert as
  destination.

### Trust & moderation
- 🚩 **Community flag** — idempotent. ≥3 flags soft-hide an alert.
- ⏰ **Auto-resolve** — open unaccepted alerts >24 h auto-resolve on
  the next list read (no cron).
- 📈 **Auto-escalation** — MEDIUM → HIGH after 10 min, HIGH →
  CRITICAL after 4 min, with rebroadcast.
- 🏠 **Witness proof of locality** — saved home location must be
  within 2 km of the alert.

### Reach
- 🔗 **Share via link / WhatsApp / QR** — Web Share API with a
  modal fallback (copy, WhatsApp deep link, QR code).
- 🌐 **Public `/alert/:id` page** — anyone with the link can view,
  no account required.
- 📲 **WhatsApp inbound webhook** — `POST /api/inbound/whatsapp`
  accepts gateway payloads (Twilio sandbox, n8n WhatsApp Cloud,
  Gupshup) so users without the app can still report.
- 🤝 **Buddy ping** — saved emergency contacts render as one-tap
  `sms:` / `mailto:` chips on SOS and "I need help" check-ins. No
  paid SMS provider needed.

### Resources & community
- 🏠 **Resource map** — community-pinned shelter, food, blood,
  oxygen, water, medical-camp pins. TTL-expired so the map stays
  current. Owner-only delete.
- ✅ **Safety check-ins** — "I'm safe" / "I need help", 10 km
  visibility, 24 h auto-expiry.

### Live tracking (Uber-style)
- 🚦 **Responder tracker** on accepted alerts — small Leaflet map
  on the reporter's "My Alerts" with the volunteer's live position
  + ETA. Privacy-gated: only the reporter and the accepting
  volunteer can read; coords disappear the moment the alert
  resolves.

### Communication
- 🌍 **Trilingual UI** — English / हिन्दी / ਪੰਜਾਬੀ. Picker in
  navbar, persisted in `localStorage`, auto-detected from browser
  locale on first run.
- ⇄ **Auto-translation** of user-generated content to the viewer's
  language. Free Google `translate_a/single` endpoint, persistent
  `localStorage` cache, toggleable preference.
- 🔔 **Native notifications via Service Worker** — survive tab
  close, support an "Open alert" action button. CRITICAL alerts
  are sticky (`requireInteraction`).
- 📞 **🆘 Emergency dialer** floating on every page →
  112 / 100 / 108 / 101 / 1091 / 1098.
- 🚒 **Auto-dispatch strip** on CRITICAL/HIGH cards — category-
  specific one-tap call buttons (108 ambulance for medical, 101
  fire, 1078 NDRF flood, 100 / 1098 / 1091, 1912 power, 112
  fallback).

### Trust & news
- 📰 **Crisis news feed** scraped every 5 min from The Hindu / NDTV
  / Hindustan Times / Times of India, filtered for crisis keywords.
- 💯 **Authenticity score (0–100)** per item — source trust + domain
  match + freshness + clickbait penalty. Items below 55 are dropped
  entirely.
- 🏷 **Topic chips** (fire / flood / accident / medical / …) on
  every news card.

### Integrations
- 🔌 **n8n / Zapier / Make outbound webhook** — set `ALERT_WEBHOOK_URL`
  and the backend POSTs a compact JSON payload on every new alert.
  Fan out to WhatsApp, Slack, email, SMS, sheet logging.

### Robustness
- 🛡 **Graceful AI fallback** — keyword heuristic produces a full
  triage payload if HF can't load.
- ⚠️ **Global exception handler** — Pydantic errors flattened, all
  5xxs logged with stack, never leaked to clients.
- 🧱 **ErrorBoundary** in the React tree.
- 🔐 **401 auto-logout** via axios interceptor.
- 🆔 **Robust ID parsing** — every `{alert_id}` route returns 400,
  never 500, on a malformed ID.
- ✅ **143 tests** — 99 backend (pytest) + 44 frontend (Vitest).

---

## Quick start

### Prereqs
- Python 3.11+, Node.js 18+, MongoDB 6 (Docker or Atlas free tier)

### Local dev (no Docker)

```bash
# 1. Backend
cd backend
python -m venv venv
./venv/Scripts/pip install -r requirements.txt    # macOS/Linux: venv/bin/pip

# 2. Frontend
cd ../frontend
npm install

# 3. MongoDB (separate terminal)
docker run -d --name mongo -p 27017:27017 -v mongo_data:/data/db mongo:6

# 4. Backend (skip 1.6 GB HF model in dev)
cd ../backend
NA_DISABLE_AI_MODEL=1 python -m uvicorn app.main:app --reload --port 8000

# 5. Frontend
cd ../frontend
npm run dev
```

Open `http://localhost:3000`. Vite proxies `/api` and `/ws` to `:8000`.
API docs at `http://localhost:8000/docs`.

### Full stack via Docker

```bash
cp .env.example .env
docker compose up --build
```

First build is ~10 min (HF model pre-download). Set
`SKIP_MODEL_DOWNLOAD=1` in `.env` to skip it.

### One-command Ubuntu VM

```bash
git clone https://github.com/pk23nk21/NeighbourAid.git
cd NeighbourAid && bash deploy/vm/setup.sh
```

Works on AWS Lightsail, EC2, Oracle Always Free, DigitalOcean,
Hetzner — anywhere with Docker.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React 18 + Vite + TailwindCSS** | Fast HMR, tiny bundle (~156 KB gzipped) |
| Maps | **Leaflet + react-leaflet + OSM tiles** | Free, no API key |
| Backend | **FastAPI + Uvicorn/Gunicorn** | Async, WebSockets, auto OpenAPI |
| Database | **MongoDB 6 + Motor** | 2dsphere geospatial index for `$nearSphere` |
| AI triage | **HF Transformers + `bart-large-mnli`** | Zero-shot, runs locally, no paid API |
| Photo eval | **Pillow** | Decode + verify, no vision model |
| Translation | **Google `translate_a/single` (key-less)** | Optional, falls back to original |
| Auth | **python-jose (JWT) + bcrypt** | Stateless |
| External APIs (free) | **OSM Nominatim, Open-Meteo** | Reverse geocoding + weather |
| PWA | **Vite manifest + Service Worker** | Installable, SW-routed notifications |
| Container | **Docker + docker-compose** | One-command local + prod |
| CI | **GitHub Actions** | Multi-version pytest + ruff + lint + Vitest + Docker + audit |
| Deploy | **Any Docker VM** (DigitalOcean, EC2, …) + Cloudflare for the frontend | `deploy/vm/setup.sh` installs Docker and Caddy with automatic HTTPS |

---

## Architecture (one-glance)

```
         ┌────────────────────────┐
         │    Frontend (Vite)     │
         │  React 18 · Tailwind   │
         │  Leaflet · IndexedDB   │
         │  Service Worker · PWA  │
         └───────────┬────────────┘
            HTTPS    │   WebSocket
                     │
   ┌─────────────────┴──────────────┐
   │  FastAPI backend                │
   │  ─ AI triage (HF + heuristic)   │
   │  ─ Photo eval (Pillow)          │
   │  ─ Verification scoring         │
   │  ─ Skill-aware WS broadcast     │
   │  ─ Outbound webhook (n8n)       │
   └─────────┬──────────────┬────────┘
             ▼              ▼
        ┌────────┐  ┌──────────────────┐
        │ Mongo  │  │  External (free) │
        │ 2dsphere│  │  · Nominatim     │
        │ +TTL   │  │  · Open-Meteo    │
        └────────┘  │  · gtx translate │
                    └──────────────────┘
```

For a deeper walk-through see [docs/03-architecture.md](docs/03-architecture.md).

---

## API surface

> Interactive Swagger UI at **`/docs`** on any running backend.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create user (with optional skills + emergency contacts) |
| POST | `/api/auth/login` | public | Exchange creds for JWT |
| GET | `/api/alerts/nearby` | public | Active alerts within radius (photos stripped) |
| GET | `/api/alerts/heatmap` | public | Density points for the map heatmap |
| GET | `/api/alerts/mine` | reporter | My posted alerts |
| POST | `/api/alerts/` | reporter | Create alert (with optional photos) |
| POST | `/api/alerts/anonymous` | public, rate-limited | Anonymous tip |
| GET | `/api/alerts/{id}` | public | Single alert (used by share link) |
| GET | `/api/alerts/{id}/photos` | public | Lazy-loaded photo payload |
| GET | `/api/alerts/{id}/responder` | reporter or accepting volunteer | Live volunteer position |
| GET | `/api/alerts/{id}/updates` | auth | Situational updates timeline |
| POST | `/api/alerts/{id}/updates` | auth | Post a 3–500 char update |
| POST | `/api/alerts/{id}/witness` | auth, ≤2 km | "I see this too" |
| POST | `/api/alerts/{id}/flag` | auth | Flag as fake/spam |
| PATCH | `/api/alerts/{id}/accept` | volunteer | Take ownership |
| PATCH | `/api/alerts/{id}/eta` | volunteer | Publish ETA in minutes |
| PATCH | `/api/alerts/{id}/resolve` | volunteer | Resolve accepted alert |
| DELETE | `/api/alerts/{id}` | reporter | Cancel an open alert |
| POST | `/api/safety/` | auth | I'm safe / need help |
| GET | `/api/safety/near` | public | Nearby check-ins |
| GET | `/api/safety/me` | auth | My check-in |
| POST | `/api/resources/` | auth | Pin a community resource |
| GET | `/api/resources/near` | public | Nearby resource pins |
| DELETE | `/api/resources/{id}` | owner | Remove your pin |
| GET | `/api/news/recent` | public | Crisis news, sorted by authenticity score |
| GET | `/api/users/me` | auth | My profile |
| PATCH | `/api/users/me/location` | auth | Update home location |
| PATCH | `/api/users/me/profile` | auth | Patch skills / vehicle / contacts |
| GET | `/api/users/me/stats` | auth | Activity + trust score |
| GET | `/api/stats/` | public | Landing-page counters |
| GET | `/api/stats/leaderboard` | public | Top volunteers + trust |
| POST | `/api/inbound/whatsapp` | shared-secret | WhatsApp gateway → alert |
| WS | `/ws/volunteer?token=…` | volunteer | Real-time alert feed; first frame `{coordinates:[lng,lat]}` |
| GET | `/health` | public | Liveness probe |

Full reference with bodies, error codes, and rate limits:
[docs/05-api-reference.md](docs/05-api-reference.md).

---

## Documentation

The [`docs/`](docs/) folder is a 10-part long-form companion to this
README — read it in order or pick the file you need.

| File | Read this if you… |
|---|---|
| [01-overview.md](docs/01-overview.md) | are new and want the 5-minute tour |
| [02-user-guide.md](docs/02-user-guide.md) | are a reporter or volunteer using the app |
| [03-architecture.md](docs/03-architecture.md) | want to understand how the pieces fit together |
| [04-feature-deep-dive.md](docs/04-feature-deep-dive.md) | want exactly how a single feature works |
| [05-api-reference.md](docs/05-api-reference.md) | are integrating with the backend |
| [06-development.md](docs/06-development.md) | are running it locally for the first time |
| [07-deployment.md](docs/07-deployment.md) | are shipping to production |
| [08-testing.md](docs/08-testing.md) | are writing or running tests |
| [09-troubleshooting.md](docs/09-troubleshooting.md) | hit a problem and need a quick fix |
| [10-glossary.md](docs/10-glossary.md) | see a term and don't know what it means |

---

## Testing

```bash
# Backend (99 tests)
cd backend
NA_DISABLE_AI_MODEL=1 pytest tests/ -v

# Frontend (44 tests)
cd frontend
npm test
```

Coverage of the test suite (more in [docs/08-testing.md](docs/08-testing.md)):

- ✅ Auth (register / login / role guards)
- ✅ Alert CRUD (cancel / accept / eta / resolve / witness / flag)
- ✅ Invalid-ID handling on every `{alert_id}` route (400, never 500)
- ✅ Verification scoring (each source capped, total clamped 100)
- ✅ Photo evidence pipeline (real Pillow images)
- ✅ News authenticity scoring + topic detection
- ✅ Skill-aware WebSocket broadcast (`ConnectionManager`)
- ✅ Trust-score Bayesian smoothing
- ✅ Auto-escalation no-op on fresh alerts
- ✅ Anonymous-report rate limiter (under-cap, key isolation, reset)
- ✅ Resource map (auth, persist, public list, invalid id)
- ✅ Inbound WhatsApp (disabled when token unset, wrong-token rejection)
- ✅ Live responder tracking (privacy + status gating)
- ✅ Frontend utils — translate, photo, offlineQueue, error, i18n
- ✅ Frontend components — Button, Skeleton, AutoDispatch
- ✅ Frontend hooks — useVoiceAlert

CI runs on every push + PR across **Python 3.11 and 3.12**, with a
non-blocking `pip-audit` + `npm audit` security scan and Docker
build cache.

---

## Deployment

### Recommended — Cloudflare Pages + HuggingFace Spaces + MongoDB Atlas (no credit card)

The whole stack runs on free tiers that don't ask for a card. See
[docs/07-deployment.md](docs/07-deployment.md) for the full
click-by-click guide. Summary:

- **MongoDB Atlas M0** (Mumbai) → connection string into
  `MONGO_URL`.
- **HuggingFace Spaces** with the **Docker SDK** → 2 vCPU + 16 GB
  RAM, supports WebSockets, never sleeps. Push `backend/` into the
  Space's git repo, set `JWT_SECRET` + `MONGO_URL` + `FRONTEND_ORIGINS`
  in the Space secrets. The Dockerfile honours `$PORT` so it works
  on HF Spaces (7860), Render (10000), Railway, or local (8000)
  without changes.
- **Cloudflare Pages** → connect the GitHub repo, set Root directory
  to `frontend/`, add env vars
  `VITE_API_URL=https://<owner>-<space>.hf.space` and
  `VITE_WS_URL=wss://<owner>-<space>.hf.space`. The repo ships
  `_redirects` + `_headers` in `frontend/public/` so SPA routing and
  edge security headers Just Work. Cloudflare's Indian PoPs (5+
  cities) give you the lowest latency for your users.

### One-command Ubuntu

```bash
git clone https://github.com/pk23nk21/NeighbourAid.git
cd NeighbourAid && bash deploy/vm/setup.sh
```

[`deploy/vm/setup.sh`](deploy/vm/setup.sh) is idempotent — installs Docker, clones
the repo, generates `JWT_SECRET`, runs `docker compose up -d`.

---

## Mobile app commands

The mobile build path now uses **Capacitor on top of the existing
Vite app**, so the web and mobile shells share the same React codebase.

From `frontend/`:

```bash
npm run mobile:doctor
npm run mobile:add:android
npm run mobile:android
```

Useful commands:

- `npm run mobile:doctor` validates the local Capacitor setup
- `npm run mobile:add:android` creates the native Android project
  (run once)
- `npm run mobile:android` builds the web app, syncs assets/plugins,
  and opens Android Studio
- `npm run mobile:sync` rebuilds and resyncs after frontend changes
- `npm run mobile:copy` rebuilds and copies only the web bundle
- `npm run mobile:add:ios` / `npm run mobile:ios` provide the same flow
  for iOS (**macOS only**)

Requirements:

- Android: Android Studio + Android SDK
- iOS: Xcode on macOS
- PWA install still works for users who do not need the native wrapper

---

## Environment variables

| Variable | Where | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | backend | `dev-secret-change-in-production` | **Override in prod** |
| `MONGO_URL` | backend | `mongodb://localhost:27017/neighbouraid` | Atlas string works |
| `NA_DISABLE_AI_MODEL` | backend | `0` | `1` to skip the 1.6 GB HF model |
| `FRONTEND_ORIGINS` | backend | empty | Extra CORS origins, comma-separated |
| `ALERT_WEBHOOK_URL` | backend | empty | Outbound n8n / Zapier / Make webhook on alert create |
| `ALERT_WEBHOOK_TIMEOUT_SECONDS` | backend | `4.0` | Hard cap on the webhook POST |
| `INBOUND_TOKEN` | backend | empty | Shared secret for `/api/inbound/whatsapp`; empty disables the route |
| `SKIP_MODEL_DOWNLOAD` | backend Docker build arg | `0` | `1` to skip model in `docker build` |
| `VITE_API_URL` | frontend | empty | Absolute backend URL in prod |
| `VITE_WS_URL` | frontend | empty | Absolute WS URL in prod (e.g. `wss://api.example.com`) |

Copy `.env.example` → `.env` for local dev.

---

## Roadmap

- [ ] **NDRF/IMD feed ingestion** — auto-generate alerts from official
  disaster feeds
- [ ] **True web push** — VAPID + push subscriptions for delivery to
  closed tabs
- [ ] **More languages** — Tamil, Bengali, Telugu, Marathi
- [ ] **Volunteer reputation** beyond resolved/accepted ratio (NPS-style
  reporter rating?)
- [ ] **Deeper native mobile features** — offline-first Android polish,
  richer notifications, and low-connectivity optimisations
- [ ] **Kubernetes manifests** — horizontal scale across regions
- [ ] **Fine-tuned HF model** on Indian crisis text corpus
- [ ] **End-to-end browser tests** (Playwright) for the SW + map +
  geolocation flows
