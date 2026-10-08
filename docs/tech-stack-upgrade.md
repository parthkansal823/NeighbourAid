# Current-stack upgrade: implementation record

8 October 2026. Local implementation, not a production deployment. The user
selected React + Capacitor continuity. No React Native rewrite, paid service,
provider credentials or live emergency actions were performed.

## Technologies and their purpose

| Technology | Installed version / change | Used for |
| --- | --- | --- |
| React / React DOM | 19.3.0 | Existing UI retained; optional screens are lazy routes. |
| Vite / React plugin | 8.3.3 / 6.1.2 | Rolldown build, callback chunk configuration and bounded test workers. |
| React Router | 7.18.4 | Existing web/native routes and guarded navigation. |
| Capacitor core / Android / iOS / CLI | 8.5.3 | Native shell continuity; generated Android integration via `mobile:sync`. |
| Capacitor App / Keyboard / Haptics | 8.1.2 / 8.0.6 / 8.0.2 | Hardware back, keyboard-aware viewport and optional tactile feedback. |
| TanStack React Query | 5.104.1 | Private relay/inbox server state, cancellation, invalidation and short-lived memory caching. |
| IndexedDB + Web Locks | Queue schema v2 | Stable retry identities, durable local receipts and serialized delivery/cancellation. |
| FastAPI + PyMongo async | Existing backend retained | Mongo-backed retry fencing, incident consent/outcomes and atomic acknowledged handoff. |
| Android DownloadManager + SHA-256 | Existing native updater strengthened | Resumable/Wi-Fi-only download, size/hash verification before the system installer. |
| Vitest / pytest / Playwright / axe | Existing tools reused | Unit/regression, mocked screen, theme, keyboard and accessibility checks. |

Dependency versions are resolved in `frontend/package-lock.json`. Node 22.12+
is required; CI uses Node 22. Both npm 10 and npm 11 locked-install dry runs
passed after regenerating the lock. Framework upgrades are not a claim that
all screens were visually redesigned.

## Implemented behavior

- Shared Android back/dialog stack, draft protection, optional keyboard bridge
  and VisualViewport fallback; the website never attempts native app exit.
- System light/dark switching remains live on phone/browser. Launch uses the
  shared reduced-motion preference. Evidence text uses semantic palette tokens.
- Relay backup offers, private inbox, explicit progress and 15-minute
  acknowledged lead transfers. Current lead remains responsible until accepted.
- Responder location sharing starts off, is time-bounded and revocable, requires
  a fresh observed position, and never substitutes a saved home location.
- Explicit outcome provenance distinguishes automatic expiry, volunteer-reported
  resolution and reporter confirmation. No receipt or provider response means
  help has arrived.
- Profile category/skill/radius filters with sensitive push previews off by
  default. Device permission, registration and delivery are separate states.
- Text-first photo/map deferral, original-text fallback, explicit external
  translation consent and saved-translation clearing. Changing report/language
  or withdrawing translation consent cannot display an old async translation.
- Public-link share review; third-party QR generation is explicit rather than
  an automatic disclosure of the incident link.
- New APK prompt defers while reporting. Installer is Android-confirmed; every
  install checks package, version and signing key, plus checksum/size when the
  release provides them. Failed integrity can discard and redownload safely.
- Website shell updates require explicit approval and recheck the report guard
  when activation finishes. Capacitor uses packaged assets, not a second cached
  website.

## Cache and delivery boundaries

Private TanStack clients are account-isolated and cleared/cancelled on account
change. No persistent coordination data or token cache; relay queries have
zero stale time, 60-second garbage collection, visible-only polling and no
mutation retry. Known permission failures hide retained private data.

Service-worker cache is same-origin public shell/hashed assets only: at most
80 asset entries and 5 MiB per response. API/auth/no-store/third-party/opaque
responses are not cached. Activation cleans only NeighbourAid namespaces;
offline navigation falls back to the cached shell or an honest 503.

Hospital lookup cache is per-process and bounded to 256 cells, 32 shared loads
and four upstream slots. Transient failures expire after 30 seconds; bounded
lookup time and cancellation shielding prevent one caller cancelling others.
Caller-specific distances and returned objects are not shared mutable state.
No Redis service was added without a demonstrated multi-process cache need.

Both alert creation routes accept stable submission UUIDs; anonymous retries
also require an independent opaque device capability. Payload conflicts fail
closed. Mongo's unique lease/CAS plus deterministic alert ID prevents duplicate
creation after a lost reply, including recovery after receipt expiry. Backend
receipt snapshots expire after 30 days. Side-effect notifications are not an
exactly-once durable outbox.

Local report save precedes sending where storage is available. Receipt save
and pending-row removal are atomic. Local receipts hold minimal metadata,
at most 100 entries/up to 30 days, and hide immediately on account change.
Rejected payloads pause for review; `SUBMISSION_PENDING` remains retryable.
Changing a payload requires explicit cancellation of its earlier saved retry.
Anonymous practice drills are rejected rather than silently posted as real
emergencies. Tokens are never stored in queued reports or receipts.

## Verification

- Backend: 933 pytest tests passed on local Python 3.11; CI 3.12/3.13 remains
  CI verification, not a locally tested claim.
- Frontend: full suite and newly added regression files passed; see the final
  handoff for the final count. Strict frontend lint, 46 tool/release tests and
  private-file check passed.
- Synthetic headless browser: 104 route/theme/viewport combinations at
  320, 390, 430 and 1280 px without horizontal overflow/runtime errors;
  eight live theme changes passed. Login did not request the lazy map chunks.
  Responses were fictional and all external/API writes were blocked.
- Production web/mobile build, Capacitor sync, debug APK and updater/speech
  Java unit tests are checked locally using Android Studio's JBR. Generated
  Android files are not hand-edited.
- Critical Ruff CI rules pass. Full strict Ruff still reports existing style
  debt; this pass does not hide it with a repository-wide formatter or new
  blanket suppressions.

## Still requires deployment or device decisions

Public report coordinates/photos retain the existing public-share policy;
responder consent is **not** full public-report privacy. A precision/disclosure
rollout needs deliberate form/API/map changes.

Native background push provider setup, physical-device keyboard/haptics/back/
installer tests, release signing/deployment and specialist-reviewed medical
translations are not complete. Closed-app/background delivery is best-effort
and platform-dependent. No deployment or signed release was created here.
Figma's student account reconnection is still needed to resume quota-limited
design work. No fictional capacities, automatic emergency calls or guaranteed
emergency-service integration were introduced.
