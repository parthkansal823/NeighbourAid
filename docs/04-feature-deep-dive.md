# 4. Feature deep-dive

One feature per section. Each starts with **what it does**, then
**how it works**, then **the file you'd change to tweak it**.

---

## 4.1 AI urgency triage

**What it does.** Every description is classified across urgency,
vulnerability and time-sensitivity, plus language detection. The result
drives the urgency badge and a composite **`priority_score (0–130)`**
used for dispatch ordering.

**How it works.** Two layers, checked in order:

1. **Patterns** (`CRITICAL_PATTERNS` in `vocab.py`) — regexes matching a
   *person plus a negated vital function*: "won't answer", "bol nahi
   rahe", "दिख नहीं रहा". These run **first**, because a report of this
   kind usually contains no urgent keyword at all, and an incidental one
   ("madad") would otherwise settle it.
2. **Keyword bands** — a vocabulary spanning all 8 UI languages in both
   native script and romanised form.

Matched terms are surfaced in the UI as chips, so a volunteer can see
*why* an alert outranked another rather than trusting a label.


![Alert lifecycle](images/alert-lifecycle.svg)

**Patterns are checked first, and that ordering is load-bearing.** A report
like *"madad chahiye, baba bol nahi rahe"* contains a HIGH keyword
(`madad`). If keyword bands ran first, that incidental word would settle it
as HIGH and the real signal — a person who has stopped speaking — would
never be seen.

**MEDIUM is the honest "I don't know".** It is what a report falls to when
nothing matched, which is exactly the bucket a smarter model would be worth
consulting for. See `models/README.md`.

**Why patterns exist.** Measured on `tests/eval_dataset.py`, keyword
matching alone scored **0/7** on reports where the danger is described
but never named — carbon monoxide, an overdose, a submerged child. Every
one landed on MEDIUM, i.e. below a power cut. The pattern layer took
that to **5/7** and overall accuracy from 70% to **90%**, at zero added
dependencies.

**Honest limit.** This reads *stated* danger. Severity that is only
inferable from context still slips through. A local LLM reached 6/7 on
those cases and is benchmarked in `models/README.md`, but is not wired
in.
- Composite formula:

  ```
  priority_score = URGENCY_WEIGHT[urgency] * max(0.5, confidence)
                 + (15  if vulnerability        else 0)
                 + (20  if time_sensitivity == "immediate" else 0)
                 + (-10 if time_sensitivity == "days"      else 0)
  ```

**Where to tweak.** Logic in `backend/app/services/ai.py`; the
vocabulary and patterns in `backend/app/services/vocab.py`. Re-measure
with `python -m tests.eval_triage` from `backend/`.

---


### What happens when someone presses "Send"

![Triage decision flow](images/triage-flow.svg)

**Why the split.** The address and weather calls used to be `await`ed
*before* the insert, putting 500–1500 ms of third-party latency between a
person pressing send and volunteers being told anything. The coordinates are
what dispatch a volunteer and they are already in hand; the address only
makes the card readable. So the alert goes first.

Measured against live Atlas: **~500 ms** to post, address present ~5 s later.
The client merges by `id` and only plays the alert sound on first sight, so
the second broadcast updates the card silently.

---

## 4.2 Photo evidence (live camera only)

**What it does.** A reporter can attach up to 3 photos to an alert;
they get auto-compressed in the browser, validated server-side, and
boost the alert's verification score by up to +30.

**How it works.**

- Client compresses with `<canvas>` in `utils/photo.js`. Steps the
  JPEG quality from 0.82 → 0.42, then progressively scales the image
  down until it fits under 280 KB. Server cap is 300 KB; the 20 KB
  headroom absorbs base64 overhead.
- Hard cap: 3 photos. Enforced in both
  `models/alert.py::_validate_photos` and the upload UI.
- Server-side: `services/photo.py::analyze_photos` does
  `Image.verify()` + dimension check (≥160 px each edge). A photo
  that's <160 px or fails decode is *invalid* and contributes 0 to
  the evidence score.
- Score: `+12` per valid photo (cap +30), with a `+4` triangulation
  bonus when 3 valid photos are present. Stored as
  `photo_evidence_score`, `photo_confidence`, `photo_findings`.

**Performance.** Photos are **stripped from list endpoints**
(`/nearby`, `/mine`) via projection, with `photo_count` denormalised
on the document so the UI can render a "📸 View N photos" affordance
without loading the full base64. The per-alert `/api/alerts/{id}/
photos` endpoint loads them lazily on click.

**Where to tweak.** `backend/app/services/photo.py`,
`backend/app/models/alert.py`, `frontend/src/utils/photo.js`.

---

## 4.3 Multi-source verification scoring

