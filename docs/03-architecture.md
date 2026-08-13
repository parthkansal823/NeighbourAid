# 3. Architecture

How NeighbourAid is put together. This page is the "where do I look"
map; for "how does feature X work", see [04-feature-deep-dive.md].

---

## 3.1 Top-level shape

```
                    ┌────────────────────────┐
                    │    Frontend (Vite)     │
                    │  React 18 · Tailwind   │
                    │  Leaflet · IndexedDB   │
                    │  Service Worker · PWA  │
                    └───────────┬────────────┘
                       HTTPS    │   WebSocket
                                │
         ┌──────────────────────┴──────────────────────┐
         ▼                                             ▼
┌────────────────┐                          ┌──────────────────────┐
│  REST API      │                          │  /ws/volunteer       │
│  /api/auth     │                          │  per-volunteer       │
│  /api/alerts   │                          │  socket; first frame │
│  /api/users    │                          │  is coords, then any │
│  /api/safety   │                          │  number of coord     │
│  /api/news     │                          │  updates without     │
│  /api/stats    │                          │  reconnecting        │
│  /api/resources│                          └──────────┬───────────┘
│  /api/inbound  │                                     │
└────────┬───────┘                                     │
         │  FastAPI (Python 3.11+)                     │
         ▼                                             │
┌──────────────────────────────────────────────────────┴─────────┐
│  Backend services                                              │
│                                                                │
│  ai.py           HF zero-shot triage + heuristic fallback      │
│  geocode.py      OSM Nominatim reverse geocoding               │
│  weather.py      Open-Meteo weather + category-match rules     │
│  verification.py composite verified_score                      │
│  photo.py        Pillow validation + evidence scoring          │
│  news.py         RSS scrape + authenticity scoring             │
│  websocket.py    in-memory ConnectionManager (skill routing)   │
│  webhook.py      outbound n8n/Zapier dispatch                  │
│  ratelimit.py    token-bucket per-IP rate limiter              │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
                        ┌──────────────┐
                        │  MongoDB 6   │
                        │  collections:│
                        │  · users     │
                        │  · alerts    │
                        │  · alert_updates
                        │  · safety_checkins
                        │  · resources │
                        │  TTL on:     │
                        │  · safety, resources expires_at
                        └──────────────┘
```

Three external HTTPs services (all free, no API keys):
- **OSM Nominatim** — reverse geocoding (lat/lng → "Sector 17, Chandigarh")
- **Open-Meteo** — current weather (used to corroborate flood/fire/power)
- **Google translate gtx** — public, key-less endpoint used by the
  `translate.js` util (only on user click for translate, with
  graceful fallback to original)

Optional fourth: **n8n / Zapier / any webhook receiver** if you set
`ALERT_WEBHOOK_URL` — fire-and-forget on alert creation.

---

## 3.2 Folder layout

```
neighbouraid/
├── backend/
│   ├── app/
│   │   ├── main.py          ← FastAPI app, lifespan, CORS, WS endpoint
│   │   ├── core/
│   │   │   ├── config.py    ← pydantic-settings, env vars
│   │   │   └── security.py  ← JWT, bcrypt, get_current_user, require_role
│   │   ├── db/client.py     ← Motor client + lazy index bootstrap
│   │   ├── models/          ← Pydantic schemas (alert, user, resource)
│   │   ├── routes/          ← One module per /api/* prefix
│   │   └── services/        ← Pure-ish business logic, see above
│   ├── tests/               ← pytest suite (99 tests)
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── service-worker.js  ← cache + notification routing
│   │   └── manifest.webmanifest
│   ├── src/
│   │   ├── App.jsx          ← Router, providers, OfflineQueueFlusher
│   │   ├── main.jsx         ← Mount + SW register
│   │   ├── components/      ← AlertCard, AutoDispatch, Button, …
│   │   ├── context/         ← AuthContext
│   │   ├── hooks/           ← useNotifications, useVoiceAlert, useWebSocket
│   │   ├── pages/           ← One file per route
│   │   ├── utils/           ← api.js, i18n.jsx, photo.js, …
│   │   └── test/setup.js    ← Vitest jsdom shims
│   └── package.json
├── .github/workflows/
│   ├── ci.yml               ← multi-version pytest, lint, build, audit
│   └── deploy.yml           ← Render deploy hook
├── docs/                    ← This folder
├── deploy/vm/               ← One-command VM install (Docker + Caddy TLS)
├── .env.example
└── README.md
```

---

## 3.3 Data model

### `users`

