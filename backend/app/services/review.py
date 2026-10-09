"""Server-authoritative two-stage review for newly created alerts.

The phone may run an optional local model for its own UX, but it never gets
to approve, restrict, or otherwise authorise an alert.  Only this module's
server-side calls to locally mounted llama.cpp GGUF models can change review
state.  Missing models, malformed output, timeouts, and load failures always
fall back to the deterministic visibility policy.

The first model is intentionally fast and conservative.  An explicit first
approval makes a deterministic MEDIUM/LOW report public immediately while the
stronger verifier continues. If the small model is uncertain, the report stays
held only while the local stronger verifier decides; otherwise it fails open.
Deterministic CRITICAL/HIGH reports are visible immediately and can never be
hidden automatically by either model. The verifier can restrict only a
non-emergency report it identifies as clearly non-actionable or spam.
"""

from __future__ import annotations

import logging

from bson import ObjectId

from .llm import (
    first_review,
    is_enabled as first_review_enabled,
    verifier_is_enabled,
    verify,
)
from .webhook import fire_alert_created
from .websocket import manager

log = logging.getLogger(__name__)

IMMEDIATE_URGENCIES = frozenset({"CRITICAL", "HIGH"})
_NONPUBLIC_VISIBILITIES = frozenset({"held", "restricted"})


def initial_review_fields(urgency: str) -> dict:
    """Return persisted review fields for a brand-new alert.

    An absent first-pass model means no new gates and no new persisted status:
    old installs keep their exact pre-review visibility behaviour.  The caller
    runs this after deterministic triage and before inserting the alert.
    """
    if not first_review_enabled():
        return {}
    if urgency in IMMEDIATE_URGENCIES:
        return {
            "review_status": "provisional",
            "review_visibility": "public",
            "first_review_status": "pending",
            "second_review_status": "not_started",
        }
    return {
        "review_status": "pending_first_review",
        "review_visibility": "held",
        "first_review_status": "pending",
        "second_review_status": "not_started",
    }


def is_publicly_visible(alert: dict | None) -> bool:
    """Whether a document belongs in public feeds and share endpoints.

    Documents written before this feature have no ``review_visibility`` and
    therefore remain visible.  That preserves the no-model and migration
    behaviour without requiring a data backfill.
    """
    return bool(alert) and alert.get("review_visibility") not in _NONPUBLIC_VISIBILITIES


def _incident_for_review(alert: dict) -> dict:
    """Give both models bounded, useful incident context without client control.

    The description is still the evidence; the category, deterministic triage
    and headline prevent a small first-pass model from mistaking a clear civic
    report for a generic chat message. Do not include identities, photos,
    location precision, or internal moderation fields.
    """
    return {
        "category": str(alert.get("category") or "other"),
        "triage_urgency": str(alert.get("urgency") or "MEDIUM"),
        "headline": str(alert.get("headline") or ""),
        "description": str(alert.get("description") or ""),
    }


async def _reload(db, alert_id: ObjectId) -> dict | None:
    try:
        return await db.alerts.find_one({"_id": alert_id})
    except Exception:  # noqa: BLE001 -- best-effort review must not fail creation
        log.info("AI review could not read an alert")
        return None


async def _store_transition(db, before: dict, changes: dict) -> dict | None:
    """Store one review state transition without overwriting a newer one."""
    alert_id = before.get("_id")
    if not isinstance(alert_id, ObjectId):
        return None
    query = {"_id": alert_id, "review_status": before.get("review_status")}
    try:
        result = await db.alerts.update_one(query, {"$set": changes})
    except Exception:  # noqa: BLE001 -- fail open in the already-stored state
        log.info("AI review could not persist a state transition")
        return None
    # Another worker may have completed a later stage while this model was
    # running. Never reload/broadcast that newer state as if this worker had
    # written it; the compare-and-set is the ownership boundary.
    if getattr(result, "matched_count", 1) != 1:
        return None
    return await _reload(db, alert_id)


async def _broadcast_public(alert: dict, *, created: bool = False) -> None:
    """Deliver a public review result without leaking internal stage fields."""
    if not is_publicly_visible(alert):
        return
    try:
        # Import lazily: alerts imports this service when it creates an alert.
        from ..routes.alerts import _serialize  # noqa: PLC0415

        payload = _serialize(dict(alert), include_photos=False)
        await manager.broadcast_nearby(payload)
        if created:
            fire_alert_created(payload)
    except Exception:  # noqa: BLE001 -- notification failure cannot alter review state
        log.info("AI review broadcast failed")