**What it does.** Every alert carries a `verified_score (0–100)`
that aggregates four independent signals.

**How it works.** `services/verification.py::compute_verified_score`:

| Source | Max weight | How earned |
|---|---|---|
| Witnesses | 40 | +8 per unique 2-km confirmer (cap 5) |
| Corroborating reports | 40 | +15 per same-category alert within 500 m / 30 min |
| Weather match | 20 | +20 if Open-Meteo conditions match (rain → flood, dry+wind → fire, …) |
| **Photo evidence** | bonus +30 | +12 per valid photo, cap 30 |

When a witness adds themselves, `bump_witness` does an idempotent
`$addToSet` on `witnessed_by` plus an `$inc` on `witnesses`, then
recomputes the score. Corroborating siblings get a `+15` bump too
(`update_many` in the route).

UI bands shown on the card:
- `0–39` — Unverified (gray)
- `40–69` — Corroborated (amber)
- `70+` — High confidence (emerald)

**Where to tweak.** `backend/app/services/verification.py`.

---

## 4.4 Skill-aware volunteer routing

**What it does.** A medical-tagged volunteer 12 km away from a
medical alert still receives it, but a swimmer 12 km away from the
same medical alert doesn't. The default radius is 5 km; a skill match
extends it to 15 km.

**How it works.** `services/websocket.py::ConnectionManager`
maintains an in-memory map of `vol_id → (ws, coords, skills,
has_vehicle)`. On broadcast it iterates connected volunteers,
computes haversine distance, and applies the radius based on whether
any of the volunteer's skills appears in `CATEGORY_PREFERRED_SKILLS`
for the alert's category:

```python
CATEGORY_PREFERRED_SKILLS = {
    "medical": ["medical", "cpr", "elderly_care", "child_care"],
    "flood":   ["swim", "driver"],
    "fire":    ["medical", "driver"],
    "missing": ["driver"],
    "power":   ["electrician"],
    "other":   [],
}
```

The broadcast payload includes `is_skill_match`, `your_distance_km`,
and `your_has_vehicle` — the UI uses these to render the
"✨ Matches your skills" ribbon, the distance chip, and the vehicle
flag on cards.

**Where to tweak.** `backend/app/services/websocket.py`.

---

## 4.5 Live volunteer tracking

**What it does.** Once a volunteer accepts an alert, the reporter sees
a small live map showing the volunteer's position relative to the
incident, Uber-style.

**How it works.**

- Volunteers stream coords over the existing WebSocket on every move
  >15 m. The `ConnectionManager` re-registers their coords without
  reconnecting.
- `GET /api/alerts/{id}/responder` reads
  `manager.coords_for(accepted_by)` first; if the volunteer is
  offline, falls back to their saved `users.location`.
- Privacy gates:
  - Only `status == "accepted"` exposes coords.
  - Only the reporter or the accepting volunteer can read; everyone
    else gets a 403.
  - Once the alert is resolved, coords stop being exposed
    immediately — you can't tail the volunteer around the city
    afterwards.
- The frontend `<ResponderTracker />` polls every 8 s while visible
  and renders a non-interactive Leaflet map with two pins (target +
  responder).

**Where to tweak.** `backend/app/routes/alerts.py::get_responder_position`,
`frontend/src/components/ResponderTracker.jsx`.

---

## 4.6 Multi-step auto-escalation

**What it does.** An open unaccepted alert at MEDIUM that's been
sitting for 10 minutes auto-bumps to HIGH; HIGH for 4 minutes →
CRITICAL. The bumped alert is rebroadcast over WebSocket so the
extra urgency reaches volunteers it didn't reach the first time.

**How it works.** `routes/alerts.py::_auto_escalate_unaccepted` runs
inline on every `/nearby` read. Each call:

1. Looks for `{status: "open", accepted_by: null, urgency: "MEDIUM",
   created_at < now - 10min, auto_escalated != true}`.
