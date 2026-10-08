# Advanced features: practical next steps

Engineering review: 7 October 2026; authorized implementation pass: 8 October
2026. **Core backend additions and their companion frontend workflows are
implemented locally and regression tested, not deployed or verified on real
phones.** See the [stack implementation record](tech-stack-upgrade.md) for
frontend/native tools and verification. No provider credentials or paid services
were configured.
These are useful extensions, not claims of first-ever inventions or guaranteed
emergency help.

The prior app already contained offline queuing, incident corroboration, volunteer
acceptance/ETA, responder tracking, safety check-ins, drills, speech assistance,
translation, evidence explanations and optional web-push code. Code existing is
not proof that a deployment has its services, keys, permissions or devices ready.
Native Android background push is not established by browser notification APIs.

This shortlist refines the broader [feature ideas](11-feature-roadmap.md).
Prioritize receipts, location privacy and truthful outcomes before adding more
coordination or notification complexity. Existing native-interaction work is
separate from this incident-workflow work.

## 1. Offline Receipt: one submission, one durable server receipt

**Status:** Backend scoped UUID receipts, identical retry replay, conflicting
payload rejection and stable insert fencing are integrated into both creation
routes. Legacy requests without a submission ID remain supported. Anonymous
retryable requests also require an independent opaque `X-Anonymous-Client-ID`.
Creation-response snapshots contain report content and have a 30-day receipt
retention window; they do not contain bearer tokens or the anonymous capability.