```jsonc
{
  "_id": ObjectId,
  "name": "Asha Patel",
  "email": "parth@example.com",
  "password_hash": "$2b$12$...",   // bcrypt
  "role": "reporter" | "volunteer",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "skills": ["medical", "cpr"],     // volunteer only
  "has_vehicle": true,               // volunteer only
  "emergency_contacts": [             // up to 5
    { "name": "Mom", "phone": "+91...", "email": null }
  ],
  "created_at": ISODate
}
```

### `alerts`

```jsonc
{
  "_id": ObjectId,
  "reporter_id": ObjectId,
  "is_anonymous": false,
  "category": "medical" | "flood" | "fire" | "missing" | "power" | "other",
  "description": "free text 10–2000 chars",
  "headline": "AI-generated one-liner",
  "urgency": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "urgency_reason": "string",
  "urgency_confidence": 0..1,
  "vulnerability": "child|elderly|pregnant|disabled|none",
  "time_sensitivity": "immediate|hours|days",
  "language": "en|hi|pa|hi-Latn",
  "triggers": ["unconscious", "bleeding"],
  "priority_score": 0..130,
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "address": "Sector 17, Chandigarh, ...",
  "weather": { "precipitation_mm": 8, "wind_kph": 0, "code": 65 },
  "weather_match": true,
  "status": "open" | "accepted" | "resolved",
  "accepted_by": ObjectId | null,
  "auto_resolved": false,
  "auto_escalated": false,
  "auto_escalated_at": ISODate | null,
  "eta_minutes": null | 0..240,
  "eta_set_at": ISODate | null,
  "witnesses": 1,
  "witnessed_by": [ObjectId],          // never returned
  "corroborating_ids": [String],
  "verified_score": 0..100,
  "photos": ["data:image/jpeg;base64,..."],   // stripped from list endpoints
  "photo_count": 0..3,
  "photo_evidence_score": 0..30,
  "photo_confidence": 0..1,
  "photo_findings": "string",
  "flags": 0,
  "flagged_by": [String],              // never returned
  "via": "whatsapp" | undefined,        // for inbound channel alerts
  "created_at": ISODate,
  "resolved_at": ISODate | null
}
```

Indexes:
- `location` 2dsphere — every distance query uses `$nearSphere`.
- `created_at` implicit through `_id`.

### `alert_updates`

Per-alert situational updates (one alert ↔ many updates).

```jsonc
{
  "_id": ObjectId,
  "alert_id": ObjectId,
  "author_id": ObjectId,
  "author_name": "string",
  "author_role": "reporter|volunteer|null",
  "body": "string 3–500 chars",
  "created_at": ISODate
}
```

### `safety_checkins`

```jsonc
{
  "_id": ObjectId,
  "user_id": ObjectId,                 // unique — upsert-replace per user
  "user_name": "string",
  "status": "safe" | "need_help",
  "note": "string up to 280 chars",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "created_at": ISODate,
  "expires_at": ISODate                // TTL, 24 h after created_at
}
```

### `resources`

```jsonc
{
  "_id": ObjectId,
  "kind": "shelter|food|blood|oxygen|water|medical_camp|other",
  "name": "Sector 17 Community Hall",
  "contact": "+91 ...",
  "capacity": 200 | null,
  "notes": "string up to 500 chars",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "owner_id": ObjectId,                // user who pinned it
  "owner_name": "string",
  "created_at": ISODate,
  "expires_at": ISODate                // TTL, 1–336 h after created_at
}
```

---

## 3.4 Auth flow

1. **Register** (`POST /api/auth/register`) → backend hashes password
   with `bcrypt`, stores user, returns `{token, role, name}`.
2. **Login** (`POST /api/auth/login`) → same shape.
3. **Token** is a JWT signed with `JWT_SECRET`, payload
   `{sub: user_id, role, exp: now + 24h}`.
4. Frontend stores it in `localStorage` (key `token`).
5. Axios interceptor attaches it as `Authorization: Bearer <token>`.
6. On any 401, the same interceptor wipes the token and dispatches an
   `auth:logout` event so AuthContext clears state.

Roles are enforced by the `require_role("reporter" | "volunteer")`
dependency on the relevant routes.

---

## 3.5 Real-time path