2. For each match: `find_one_and_update` to bump urgency, set
   `auto_escalated: true` (idempotent — won't escalate twice), append
   `· auto-escalated MEDIUM→HIGH after no acceptance` to the
   reason.
3. Same again for HIGH → CRITICAL with a 4-minute cutoff.
4. Returns the bumped docs so the caller rebroadcasts them.

Lazy on the read path means no cron needed. Tradeoff: an alert
posted into a quiet area that's never read won't escalate. Acceptable
because the same path serves both the public map and the volunteer
feed — anyone reading the map triggers cleanup.

**Where to tweak.** `backend/app/routes/alerts.py` —
`ESCALATE_MEDIUM_TO_HIGH_AFTER` and `ESCALATE_HIGH_TO_CRITICAL_AFTER`.

---

## 4.7 Volunteer trust score

**What it does.** Each volunteer has a 0..1 trust score, mapped to
labels (`trusted` / `reliable` / `new` / `unproven`), shown on the
leaderboard and their own profile.

**How it works.** `routes/stats.py::_compute_trust`:

- Raw ratio = `resolved / accepted`.
- Bayesian-ish smoothing: pretend every volunteer also has 2
  "neutral" 60 % samples. So 1-of-1 success becomes
  `(1 + 1.2) / (1 + 2) ≈ 0.73` not 1.0.
- Returns the lower of the two — so a 50-of-50 run still hits 1.0
  but a 1-of-1 fluke can't.

The leaderboard pipeline (`/api/stats/leaderboard`) groups alerts by
`accepted_by` over the last `days` window, summing `accepted` and
`resolved`, then runs `_compute_trust` per row. The volunteer's own
`/api/users/me/stats` includes their trust under `stats.trust`.

**Where to tweak.** `backend/app/routes/stats.py`.

---

## 4.8 Offline-first reporting

**What it does.** When the reporter taps Post Alert and the network
is dead, the payload goes into IndexedDB and auto-flushes when
connectivity returns.

**How it works.**

- `utils/offlineQueue.js` opens an IDB database `neighbouraid-offline`
  with one store `pending-alerts`. Public ops: `enqueueAlert`,
  `listPending`, `removePending`, `bumpAttempts`, `flushQueue`.
- `pages/PostAlert.jsx` catches `ERR_NETWORK` from the POST and
  enqueues the same payload, then optimistically navigates to
  `/my-alerts`.
- `App.jsx::OfflineQueueFlusher` mounts at the app root, fires
  `tryFlush` on mount and on every `online` event. Successes get
  removed; failures get `bumpAttempts`. After 10 attempts an item is
  dropped so a poison payload can't block the queue.
- Toast on success: "{n} queued alerts delivered after reconnect."

**Where to tweak.** `frontend/src/utils/offlineQueue.js`,
`frontend/src/App.jsx::OfflineQueueFlusher`.

---

## 4.9 Notifications

**What it does.** When a volunteer's tab is in the background, a
new alert raises a native OS notification that survives even after
the tab closes; tapping it routes them to `/alert/:id`. CRITICAL
alerts also speak through the device's text-to-speech.

**How it works.**

- `hooks/useNotifications.js` defers to
  `navigator.serviceWorker.registration.showNotification` instead of
  `new Notification(...)` because the SW path supports action
  buttons and survives tab close.
- `public/service-worker.js::notificationclick` listener:
  - closes the notification
  - looks for an open same-origin tab and `client.postMessage(...)`s
    a navigation target back into the React tree
  - falls back to `clients.openWindow(target)` if no tab is open
- `pages/VolunteerFeed.jsx` listens for the postMessage and
  `useNavigate()`s to the right alert.
- CRITICAL alerts get `requireInteraction: true` so they stick.
- TTS: `hooks/useVoiceAlert.js` wraps `speechSynthesis.speak`.
  Locale follows UI language (`hi-IN` / `pa-IN` / `en-IN`). Default
  ON; persistent toggle in `localStorage` under `voiceAlerts`.

**Where to tweak.** `frontend/src/hooks/useNotifications.js`,
`frontend/src/hooks/useVoiceAlert.js`,
`frontend/public/service-worker.js`.

---

## 4.10 News feed authenticity scoring

**What it does.** `/api/news/recent` serves crisis-relevant items
scraped from established Indian RSS feeds. Each item carries a
0–100 authenticity score; items below 55 are dropped before the
public sees them.

**How it works.** `services/news.py`:

- Pulls 4 feeds (The Hindu, NDTV, HT, ToI) every 5 min, cached.
- Filters by crisis keywords (`flood`, `fire`, `accident`, …).
- Scores each item:

  ```
  score = base_trust(feed)            # 55–65 from a curated tier
        + 20 if link_domain == feed_domain
        +  5 if has_published_timestamp
        +  5 if summary differs from title
        - 15 if clickbait/screamer regex matches
  ```

- Drops items below `_MIN_AUTHENTICITY_SCORE = 55`.
- Adds a `topic` (fire/flood/accident/medical/…) by first-match-wins
  keyword scan. UI renders this as a coloured chip.

**Where to tweak.** `backend/app/services/news.py`.

---

## 4.11 Multilingual UI + auto-translation

**What it does.** Three languages baked in: English / हिन्दी /
ਪੰਜਾਬੀ. User-generated content (descriptions, updates) auto-
translates to the viewer's language. Voice input also follows the UI
language.

**How it works.**

- Static UI strings live in `utils/i18n.jsx` as a flat `{lang: {key:
  text}}` dictionary. `t('nav_map')` is the call site.
- Picker in the navbar (`<LanguageMenu />`); preference persists in
  `localStorage` under `lang`.
- For dynamic content: `<TranslatableText>` (in `AlertCard.jsx`)
  detects script (Devanagari → `hi`, Gurmukhi → `pa`, else `en`),
  falls back to the backend's `language` field, and if it differs
  from the user's lang, calls `translateText(text, lang)`.
- `utils/translate.js` hits Google's free `translate_a/single`
  endpoint. Two caches: in-memory and `localStorage` (debounced
  write). On any failure → returns original text silently.

**Where to tweak.** `frontend/src/utils/i18n.jsx` (dictionary),
`frontend/src/utils/translate.js` (translation engine),
`frontend/src/components/AlertCard.jsx::TranslatableText`.

---

## 4.12 Anonymous reporting

**What it does.** A public, no-account `POST /api/alerts/anonymous`
for sensitive cases. Rate-limited 10/hour per IP.

**How it works.**

- Endpoint mirrors the authenticated alert-creation pipeline (AI
  triage + verification + broadcast + webhook fan-out).
- `services/ratelimit.py::RateLimiter` is a token-bucket. The
  implementation is in-process (no Redis) — fine for single-replica
  Render free tier.
- The created alert has `is_anonymous: true`, `reporter_id` set to a
  fresh sentinel ObjectId, and a `−10` trust penalty so it sorts
  below identified ones.
- Backend stores a hash of the source IP under `anonymous_ip_hash`
  for abuse forensics; that field is **always stripped from API
  responses**.

**Where to tweak.** `backend/app/routes/alerts.py::create_anonymous_alert`,
`backend/app/services/ratelimit.py`.

---

## 4.13 WhatsApp inbound webhook

**What it does.** `POST /api/inbound/whatsapp` accepts a normalised
JSON payload from any WhatsApp gateway (Twilio, n8n WhatsApp Cloud,
Gupshup) and turns it into an alert.

**How it works.**

- Auth via `X-Inbound-Token` header against the `INBOUND_TOKEN` env
  var. Empty token → 503 (route disabled).
- Same triage + verification + broadcast pipeline as the regular
  alert endpoint.
- The created alert has `is_anonymous: true`, `via: "whatsapp"`,
  `via_sender: "+91..."`, plus a `−5` trust penalty until we have
  a way to verify the sender (PIN-back, opt-in registry).

**Use it like this.**

1. Set up a Twilio WhatsApp sandbox (free tier).
2. Configure the inbound webhook to point at your n8n instance.
3. In n8n, build a flow:
   `WhatsApp Trigger → Code (parse body + lat/lng) → HTTP Request POST
   /api/inbound/whatsapp with X-Inbound-Token header`.
4. Done — every WhatsApp message lands in the volunteer feed.

**Where to tweak.** `backend/app/routes/inbound.py`,
`backend/app/core/config.py::INBOUND_TOKEN`.

---

## 4.14 Resource map

**What it does.** Anyone with an account can pin a community
resource (shelter, food, blood, oxygen, water, medical camp) on the
map. Pins auto-expire so the map stays current.

**How it works.**

- `models/resource.py` defines the schema with a 1–336 hour
  `valid_for_hours` field translated into `expires_at`.
- `routes/resources.py` exposes `POST / GET /near / DELETE`. Lazy
  index bootstrap on first call (2dsphere + TTL on `expires_at`).
- Frontend `pages/Resources.jsx` lists pins with kind icon,
  countdown, contact, and a directions link. Owner-only delete.

**Where to tweak.** `backend/app/routes/resources.py`,
`frontend/src/pages/Resources.jsx`.

---

## 4.15 n8n / outbound webhook

**What it does.** Each new alert can be POSTed to an external
automation URL (`ALERT_WEBHOOK_URL` env var). Use it to fan out to
WhatsApp Business, Slack, email, SMS, sheet logging — any channel
n8n / Zapier / Make supports.

**How it works.** `services/webhook.py::fire_alert_created` schedules
a detached `httpx.AsyncClient.post(url, json=payload)` task. Failures
log at WARNING; never affect the parent request.

**Payload shape:**

```json
{
  "event": "alert.created",
  "alert": {
    "id": "65...",
    "category": "fire",
    "urgency": "CRITICAL",
    "description": "...",
    "status": "open",
    "address": "...",
    "location": {"type": "Point", "coordinates": [76.7, 30.7]},
    "photo_count": 2,
    "verified_score": 78,
    "created_at": "2026-04-25T11:23:00+00:00"
  }
}
```

`photos` and `flagged_by` are intentionally **stripped** to keep the
payload small.

**Where to tweak.** `backend/app/services/webhook.py`,
`backend/app/core/config.py::ALERT_WEBHOOK_URL`.