**Existing:** [IndexedDB queue](../frontend/src/utils/offlineQueue.js#L134),
account-pinned retries, cross-tab/background-sync locking and
[queue status UI](../frontend/src/components/OfflineQueueStatus.jsx).
[Incident folding](../backend/app/routes/alerts.py#L468) links semantically similar
reports; it is not request-level retry idempotency. Durable retry behavior is now
provided by [submission receipts](../backend/app/services/submission_receipts.py)
and [creation-route integration](../backend/app/routes/alerts.py#L450), before
triage, rate-limit replay checks and broadcast side effects.

**Behavior target:** Saved on device -> Sending -> Server received -> Volunteer
accepted. Pending-report editing requires explicit version/idempotency rules.

**Safety:** Local save, restored connectivity, push acceptance and volunteer
acceptance do not mean help arrived. Scope keys to the submitting account or a
secure anonymous submission token; never expose receipts to another account.
Store no bearer tokens in IndexedDB. Same key with a different payload must
produce a conflict, not silently overwrite an emergency report.

**Acceptance tests:** Lose the response after a successful server insert, then
retry through both tab and worker: exactly one submitted report and the same
receipt. Test concurrent retries, account changes, anonymous access, transaction
abort, payload conflict and receipt retention. No false "sent" while only local.

## 2. Privacy Unlock: consent and freshness for shared location

**Status:** Incident-local sharing is off by default, including legacy alerts;
only the current lead can enable it for 1-120 minutes. Coordinates require an
unexpired consent and an observed socket position no older than 90 seconds.
Revocation, handoff and resolution disable sharing. Unknown accuracy remains
unknown. Profile/home coordinates are no longer a responder-tracking fallback.

**Source:** [Responder endpoint](../backend/app/routes/alerts.py#L814),
[observed-position helper](../backend/app/services/websocket.py#L137) and
[consent/freshness rules](../backend/app/services/alert_workflow.py). The previous
saved-home fallback and misleading "last known" behavior motivated this change.

**Behavior target:** Start/Stop sharing with freshness and accuracy; separate
internal dispatch precision from public location disclosure.

**Not yet implemented:** Approximate public incident/check-in coordinates and a
new participant-only precision policy. Public incident coordinates/photos remain
accessible under the existing public-share model. Tracker consent does not make
an anonymous public report unidentifiable; do not describe this pass as full
location privacy. This requires a deliberate form/API/map disclosure rollout.

**Safety:** Anonymous does not mean unidentifiable when precise coordinates or
recognizable photos are public. Decide incident-specific disclosure policy before
changing public-map precision, especially for violence/missing-person cases.
No default background tracking or indefinite location history.

**Acceptance tests:** Unrelated users cannot retrieve precise positions;
revocation, expiry and resolution stop disclosure; socket loss never reveals
home as a travelled position. Validate stale age/accuracy, anonymous reports and
all public list/detail/share payloads, not just visual marker rounding.

## 3. Truthful Outcome: incident history with explicit provenance

**Status:** Automatic cleanup retains the compatible status enum but explicitly
marks `expired_unconfirmed` or `practice_ended`; volunteer completion is
`volunteer_reported_resolved`, and the reporter can explicitly confirm safe.
Legacy manually resolved records without provenance are `resolution_unconfirmed`.
Public summaries omit private event actors and relay/consent data.

**Existing:** Triage reasons/confidence, evidence summaries, witness reports,
ETA and situational updates. [`_auto_resolve_stale`](../backend/app/routes/alerts.py#L171)
now records explicit outcome source/time alongside automatic cleanup;
[public workflow normalization](../backend/app/services/alert_workflow.py#L109)
provides safe historical defaults. Companion card/My Alerts/share UI work consumes
these outcome fields rather than treating every `resolved` value as proven safe.

**Behavior target:** Consistent timestamped outcome provenance across views;
routing urgency remains separate from factual verification.

**Safety:** Automatic expiry must never imply the danger ended. Preserve existing
enum/history compatibility; old unknown outcomes remain unknown. Reopening and
reporter confirmation require permission, auditability and abuse controls.

**Acceptance tests:** Expiring an unaccepted real report never displays "help
completed"; legacy records render safely; duplicate retries do not add repeated
events. All views agree on provenance. AI unavailable/unclear evidence does not
produce a verified or safe badge.

## 4. Help Relay: backup requests and acknowledged handoff

**Status:** Participant backup requests, bounded volunteer offers, a private
candidate list/inbox, 15-minute transfer offers, explicit accept/decline/cancel
and current-lead progress are implemented. Only acknowledgement changes the
lead; atomic conditions reject expired/replayed/changed ownership. Sharing and
ETA reset after transfer. Private notes/actors are not public feed data.

**Source:** [Alert coordination routes](../backend/app/routes/alerts.py#L1214),
manual ETA, updates and resource matching. No explicit emergency lead-transfer
workflow existed before this pass; paid-help work timelines remain separate.

**Behavior target:** Request backup with needed roles, offer/accept handoff, explicit
On the way/Arrived actions and a participant-visible history. Retain one
accountable lead until the replacement acknowledges the transfer.

**Safety:** Do not silently reopen because a socket disconnected or an ETA elapsed.
Do not direct untrained volunteers into violence, fire or gas hazards. Contacts
and private notes remain participant-only; self-declared skills are not verified.

**Acceptance tests:** Concurrent handoffs cannot assign two leads; an unauthorized
helper cannot take ownership; rejecting/timing out a transfer keeps responsibility
visible. Resolution/cancellation races preserve contacts and transition rules.

## 5. Opt-in matching with honest notification readiness

**Status:** Profile preference validation/storage, category/skill/radius matching
shared by live sockets and web push, immediate active-socket preference refresh,
and generic sensitive-text-free push previews by default are implemented.
Quiet hours remain push-only. Already accepted/resolved incidents are not newly
pushed as open incidents. `enabled` is a filter, not device notification permission.

**Source:** [Web-push code](../backend/app/services/push.py#L217), subscription
endpoints, [shared notification matching](../backend/app/services/notification_matching.py)
and profile controls. Closed-app web push still matches the saved profile area,
not a live/background position. Saved-neighbourhood collections are not added.
No deployed push configuration, native push service or real-device delivery was
verified in this review. Permission alone is not background delivery readiness.

**Remaining work:** Opted-in saved areas, per-device subscription health and a
native push adapter only after provider/deployment decisions. Name states precisely:
permission granted, service unavailable, registered, delivery unconfirmed.

**Safety:** Critical quiet-hour overrides must be explicit. Never promise
guaranteed delivery or infer response from provider acceptance. Avoid precise
coordinates and sensitive incident text on lock screens by default.

**Acceptance tests:** Unconfigured deployment never says "background ready";
denial/revocation/logout removes or disables the correct device subscription.
Test quiet-hour/timezone boundaries, duplicate notifications, matching parity,
stale/resolved alerts and offline devices. Provider success is not user receipt.

## 6. Reviewable multilingual assistance and text-first mode

**Status:** Existing speech/dictation/translation is preserved. A backward-compatible
`GET /api/alerts/{id}?include_photos=false` supports genuinely photo-free detail
responses for companion text-first UI; `photo_count` remains available. Companion
frontend work owns readback, cache clearing and text-first interaction verification.

**Existing:** Eleven UI languages, [guided voice drafts](../frontend/src/components/VoiceReportAssistant.jsx),
[native/web dictation](../frontend/src/hooks/useVoice.js#L21), original-text toggle
and [translation](../frontend/src/utils/translate.js#L148). On-device translation
is used where available; some speech/translation paths use third parties.
First-aid guidance currently supports English/Hindi, not every UI language.

**Behavior target:** User-triggered transcript readback, consistent localized status
controls, clear original/translation provenance, an exposed translation-cache
clear action, and optional text-first views that defer heavy maps/photos.
Extend medical guidance only with human-reviewed, source-dated translations.
Those extra reviewed medical languages are **not implemented** in this pass.

**Safety:** No automatic speech submission. Disclose external data paths;
preserve original descriptions. Do not present machine-translated medical or
authority instructions as authoritative or label cached information "live".

**Acceptance tests:** Recognition errors require review; unsupported speech and
translation still allow typing/original text. Test long Indic-script strings,
screen-reader focus/status announcements, large text, reduced motion, cache
clearing and low-bandwidth failure. Medical wording requires specialist review.

## Implementation boundary

Use the current React/Capacitor stack; no framework rewrite is needed to start.
Implement each proposal with scoped authorization and tests, then confirm the
actual deployment/device behavior. Provider credentials, native background
services, paid APIs and identity verification need separate configuration and
privacy decisions. No automatic emergency calls, fictional capacity data,
unverified clinical advice or emergency-service integration promises.
