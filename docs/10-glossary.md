# 10. Glossary

Quick definitions for terms used throughout the docs and code.

---

**Alert** — A single crisis report posted by a reporter (or
anonymous, or via WhatsApp inbound). Carries category, description,
location, urgency, verified_score, status, optional photos.

**Anonymous report** — An alert posted without authentication via
`POST /api/alerts/anonymous`. Rate-limited per IP, flagged
`is_anonymous: true`.

**Auto-dispatch strip** — UI component on CRITICAL/HIGH alert cards
that surfaces category-specific emergency numbers (108 ambulance for
medical, 101 for fire, etc.).

**Auto-escalation** — Backend logic that bumps an unaccepted alert's
urgency over time (MEDIUM→HIGH after 10 min, HIGH→CRITICAL after 4
min). Runs lazily on each `/nearby` read.

**Auto-resolve** — Backend logic that marks unaccepted alerts older
than 24 h as resolved. Same lazy-on-read pattern.

**Buddy ping** — UI chips inside SOS / "I need help" check-ins that
open `sms:` or `mailto:` links to the user's saved emergency
contacts. Backend never sends SMS itself.

**CRITICAL_PATTERNS** — Regexes in `services/vocab.py` matching a
*person plus a negated vital function* ("won't answer", "bol nahi
rahe", "दिख नहीं रहा"). They run before the keyword bands, because a
report of this kind usually contains no urgent keyword at all.
Keyword matching alone scored 0/7 on these cases.

**Corroboration** — Adjacent same-category alerts within 500 m / 30
min. Each one bumps the original's `verified_score` by 15 (capped 40).

**Crisis news feed** — Public RSS scraper at `/api/news/recent`. Pulls
The Hindu, NDTV, HT, ToI; filters by crisis keywords; scores
authenticity 0–100; drops items below 55.

**ETA** — Volunteer-published estimated time of arrival in minutes
(0–240). Set via `PATCH /api/alerts/{id}/eta`. Visible to reporter
and other volunteers.

**Flag** — A community moderation action. Any signed-in user can
flag any alert (except their own). ≥3 flags soft-hides the alert from
public lists.

**GeoJSON Point** — `{type: "Point", coordinates: [lng, lat]}`.
Note longitude first, latitude second — same convention MongoDB's
2dsphere uses.

**Heatmap** — Toggleable canvas overlay on the map. Aggregates 72h
of alerts weighted by urgency × verification, rendered as radial
gradient blobs. No external lib (no leaflet.heat).

**Inbound webhook** — Public endpoint at
`/api/inbound/whatsapp` for third-party gateways to forward
WhatsApp messages into the alert pipeline. Auth via shared
`INBOUND_TOKEN`.

**JWT** — JSON Web Token. Signed `{sub, role, exp}` payload, valid
for 24 h. Issued by `/api/auth/{register,login}`.

**PyMongo async** — MongoDB's built-in async driver (asyncio version of
PyMongo). Used for every DB access in the backend.

**n8n** — Self-hostable workflow automation tool. NeighbourAid
integrates with it via the optional `ALERT_WEBHOOK_URL` outbound
hook (any new alert POSTs a compact JSON payload to that URL).

**Nominatim** — OpenStreetMap's free reverse geocoding service. Used
by `services/geocode.py` to turn lat/lng into a human address. Honours
`accept-language=en-IN` for India-formatted output.

**Open-Meteo** — Free weather API (no key). Used by
`services/weather.py` to corroborate flood / fire / power alerts via
live conditions.

**OfflineQueueFlusher** — App-root component that retries IndexedDB-
queued alerts on mount and on every `online` event.

**PWA** — Progressive Web App. NeighbourAid ships a
`manifest.webmanifest` + `service-worker.js` so it's installable on
Android and iOS home screens, with offline shell caching.

**Reporter** — User role for someone posting crises. Can post,
cancel, see "My Alerts".

**Resource** — A community-pinned shelter / food / blood / oxygen /
water / medical-camp pin on the map. TTL-expired automatically.

**Responder** — The volunteer who has accepted an alert. Their live
position is exposed via `/api/alerts/{id}/responder` for the
reporter's "Uber-style" tracking widget.

**Service Worker** — `frontend/public/service-worker.js`. Handles
offline shell caching + native notification routing (the SW's
`notificationclick` handler navigates the focused tab via
`postMessage`).

**Skill match** — When an alert's category preferred-skill set
intersects a volunteer's `skills`. Bumps the broadcast radius from
5 km to 15 km.

**Trust score** — Per-volunteer derived metric:
`resolved / accepted` with Bayesian smoothing so a 1-of-1 success
doesn't auto-promote to "trusted". Bands: trusted / reliable / new /
unproven.

**TTS** — Text-to-Speech. `useVoiceAlert` wraps the browser's
`speechSynthesis.speak` for hands-free CRITICAL alerts. Locale
follows UI language.

**verified_score** — 0–100 composite per-alert score blending
witnesses (40), corroboration (40), weather match (20), and photo
evidence (+30 bonus, total clamped 100).

**Vitest** — Frontend test runner. Vite-native, runs in a jsdom
environment with Testing Library.

**Volunteer** — User role for someone responding to alerts. Has a
trust score, optional skills + vehicle flag, real-time WebSocket
feed.

**Witness** — A signed-in user within 2 km of an alert who has
tapped "I see this too". Idempotent per user. Each witness adds 8
points to `verified_score`.

**Under-ranked** — An alert classified *below* its true urgency, so
volunteers see it beneath genuinely less urgent ones. The failure mode
that costs someone help, and the number `tests/eval_triage.py` reports
separately from raw accuracy. Over-ranking merely wastes a trip.

**2dsphere** — MongoDB geospatial index type for GeoJSON. Lets
`$nearSphere` queries run in O(log n) of the index size.