async def _broadcast_restriction(alert: dict) -> None:
    """Tell currently connected volunteers to remove a newly restricted card."""
    try:
        await manager.broadcast_restriction(alert)
    except Exception:  # noqa: BLE001 -- REST filtering remains authoritative
        log.info("AI review restriction broadcast failed")


async def _run_second_review(db, candidate: dict) -> None:
    """Run the stronger verifier after approval or a held first-pass doubt."""
    if not verifier_is_enabled():
        return

    was_public = is_publicly_visible(candidate)
    decision = await verify(_incident_for_review(candidate))
    if decision is None:
        # A verifier outage is not a moderation result. A report which was
        # held only for that verifier must be published rather than silently
        # black-holed; a public report remains public without a false badge.
        changes = {"second_review_status": "unavailable"}
        if not was_public:
            changes.update({"review_status": "unreviewed", "review_visibility": "public"})
        updated = await _store_transition(db, candidate, changes)
        if updated and is_publicly_visible(updated) and not was_public:
            await _broadcast_public(updated, created=True)
        return

    emergency = candidate.get("urgency") in IMMEDIATE_URGENCIES
    if decision == "REVIEWED":
        changes = {
            "review_status": "reviewed",
            "review_visibility": "public",
            "second_review_status": "reviewed",
        }
    elif decision == "NEEDS_REVIEW":
        changes = {
            "review_status": "needs_review",
            "review_visibility": "public",
            "second_review_status": "needs_review",
        }
    elif decision == "RESTRICT" and not emergency:
        changes = {
            "review_status": "restricted",
            "review_visibility": "restricted",
            "second_review_status": "restricted",
        }
    elif decision == "RESTRICT":
        # A model must never auto-hide an emergency.  Keep it in the feed and
        # leave a truthful signal for a human/operator to inspect later.
        changes = {
            "review_status": "needs_review",
            "review_visibility": "public",
            "second_review_status": "restricted_emergency_override",
        }
    else:
        return

    updated = await _store_transition(db, candidate, changes)
    if not updated:
        return
    if changes["review_visibility"] == "restricted":
        await _broadcast_restriction(updated)
    else:
        # A held first-pass doubt is published for the first time only after
        # this stronger review, so it needs the same created/webhook fan-out
        # as a direct first-pass approval.
        await _broadcast_public(updated, created=not was_public)


async def run_two_stage_review(db, alert_id: ObjectId) -> None:
    """Advance an alert through server-side model review when applicable.

    This is intentionally called from a detached post-insert task.  No model
    loading or inference occurs on the HTTP request path, and callers always
    retain the durable alert even when this work fails.
    """
    before = await _reload(db, alert_id)
    if not before or before.get("status") == "resolved":
        return
    status = before.get("review_status")
    if status not in {"pending_first_review", "provisional"}:
        return

    was_public = is_publicly_visible(before)
    decision = await first_review(_incident_for_review(before))
    emergency = before.get("urgency") in IMMEDIATE_URGENCIES
    if decision == "APPROVE":
        changes = {
            "review_status": "approved",
            "review_visibility": "public",
            "first_review_status": "approved",
            "second_review_status": "pending" if verifier_is_enabled() else "not_configured",
        }
    elif decision == "NEEDS_REVIEW":
        # The small first-pass model is useful for the quick clear approval,
        # but it is not reliable enough to leave a genuine civic report hidden
        # forever. Send uncertain non-emergencies to local Qwen while held;
        # if the verifier is absent, publish with an honest uncertainty label.
        second_ready = verifier_is_enabled()
        changes = {
            "review_status": (
                "pending_second_review" if second_ready and not emergency else "needs_review"
            ),
            "review_visibility": "public" if emergency or not second_ready else "held",
            "first_review_status": "needs_review",
            "second_review_status": "pending" if second_ready else "not_configured",
        }
    else:
        # Model saturation, malformed output, model failure and a missing
        # file after startup all retain the pre-feature deterministic policy.
        changes = {
            "review_status": "unreviewed",
            "review_visibility": "public",
            "first_review_status": "unavailable",
            "second_review_status": "not_started",
        }

    updated = await _store_transition(db, before, changes)
    if not updated:
        return

    is_now_public = is_publicly_visible(updated)
    if is_now_public:
        # A held alert's first broadcast and webhook occur only now. Existing
        # provisional emergency cards get a normal update frame instead.
        await _broadcast_public(updated, created=not was_public)

    if decision in {"APPROVE", "NEEDS_REVIEW"} and verifier_is_enabled():
        await _run_second_review(db, updated)
