# 2. User guide

How to *use* NeighbourAid. Read this if you're a reporter, a volunteer,
or just trying to share a crisis with neighbours.

---

## 2.1 First-time setup

1. Open the site (`https://your-deploy-url`).
2. Tap **Get Started** → **Create account**.
3. Fill in name, email, password, choose a role:
   - **Report Crisis** if you're posting.
   - **Volunteer** if you're responding.
4. Tap **Detect** to capture your home GPS. The site never sends your
   GPS to anyone except the backend, and only to compute distances.
5. Volunteers get extra fields:
   - **Skills** (medical, CPR, swim, driver, electrician, translator,
     elderly-care, child-care). Pick the ones that fit you. Skills
     extend the radius alerts reach you at — a swimmer 12 km away
     still gets a flood alert.
   - **Vehicle flag** if you have a car/bike that can move people or
     supplies.
6. (Optional but strongly recommended) After signing up, open
   **Profile** and add up to 5 **emergency contacts** (name + phone or
   email). When you tap SOS or "I need help", these contacts appear
   as one-tap chips that pre-fill an SMS or email.

### Install on your phone

Open the site in Chrome / Edge / Samsung Internet on Android (or
Safari on iOS), tap the menu → **Install app** / **Add to Home Screen**.
You'll get a real app icon, fullscreen launch, and shortcuts to
*Report Crisis*, *Live Map*, *Safety*, *Resources*.

---

## 2.2 If you're a Reporter

### Posting a crisis (the normal flow)

1. Tap **Report Crisis** in the navbar (or the red CTA on the home
   page).
2. Pick a **category**: medical, flood, fire, missing, power, other.
3. Type or **🎤 Speak** a description. Voice input speaks in your UI
   language — Hindi, Punjabi, or English.
4. (Optional) Attach **up to 3 photos**. They're auto-compressed to
   under 300 KB each. Photos boost the AI's confidence in your alert
   (up to +30 verification points).
5. Tap **Use GPS**. The little blue pin tells you the location was
   captured.
6. Tap **Post Alert Now**. You'll bounce to **My Alerts** where the
   alert sits with its AI-determined urgency badge.

### Quick SOS — for emergencies you don't have time to type

The home page shows a red **SOS** banner if you're a reporter. It
posts a `CRITICAL · other` alert at your current GPS in about 3
seconds, with a generic "SOS — critical help needed" description.

Two safety guards:
- It always shows a confirm dialog so a stray tap doesn't fire it.
- If you've added emergency contacts, they show up as buddy-ping
  chips below the banner so you can simultaneously SMS them.

### My Alerts dashboard

You'll see one row per alert you've posted, grouped by status:
**Open / Accepted / Resolved**.

- **Open**: no volunteer has taken it yet. You can **Cancel alert**.
- **Accepted**: a volunteer is on the way. Their **ETA chip** shows
  if they posted one. A small **live map** appears showing their
  real-time position relative to the crisis location, Uber-style.
- **Resolved**: the volunteer marked it done.

### Sharing an alert

Each alert has a 🔗 **Share** button that:
- Opens the native share sheet on mobile (WhatsApp, SMS, etc.).
- On desktop, falls back to a modal with **Copy link**, **Share via
  WhatsApp**, and a **QR code** so a friend can point their phone at
  it.

The share link goes to a public `/alert/:id` page — anyone (account or
not) can open it.

---

## 2.3 If you're a Volunteer

### The volunteer feed

Tap **Volunteer Feed** (or sign in as a volunteer). You'll see:

- A **Live** dot — green if the WebSocket is connected.
- **Open alerts** within 10 km of you (or 15 km if a skill matches).
- **Your active tasks** — alerts you've accepted but not resolved yet.

Each card shows:
- Category icon + urgency badge (CRITICAL / HIGH / MEDIUM / LOW).
- Distance from you.
- AI confidence + flagged keywords.
- Verification score (0–100, banded as Unverified / Corroborated /
  High confidence).
- Photo evidence button (📸 *View N photos*) — photos load lazily on tap.
- **🌐 Translate** button if the alert is in a language other than
  yours. Auto-translates by default; toggle off in settings.

### Notifications you'll get

When a new alert arrives in your area, you get all of these:

| Channel | When it fires |
|---|---|
| **Audio ping** | Always (unless your tab/device is muted). |
| **In-app toast** | Always. |
| **Native notification** | When the tab is hidden. CRITICAL alerts are sticky and require interaction. |
| **🔊 Voice TTS** | CRITICAL alerts only, hands-free. Toggle from the *Voice alerts* chip at the top of the feed. |

Tap a native notification → the Service Worker routes you straight to
`/alert/:id` even if the tab was closed.

