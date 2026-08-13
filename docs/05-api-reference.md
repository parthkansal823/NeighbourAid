# 5. API reference

> Interactive Swagger UI at **`/docs`** on any running backend.

This page mirrors the OpenAPI surface in human-readable form, with a
short rationale for each endpoint and the bits the auto-generated
docs don't cover (auth model, error shape, projection rules).

---

## 5.1 Conventions

**Base URL** — `/api` for all REST routes. WebSocket lives at `/ws`.

**Auth** — `Authorization: Bearer <jwt>` header. Tokens come from
`/api/auth/register` or `/api/auth/login`, are valid for 24 h, and
carry `{sub: user_id, role}` in the payload.

**Roles** — `reporter` or `volunteer`. Some endpoints require a
specific role; auth-only endpoints accept either.

**Error shape** — every 4xx/5xx returns:

```json
{ "detail": "human-readable message" }
```

422s also include:

```json
{
  "detail": "field.subfield: msg · other.field: msg",
  "errors": [{ "type": "...", "loc": ["body","..."], "msg": "..." }]
}
```

Malformed `{alert_id}` or `{resource_id}` path params return **400**,
not 500. Missing entities → **404**. Wrong role → **403**.

---

## 5.2 Auth

### `POST /api/auth/register`
Public. Create a user.

```jsonc
// body
{
  "name": "Asha Patel",
  "email": "parth@example.com",
  "password": "min-6-chars",
  "role": "reporter" | "volunteer",
  "location": { "type": "Point", "coordinates": [76.7794, 30.7333] },
  "skills": ["medical", "cpr"],         // volunteer only, optional
  "has_vehicle": true,                   // volunteer only, optional
  "emergency_contacts": [                 // optional, max 5
    { "name": "Mom", "phone": "+91...", "email": null }
  ]
}
// 201
{ "token": "eyJhbGc...", "role": "reporter", "name": "Asha Patel" }
```

### `POST /api/auth/login`
Public. Exchange creds for JWT. 401 on bad creds.

```jsonc
// body
{ "email": "parth@example.com", "password": "..." }
// 200
{ "token": "eyJhbGc...", "role": "reporter", "name": "Asha Patel" }
```

---

## 5.3 Alerts

### `GET /api/alerts/nearby?lat=&lng=&km=`
Public. Active (non-resolved, non-flagged-out) alerts within `km` of
`(lat, lng)`. Photos are projected out for payload size — the
response carries `photo_count` and clients lazy-load via
`/api/alerts/{id}/photos`.

This endpoint also runs two opportunistic cleanups inline:
auto-resolve (>24 h unaccepted) and auto-escalate (MEDIUM→HIGH→CRITICAL).

### `GET /api/alerts/heatmap?lat=&lng=&km=&hours=`
Public. Compact `{points: [[lat, lng, weight]], window_hours}` shape.
Used by the heatmap layer on the map dashboard. Weight blends
urgency × verified score, with resolved alerts dimmed at 0.6×.

### `GET /api/alerts/mine`
Reporter. Every alert the caller has posted, newest first. Photos
projected out (use `/photos` endpoint to fetch).

### `POST /api/alerts/`
Reporter. Create an alert.

```jsonc
{
  "category": "medical|fire|flood|accident|missing|violence|animal|gas|power|water|structure|other",
  "description": "10–2000 chars, AI uses for triage",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "photos": ["data:image/jpeg;base64,..."]  // optional, max 3, ≤300 KB each
}
```