```
Volunteer browser                Backend
─────────────────                ───────
  open WebSocket    ─────────►  /ws/volunteer?token=...
  send {coordinates: [lng,lat]}
                                 register(vol_id, ws, coords, skills)

Reporter posts an alert  ──►  ConnectionManager.broadcast_nearby(doc)
                                 ↳ for each connected volunteer:
                                     compute haversine distance
                                     if within 5 km, OR within 15 km
                                     when alert.category matches a
                                     volunteer skill → send the alert

Volunteer moves  ────────►  send {coordinates: [lng,lat]}
                                 manager re-registers the position
                                 (no full reconnect — same socket)
```

The manager is **purely in-memory**. There's no persistence layer for
"who is online right now" — that's recomputed on every broadcast. If
the backend restarts, all sockets drop and clients reconnect with a
3 s backoff.

For live volunteer tracking on accepted alerts, the
`/api/alerts/{id}/responder` endpoint reads `manager.coords_for(vol_id)`
and falls back to the volunteer's saved home location if they're
offline.

---

## 3.6 Frontend state

The app keeps state minimal — no Redux/Zustand:

| Concern | Where it lives |
|---|---|
| Auth + JWT | `AuthContext` (React context) |
| Toasts | `ToastContext` (React context) |
| Language preference | `I18nContext` (React context) → `localStorage` |
| Voice alert preference | `useVoiceAlert` hook → `localStorage` |
| Translation cache | `utils/translate.js` → `localStorage` |
| Offline alert queue | `utils/offlineQueue.js` → IndexedDB (`neighbouraid-offline`) |
| Notifications permission + SW link | `useNotifications` hook |
| WebSocket | `useVolunteerSocket` hook (one socket per session) |
| Page state | `useState` / `useEffect` per page |

There's no global store on purpose — every page already speaks to the
backend directly, and shared state is small (just auth + i18n +
toasts).

---

## 3.7 Service Worker responsibilities

```
public/service-worker.js
├── on install   pre-cache /, /index.html, /favicon.svg, /manifest
├── on activate  drop old caches (cache versioning via CACHE constant)
├── on fetch
│   ├── /api/* and /ws/*           network only — never stale crisis data
│   ├── /assets/*                  cache-first (Vite hashed filenames)
│   └── navigation                 network-first → cached index.html
└── on notificationclick
    ├── close the notification
    ├── route to data.url or /alert/:id
    └── postMessage('notification-click', target) to focused tab
```

Mounting it: `frontend/src/main.jsx` calls
`navigator.serviceWorker.register('/service-worker.js')` after the
React tree mounts.

---

## 3.8 Stale data and self-healing

The app has no cron, no background workers, no scheduled tasks.
Everything that *would* normally be a cron is **lazy-evaluated on
the read path**:

| Concern | Where it runs |
|---|---|
| Auto-resolve stale open alerts (>24h, unaccepted) | `_auto_resolve_stale` on `/nearby` reads |
| Auto-escalate stuck alerts (MEDIUM→HIGH after 10 min, HIGH→CRITICAL after 4 min) | `_auto_escalate_unaccepted` on `/nearby` reads |
| Drop expired safety check-ins | MongoDB TTL index on `expires_at` |
| Drop expired resource pins | MongoDB TTL index on `expires_at` |
| Refresh news feed | `_TTL_SECONDS = 300` cache in `services/news.py` |
| Reconnect dead WebSockets | `useVolunteerSocket` 3 s backoff |
| Flush offline alert queue | `OfflineQueueFlusher` on app mount + `online` event |

This is intentional — running a single FastAPI process on Render's
free tier means we can't rely on a background worker that might be
killed for inactivity.

---

## 3.9 Where to look for what

| Task | Look here |
|---|---|
| Add a new alert field | `models/alert.py`, `routes/alerts.py::create_alert + _serialize`, frontend `AlertCard.jsx` |
| Add a new endpoint | New file in `app/routes/`, register in `main.py` |
| Add a new language | `frontend/src/utils/i18n.jsx` — add to `LANGUAGES` and the dictionary |
| Add a new map layer | New component under `frontend/src/components/`, mount inside `MapView.jsx` |
| Add a new page | New file under `frontend/src/pages/`, route in `App.jsx`, link in `Navbar.jsx` |
| Tune the AI triage | `services/ai.py` — both the HF model setup *and* the heuristic vocabulary |
| Tune verification weights | `services/verification.py::compute_verified_score` |
| Tune escalation timing | `routes/alerts.py::ESCALATE_*_AFTER` constants |
| Tune photo budget | `MAX_PHOTO_BYTES`/`MAX_PHOTOS` in `models/alert.py` (server) and `MAX_BYTES`/`MAX_EDGE` in `utils/photo.js` (client) |