### Accepting and resolving an alert

1. Tap **Accept** on the card. The alert moves to "Your Active Tasks"
   on your feed and to "Accepted" on the reporter's My Alerts.
2. Tap **Set ETA** and enter the minutes — visible to the reporter
   and other volunteers so two of you don't show up.
3. Tap **🧭 Directions** to open Google Maps.
4. When you're done, tap **Mark Resolved**.

Witnessing — anyone within 2 km of an alert (your saved home location)
can tap **I see this too** to add a corroborating witness, even if
they're not the accepting volunteer. Each unique witness adds 8 points
to the alert's `verified_score`.

### Trust score

Your **trust score** is `resolved ÷ accepted`, smoothed so a 1-of-1
fluke doesn't auto-promote you. It shows as a coloured badge on the
leaderboard and your own profile:

- **Trusted** (≥ 0.85)
- **Reliable** (0.6–0.84)
- **New** (0.3–0.59)
- **Unproven** (< 0.3)

The score moves with the rolling 30-day window. To grow it, accept
fewer alerts but resolve all of them — it's better to bail out via
resolving with an update note than to ghost.

---

## 2.4 Safety check-ins (everyone)

`/safety` lets anyone with an account post **I'm safe** or **I need
help** with a short note. The check-in is visible to anyone within
10 km for 24 hours, then auto-expires.

If you check in with **need_help**, your saved emergency contacts
appear as buddy chips so you can SMS them with one tap.

---

## 2.5 Resources page (everyone)

`/resources` is a community-pinned map: shelters, food, blood,
oxygen, water, medical camps. Anyone with an account can pin a
resource — name, kind, location, optional contact / capacity / notes,
and a *valid for N hours* deadline. Pins auto-expire so the map never
fills with stale entries.

A few things show up as resources during typical crises:
- **Floods**: shelter (housing societies, community halls), water,
  blood (donor camps), medical camps.
- **Heatwaves**: water (free water points), shelter (AC malls).
- **Power outages**: medical camp (mobile generator setups), oxygen
  (clinics with backup).

Only the user who created a pin can delete it.

---

## 2.6 Anonymous reporting

You don't always have an account, and you don't always *want* to be
identified — domestic-abuse witnesses, sensitive missing-persons
cases, bystander reports.

There's a public anonymous endpoint: `POST /api/alerts/anonymous`. UI
work is up to you (the in-app form requires login), but the endpoint
is rate-limited at **10 anonymous reports per IP per hour**. Anonymous
alerts:

- Get a small `−10` trust penalty so they sort below identified ones.
- Show as `🕶 Anonymous tip` on volunteer cards.
- Have no contact-back path — volunteers should know they can't
  follow up with the reporter.

---

## 2.7 Multilingual UI

Tap the 🌐 in the navbar to switch between English / हिन्दी / ਪੰਜਾਬੀ.
Your preference is remembered.

For user-generated content (alert descriptions and updates):

- The app **auto-detects** the script of the source text.
- If it doesn't match your language, it auto-translates using a free
  Google translate endpoint.
- Translations are cached in `localStorage` so reloads are instant.
- You can disable auto-translation in the i18n preferences.

Voice input also follows your UI language: speaking Hindi while the
app is set to हिन्दी uses the `hi-IN` voice recognition locale.

---

## 2.8 Emergency dialer (everyone)

The floating red 🆘 button at the bottom-left opens a modal with one-
tap **tel:** links for India's emergency numbers:

| Number | Service |
|---|---|
| **112** | All-in-one emergency (ERSS) |
| 100 | Police |
| 108 | Ambulance |
| 101 | Fire brigade |
| 1091 | Women helpline |
| 1098 | Child helpline |

On CRITICAL/HIGH alert cards you'll also see an **auto-dispatch strip**
with the right number for the alert category — 108 for medical, 101
for fire, 1078 (NDRF) for floods, and so on.

---

## 2.9 Privacy in one paragraph

- The backend stores your location only as the GeoJSON point you saved
  during sign-up plus the live coords of accepted-alert volunteers
  (in-memory in the WebSocket manager, not persisted).
- The only third parties touched on the read path are OSM Nominatim
  (reverse geocoding the alert address), Open-Meteo (weather), Google
  translate gtx (only when you tap Translate). Your auth never leaves
  the backend.
- Anonymous alerts store a hash of the source IP for abuse forensics
  only — never exposed via the API.
- We don't ship base64 photos in list endpoints, so a stranger viewing
  `/api/alerts/nearby` can't scoop everyone's evidence.

That's everything you need to be productive on the app. The rest of
this docs folder is for developers.