Returns the full alert doc with photos inlined (just for the
reporter's confirmation view). Triage + reverse-geocoding + weather +
photo analysis run **concurrently** via `asyncio.gather`.

### `POST /api/alerts/anonymous`
Public, rate-limited 10/h per IP. Same body shape as the
authenticated path. Created alert has `is_anonymous: true` and a
−10 trust penalty.

### `GET /api/alerts/{id}`
Public. Single alert with photos. Used by share links. 404s
heavily-flagged alerts.

### `GET /api/alerts/{id}/photos`
Public. `{photos: [data:image/...]}`. Lazy-load companion to
`/nearby`. 404s heavily-flagged alerts.

### `GET /api/alerts/{id}/responder`
Auth (reporter or accepting volunteer only — others 403). Live
position of the volunteer who accepted the alert. Falls back to
their saved home location if they're offline.

```jsonc
// 200
{
  "responder_id": "65...",
  "responder_name": "Aman",
  "coordinates": [76.7, 30.7],
  "live": true,
  "eta_minutes": 12,
  "eta_set_at": "...",
  "status": "accepted"
}
```

Only exposes coords while `status == "accepted"`. Once resolved,
coords stop coming back immediately.

### `GET /api/alerts/{id}/updates`
Auth. Chronological list of situational updates.

### `POST /api/alerts/{id}/updates`
Auth. Post a 3–500 char update. Anyone signed in can post (reporter,
volunteer, witness).

### `POST /api/alerts/{id}/witness`
Auth. "I see this too." Idempotent per user. Requires the user's
saved home location to be within 2 km of the alert.

- 400 — own alert (you can't witness yourself)
- 403 — too far away (>2 km)
- 409 — alert already resolved
- 404 — alert not found

Successfully witnessing bumps the alert's `verified_score` (witness
weight + corroborating siblings get +15 each).

### `POST /api/alerts/{id}/flag`
Auth. Idempotent flag for spam/fake. ≥3 flags from distinct users
hides the alert from public lists. Cannot flag your own alert.

```jsonc
// 200
{ "flags": 2, "already": false }
```

### `PATCH /api/alerts/{id}/accept`
Volunteer. Take ownership of an open alert. Fails 404 if already
accepted. Rebroadcasts so other volunteers see it's off-the-market.

### `PATCH /api/alerts/{id}/eta`
Volunteer (the accepting one). Publish ETA in minutes (0–240).
Fails 404 if you didn't accept this alert.

```jsonc
{ "eta_minutes": 12 }
```

### `PATCH /api/alerts/{id}/resolve`
Volunteer (the accepting one). Mark accepted alert resolved.

### `DELETE /api/alerts/{id}`
Reporter (the original poster). Cancel an *open* alert. Fails 404
if it's already accepted/resolved or not yours.

---

## 5.4 Safety check-ins

### `POST /api/safety/`
Auth. Upsert your safety status. One active check-in per user.

```jsonc
{
  "status": "safe" | "need_help",
  "note": "optional, ≤280 chars",
  "location": { "type": "Point", "coordinates": [lng, lat] }
}
```

Auto-expires 24 h after creation via TTL index.

### `GET /api/safety/near?lat=&lng=&km=`
Public. Nearby check-ins within `km` (default 5). Default is 200 max
results, sorted by `$nearSphere`.

### `GET /api/safety/me`
Auth. The caller's active check-in (if any), else `null`.

---

## 5.5 News

### `GET /api/news/recent`
Public. Crisis-relevant news scraped every 5 min from The Hindu /
NDTV / Hindustan Times / Times of India. Items with authenticity
score below 55 are dropped.

```jsonc
{
  "count": 8,
  "items": [{
    "source": "The Hindu · National",
    "title": "...",
    "link": "https://...",
    "summary": "...",
    "published": "Tue, 16 Apr 2024 ...",
    "trust": "verified" | "reputable" | "unverified" | "low-trust",
    "authenticity_score": 90,
    "topic": "fire" | "flood" | ...,
    "domain": "thehindu.com",
    "domain_match": true
  }]
}
```

Sorted by `authenticity_score` descending.

---

## 5.6 Users

### `GET /api/users/me`
Auth. Caller's profile (incl. skills, vehicle, emergency contacts).

### `PATCH /api/users/me/location`
Auth. Update home location.

```jsonc
{ "location": { "type": "Point", "coordinates": [lng, lat] } }
```

### `PATCH /api/users/me/profile`
Auth. Patch any of `skills`, `has_vehicle`, `emergency_contacts`.
Empty body → 400. Unknown skill → 422. >5 contacts → 422.

```jsonc
{
  "skills": ["medical", "cpr"],
  "has_vehicle": true,
  "emergency_contacts": [{"name": "Mom", "phone": "+91..."}]
}
```

Only the supplied fields are written; `null` keeps the existing value.

### `GET /api/users/me/stats`
Auth. Role-aware stats.

- Reporter: `{role, posted, open, resolved}`
- Volunteer: `{role, accepted, resolved, in_progress, trust}` where
  `trust = {score: 0..1, label, accepted, resolved}`.

---

## 5.7 Resources

### `POST /api/resources/`
Auth (any role). Pin a resource.

```jsonc
{
  "kind": "shelter|food|blood|oxygen|water|medical_camp|other",
  "name": "Sector 17 Community Hall",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "contact": "+91 ...",       // optional
  "capacity": 200,             // optional
  "notes": "...",              // optional
  "valid_for_hours": 24        // 1..336 (default 24)
}
```

### `GET /api/resources/near?lat=&lng=&km=`
Public. Resources within `km` (default 25, max 200). Excludes expired
pins.

### `DELETE /api/resources/{id}`
Auth. Owner-only. 404 if not yours.

---

## 5.8 Stats

### `GET /api/stats/`
Public. Landing-page counters.

```jsonc
{
  "active_alerts": 12,
  "critical_open": 1,
  "last_24h": 27,
  "resolved_24h": 18,
  "top_category": { "category": "flood", "count": 9 },
  "volunteers_online": 4,
  "as_of": "2026-04-25T..."
}
```

### `GET /api/stats/leaderboard?days=&limit=`
Public. Top volunteers by resolved count over the window. Each row
includes a trust score.

```jsonc
{
  "window_days": 30,
  "top": [{
    "name": "Aman",
    "resolved": 18,
    "trust": {"score": 0.92, "label": "trusted", "accepted": 19, "resolved": 18}
  }]
}
```

---

## 5.9 Inbound webhooks

### `POST /api/inbound/whatsapp`
Header: `X-Inbound-Token: <secret matching INBOUND_TOKEN env>`.
Returns 503 when `INBOUND_TOKEN` is unset (route disabled). 401 on
wrong token.

```jsonc
{
  "sender": "+91...",
  "body": "10–2000 chars, the message text",
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "category": "fire"   // optional, defaults to "other"
}
```

Created alert is flagged `via: "whatsapp"`, `is_anonymous: true`, and
gets a −5 trust penalty.

---

## 5.10 WebSocket

### `WS /ws/volunteer?token=<jwt>`
Volunteer-only.

**Handshake**
- Token is decoded; if missing/invalid, close `4001`.
- If role ≠ volunteer, close `4003`.
- First text frame must be `{"coordinates": [lng, lat]}`.
- If coordinates malformed, close `4002`.

**Subsequent frames** (client → server)
Optional. Send `{"coordinates": [lng, lat]}` to update the
volunteer's position; the same socket is reused (no reconnect).
Anything malformed is silently treated as a keep-alive.

**Server → client** (each broadcast frame)
The serialized alert document (no photos), augmented with
`is_skill_match`, `your_distance_km`, `your_has_vehicle`. Frames are
JSON-encoded.

**Reconnect** — clients (frontend) backoff 3 s, indefinitely, on
unexpected close.

---

## 5.11 Rate limits

| Endpoint | Limit |
|---|---|
| `POST /api/alerts/anonymous` | 10/hour per source IP |
| Everything else | None enforced server-side |

---

## 5.12 Health

### `GET /health`
`{"status": "ok"}`. Used by Render and similar PaaS for liveness.

### `GET /`
`{"service": "NeighbourAid API", "status": "ok", "docs": "/docs"}`.

---

## Geocoding

### `GET /api/geo/reverse`

Coordinates → a rough human-readable address, for showing the reporter where
their GPS actually landed before they submit.

**Unauthenticated on purpose.** The report form is reachable without an
account (anonymous reporting), so requiring a token would leave exactly those
users staring at raw coordinates. Rate-limited per IP instead.

```
GET /api/geo/reverse?lat=30.75053&lng=76.63167
```

```json
{ "address": "Kharar, Sahibzada Ajit Singh Nagar, 140300" }
```

Returns `{"address": null}` with **200**, not an error, when the geocoder is
slow or has no data for the point. A missing address must never block an
emergency report — the coordinates are what dispatch a volunteer, and they
are already in hand. `422` for out-of-range coordinates.

Proxied through the API rather than called from the browser: Nominatim's
usage policy requires an identifying User-Agent that a browser cannot set
cross-origin, and CORS would block it regardless.

---

## Health

### `GET /health`

Liveness. **Deliberately checks nothing.**

```json
{ "status": "ok" }
```

Used by the container health check. If this touched MongoDB, a transient
Atlas blip would return 503, the platform would recycle a perfectly healthy
container, and a database wobble would become an outage.

### `GET /health/ready`

Readiness — pings MongoDB. **This is what uptime monitoring should watch.**

```json
{ "status": "ok", "database": "ok" }
```

On failure, **503** naming the broken component, so the alert email says
where to look:

```json
{ "status": "degraded", "database": "unreachable" }
```
