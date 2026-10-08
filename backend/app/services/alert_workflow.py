"""Incident-local consent and truthful, participant-only coordination views."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

POSITION_MAX_AGE = timedelta(seconds=90)
HANDOFF_TTL = timedelta(minutes=15)
PRIVATE_WORKFLOW_FIELDS = (
    "location_sharing", "backup", "handoff", "workflow_events", "outcome_actor_id",
    "_submission_key", "_submission_hash",
)


def now_utc():
    return datetime.now(timezone.utc)


def aware(value):
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def outcome_for(alert):
    if alert.get("outcome"):
        return alert["outcome"]
    if alert.get("status") != "resolved":
        return None
    if alert.get("auto_resolved"):
        return "practice_ended" if alert.get("is_drill") else "expired_unconfirmed"
    # A legacy status alone does not prove who resolved it or that help arrived.
    return "resolution_unconfirmed"


def sharing_for(alert, now=None):
    now = now or now_utc()
    sharing = alert.get("location_sharing") or {}
    expires = aware(sharing.get("expires_at"))
    enabled = bool(
        alert.get("status") == "accepted"
        and sharing.get("enabled") is True
        and str(sharing.get("volunteer_id")) == str(alert.get("accepted_by"))
        and expires and expires > now
    )
    return {"enabled": enabled, "expires_at": expires if enabled else None}


def pending_handoff(alert, now=None):
    handoff = alert.get("handoff") or {}
    expires = aware(handoff.get("expires_at"))
    if (
        alert.get("status") == "accepted" and expires and expires > (now or now_utc())
        and str(handoff.get("from_volunteer_id")) == str(alert.get("accepted_by"))
    ):
        return handoff
    return None


def participant_roles(alert, user_id):
    user_id = str(user_id)
    reporter = str(alert.get("reporter_id")) == user_id and not alert.get("is_anonymous")
    lead = bool(alert.get("accepted_by")) and str(alert["accepted_by"]) == user_id
    handoff = pending_handoff(alert)
    invited = bool(handoff and str(handoff.get("to_volunteer_id")) == user_id)
    return reporter, lead, invited


def coordination_for(alert, user_id):
    reporter, lead, invited = participant_roles(alert, user_id)
    if not (reporter or lead or invited):
        raise HTTPException(403, "Only incident participants can read coordination")
    backup = alert.get("backup") or {}
    handoff = pending_handoff(alert)
    offers = backup.get("offers") or []
    if invited and not (reporter or lead):
        offers = [offer for offer in offers if str(offer.get("volunteer_id")) == str(user_id)]
    active = alert.get("status") == "accepted"
    return {
        "alert_id": str(alert["_id"]), "status": alert.get("status"),
        "lead_id": str(alert["accepted_by"]) if alert.get("accepted_by") else None,
        "progress": alert.get("response_progress"), "outcome": outcome_for(alert),
        "outcome_at": alert.get("outcome_at") or alert.get("resolved_at"),
        "location_sharing": sharing_for(alert) if not invited or lead else {"enabled": False, "expires_at": None},
        "backup": {
            "requested": bool(active and backup.get("requested")),
            "needed_skills": backup.get("needed_skills") or [],
            "note": backup.get("note", "") if reporter or lead else "",
            "requested_at": backup.get("requested_at"), "offers": offers,
        },
        "handoff": handoff,
        "events": alert.get("workflow_events", []) if reporter or lead else [],
        "can_manage": bool(active and (reporter or lead)),
        "can_share_location": bool(active and lead),
        "can_handoff": bool(active and lead),
        "can_confirm_safe": bool(reporter and alert.get("status") in ("accepted", "resolved") and not alert.get("is_drill")),
        "can_accept_handoff": bool(invited and active),
    }


def workflow_event(action, user_id=None, now=None):
    return {"action": action, "at": now or now_utc(), "actor_id": str(user_id) if user_id else None}


def event_update(action, user_id=None, now=None):
    # Bound document growth; private event actors never leave public serializers.
    return {"$each": [workflow_event(action, user_id, now)], "$slice": -100}


def public_workflow(alert):
    """Mutate only the passed public copy, never the stored participant details."""
    alert["outcome"] = outcome_for(alert)
    alert.setdefault("outcome_at", alert.get("resolved_at"))
    alert.setdefault("outcome_source", "automatic" if alert.get("auto_resolved") else None)
    alert.setdefault("response_progress", "accepted" if alert.get("status") == "accepted" else None)
    backup = alert.get("backup") or {}
    # Serialization can precede WS fan-out: retain the already-safe summary.
    requested = backup.get("requested") if "backup" in alert else alert.get("backup_requested", False)
    skills = backup.get("needed_skills") if "backup" in alert else alert.get("backup_needed_skills", [])
    alert["backup_requested"] = bool(alert.get("status") == "accepted" and requested)
    alert["backup_needed_skills"] = (skills or []) if alert["backup_requested"] else []
    for key in PRIVATE_WORKFLOW_FIELDS:
        alert.pop(key, None)
    return alert
