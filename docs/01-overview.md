# 1. Overview — what is NeighbourAid?

> *"Your neighbour needs help. Be there in minutes."*

NeighbourAid is a **hyperlocal crisis network** for India. It connects
people in distress (a flooded house, a heart-attack neighbour, a missing
child, a fire on the next block) with **nearby volunteers** in real
time, on a phone or laptop, without anyone needing to install another
app or pay anyone for an API key.

## The problem we're solving

When something bad happens in an Indian neighbourhood, the typical
response is:

1. Call **100 / 108 / 101** and wait for an over-stretched government
   line.
2. Forward a panicked WhatsApp message into half a dozen housing-society
   groups and pray someone nearby sees it.
3. Hope a relative further away has the right contact.

There is **no structured, geolocated, verified** way to reach the
nearest *willing* helpers in real time. Step 2 is the one people
actually rely on, and it has obvious holes — your neighbours might be
asleep, your message might bury under chit-chat, or it might reach
strangers in a different city by accident.

## What NeighbourAid does instead

```
 Reporter posts a crisis             AI triages urgency      WebSocket push
 (text + GPS + optional photos)  ──►  CRITICAL/HIGH/      ──►  Volunteers
                                       MEDIUM/LOW              within 5–15 km

      ↓                                       ↓
                                                                 ↓
 Nominatim → address                  Photo + weather +
 Open-Meteo → live weather            witness corroboration       Accept
                                       feed a 0–100                Resolve
                                       verified_score              Update
```

Five things make NeighbourAid different from a WhatsApp group:

1. **Geofenced delivery** — the alert reaches volunteers within 5 km of
   the incident, not your entire contact list. Skill-tagged volunteers
   get a wider 15 km bubble.
2. **AI urgency triage** — every alert runs through a local Hugging
   Face model that classifies it as `CRITICAL`, `HIGH`, `MEDIUM`, or
   `LOW`, plus detects the language, vulnerability (child / elderly /
   pregnant), and time-sensitivity. No paid AI APIs.
3. **Multi-source verification** — every alert carries a
   `verified_score` (0–100) derived from independent signals: community
   witnesses, corroborating reports nearby, live weather, and photo
   evidence.
4. **Built for India** — 8-language UI (English, हिन्दी, বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, ਪੰਜਾਬੀ),
   auto-translation between them, India emergency dialer (112 / 100 /
   108 / …), and an optional WhatsApp inbound bridge.
5. **Free and offline-tolerant** — zero paid dependencies. Alerts can
   be queued in the browser when the network drops and auto-deliver
   when it comes back.

## Two kinds of users

| Role | What they do |
|---|---|
| **Reporter** | Posts a crisis. Has a "My Alerts" dashboard. Can attach photos. Can use Quick SOS for one-tap broadcast. |
| **Volunteer** | Receives nearby alerts in real time. Accepts → optionally publishes ETA → resolves. Has a trust score. |

A user picks their role at registration. They can switch later by
making a new account — roles aren't mutually exclusive in real life,
but mixing them in one account complicates the UI more than it helps.

## What's running where

![NeighbourAid system architecture](images/architecture.svg)

**Reading it:** solid arrows are on the request path; dotted arrows are
best-effort and never block an alert. The address and weather lookups moved
off the hot path deliberately — they are third-party HTTP calls, and a
reporter pressing *send* in an emergency should not wait on somebody else's
latency. They fill in seconds later and the card updates over the same
WebSocket.

No paid API keys, no managed AI subscription, no SaaS auth provider.
Everything runs on any small Ubuntu VM. No paid AI subscription, no
SaaS auth provider, no managed search.

## What's documented next

- **Want to *use* the app?** → [02-user-guide.md](02-user-guide.md)
- **Want to know how it's built?** → [03-architecture.md](03-architecture.md)
- **Want to integrate with it?** → [05-api-reference.md](05-api-reference.md)
- **Want to run it locally?** → [06-development.md](06-development.md)
