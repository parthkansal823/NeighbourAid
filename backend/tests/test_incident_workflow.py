"""Consent, participant isolation and conditional incident workflow writes."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from bson import ObjectId
from fastapi import HTTPException
import pytest

from app.core.security import create_token
from app.services.alert_workflow import coordination_for, public_workflow
from app.services.websocket import ConnectionManager


def headers(uid, role="volunteer"):
    return {"Authorization": f"Bearer {create_token({'sub': str(uid), 'role': role})}"}


def incident(reporter=None, lead=None, **extra):
    return {
        "_id": ObjectId(), "reporter_id": reporter or ObjectId(),
        "accepted_by": lead or ObjectId(), "status": "accepted", "category": "medical",
        "urgency": "HIGH", "description": "A neighbour needs medical help",
        "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        "created_at": datetime.now(timezone.utc), "resolved_at": None, **extra,
    }


def test_public_serializer_strips_relay_notes_and_actor_data():
    doc = incident(
        location_sharing={"enabled": True}, handoff={"id": str(uuid4())},
        backup={"requested": True, "needed_skills": ["medical"], "note": "private"},
        workflow_events=[{"actor_id": "private actor"}], outcome_actor_id="actor",
    )
    result = public_workflow(doc)
    assert result["backup_requested"] is True
    assert result["backup_needed_skills"] == ["medical"]
    assert not {"location_sharing", "handoff", "backup", "workflow_events", "outcome_actor_id"}.intersection(result)


def test_route_serializer_strips_submission_capability_metadata():
    from app.routes.alerts import _serialize
    result = _serialize(incident(_submission_key="private key", _submission_hash="private hash"))
    assert "_submission_key" not in result
    assert "_submission_hash" not in result


def test_safe_summary_survives_repeat_serialization_before_websocket():
    doc = incident(backup={"requested": True, "needed_skills": ["medical"], "note": "private"})
    first = public_workflow(doc)
    second = public_workflow({**first})
    assert second["backup_requested"] is True
    assert second["backup_needed_skills"] == ["medical"]


@pytest.mark.asyncio
async def test_websocket_broadcast_never_includes_receipt_or_relay_secrets(monkeypatch):
    from app.services import websocket
    monkeypatch.setattr(websocket, "_schedule_push", lambda *_args: None)
    manager = ConnectionManager()
    socket = SimpleNamespace(send_text=AsyncMock())
    manager.register("viewer", socket, [76.7, 30.7])
    await manager.broadcast_nearby(incident(_submission_key="secretkey", _submission_hash="secrethash", backup={"requested": True, "note": "secretnote"}, workflow_events=[{"actor_id": "secretactor"}]))
    body = socket.send_text.await_args.args[0]
    assert "secretkey" not in body and "secrethash" not in body
    assert "secretnote" not in body and "secretactor" not in body


@pytest.mark.parametrize("is_drill,outcome", [(False, "expired_unconfirmed"), (True, "practice_ended")])
def test_legacy_automatic_resolution_is_never_confirmed_safe(is_drill, outcome):
    assert public_workflow(incident(status="resolved", auto_resolved=True, is_drill=is_drill))["outcome"] == outcome
    assert public_workflow(incident(status="resolved"))["outcome"] == "resolution_unconfirmed"


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["disabled", "expired", "live", "stale", "offline"])
async def test_tracking_requires_consent_and_recent_observation(client, monkeypatch, state):
    from app.routes import alerts
    c, db = client
    reporter, lead = ObjectId(), ObjectId()
    now = datetime.now(timezone.utc)
    doc = incident(reporter, lead, location_sharing={
        "enabled": state != "disabled", "volunteer_id": str(lead),
        "expires_at": now + timedelta(minutes=-1 if state == "expired" else 10),
    })
    db.alerts.find_one = AsyncMock(return_value=doc)
    db.users.find_one = AsyncMock(return_value={"name": "Volunteer", "location": {"coordinates": [0, 0]}})
    manager = ConnectionManager()
    if state != "offline":
        manager.register(str(lead), object(), [76.8, 30.8])
        if state == "stale":
            manager._positions[str(lead)]["updated_at"] = now - timedelta(minutes=3)
    monkeypatch.setattr(alerts, "manager", manager)
    response = await c.get(f"/api/alerts/{doc['_id']}/responder", headers=headers(reporter, "reporter"))
    assert response.status_code == 200
    result = response.json()
    assert result["coordinates"] == ([76.8, 30.8] if state == "live" else None)
    assert result["live"] is (state == "live")
    assert result["freshness_seconds"] == 90
    assert "location" not in db.users.find_one.await_args.args[1]


@pytest.mark.parametrize("invalid", ["expired", "wrong_lead"])
def test_expired_or_wrong_lead_handoff_cannot_grant_private_access(invalid):
    target = ObjectId()
    lead = ObjectId()
    doc = incident(lead=lead, handoff={"from_volunteer_id": "wrong lead" if invalid == "wrong_lead" else str(lead), "to_volunteer_id": str(target), "expires_at": datetime.now(timezone.utc) + timedelta(minutes=-1 if invalid == "expired" else 5)})
    with pytest.raises(HTTPException) as error:
        coordination_for(doc, str(target))
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_receipt_replay_skips_triage_and_rate_limit(client, monkeypatch):
    from app.routes import alerts
    c, _db = client
    replay = {"id": str(ObjectId()), "status": "open"}
    monkeypatch.setattr(alerts, "begin_submission", AsyncMock(return_value=SimpleNamespace(replay=replay, persisted_alert=None)))
    triage = MagicMock(side_effect=AssertionError("replay must not triage"))
    monkeypatch.setattr(alerts, "ai_triage", triage)
    monkeypatch.setattr(alerts.anonymous_alert_limiter, "allow", lambda _ip: False)
    body = {"category": "medical", "description": "A neighbour needs assistance", "location": {"type": "Point", "coordinates": [76.7, 30.7]}, "client_submission_id": str(uuid4())}
    assert (await c.post("/api/alerts/anonymous", json=body)).json() == replay
    assert (await c.post("/api/alerts/", json=body, headers=headers(ObjectId(), "reporter"))).json() == replay
    triage.assert_not_called()


@pytest.mark.asyncio
async def test_handoff_accept_is_conditional_and_resets_tracking(client, monkeypatch):
    from app.routes import alerts
    c, db = client
    lead, target, stranger = ObjectId(), ObjectId(), ObjectId()
    handoff_id = str(uuid4())
    doc = incident(lead=lead, handoff={
        "id": handoff_id, "from_volunteer_id": str(lead), "to_volunteer_id": str(target),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    })

    async def compare_and_swap(query, update, **_kwargs):
        assert query["status"] == "accepted"
        assert query["$expr"] == {"$eq": [{"$toString": "$accepted_by"}, "$handoff.from_volunteer_id"]}
        offer = doc.get("handoff")
        if not offer or query["handoff.to_volunteer_id"] != offer["to_volunteer_id"]:
            return None
        assert query["handoff.id"] == offer["id"]
        assert query["handoff.expires_at"]["$gt"] < offer["expires_at"]
        doc.update(update["$set"])
        return {**doc}

    db.alerts.find_one_and_update = AsyncMock(side_effect=compare_and_swap)
    broadcast = AsyncMock()
    monkeypatch.setattr(alerts.manager, "broadcast_nearby", broadcast)
    endpoint = f"/api/alerts/{doc['_id']}/handoff/accept"
    assert (await c.post(endpoint, json={"handoff_id": handoff_id}, headers=headers(stranger))).status_code == 409
    response = await c.post(endpoint, json={"handoff_id": handoff_id}, headers=headers(target))
    assert response.status_code == 200
    assert doc["accepted_by"] == target
    assert doc["location_sharing"] == {"enabled": False}
    assert doc["eta_minutes"] is None
    assert (await c.post(endpoint, json={"handoff_id": handoff_id}, headers=headers(target))).status_code == 409
    with pytest.raises(HTTPException):
        coordination_for(doc, str(lead))
    assert broadcast.await_count == 1
    assert "handoff" not in broadcast.await_args.args[0]


@pytest.mark.asyncio
async def test_auto_expiry_sets_truthful_outcome_not_help_confirmation(client):
    from app.routes.alerts import _auto_resolve_stale
    _c, db = client
    db.alerts.update_many = AsyncMock()
    await _auto_resolve_stale(db)
    practice, real = db.alerts.update_many.await_args_list
    assert practice.args[1]["$set"]["outcome"] == "practice_ended"
    assert real.args[1]["$set"]["outcome"] == "expired_unconfirmed"
    assert real.args[1]["$set"]["outcome_source"] == "automatic"
    assert real.args[1]["$set"]["location_sharing"] == {"enabled": False}


@pytest.mark.asyncio
async def test_backup_offers_are_bounded_and_do_not_grant_private_access(client):
    c, db = client
    volunteer = ObjectId()
    db.users.find_one = AsyncMock(return_value={"role": "volunteer", "name": "Backup"})
    db.alerts.find_one_and_update = AsyncMock(return_value=incident())
    response = await c.post(f"/api/alerts/{ObjectId()}/backup/offer", json={"note": "Available"}, headers=headers(volunteer))
    assert response.status_code == 200
    assert response.json() == {"offered": True, "alert_id": response.json()["alert_id"], "volunteer_id": str(volunteer)}
    query = db.alerts.find_one_and_update.await_args.args[0]
    assert query["backup.offers.19"] == {"$exists": False}
    assert query["backup.offers.volunteer_id"] == {"$ne": str(volunteer)}
    assert query["backup.requested"] is True
    assert query["status"] == "accepted"


@pytest.mark.asyncio
async def test_consent_write_belongs_to_current_lead_and_has_bounded_expiry(client, monkeypatch):
    from app.routes import alerts
    c, db = client
    volunteer = ObjectId()
    doc = incident(lead=volunteer)
    db.alerts.find_one_and_update = AsyncMock(return_value=doc)
    monkeypatch.setattr(alerts.manager, "broadcast_nearby", AsyncMock())
    endpoint = f"/api/alerts/{doc['_id']}/location-sharing"
    assert (await c.patch(endpoint, json={"enabled": True, "duration_minutes": 121}, headers=headers(volunteer))).status_code == 422
    assert (await c.patch(endpoint, json={"enabled": True, "duration_minutes": 30}, headers=headers(volunteer))).status_code == 200
    query, update = db.alerts.find_one_and_update.await_args.args
    assert query["accepted_by"] == volunteer
    assert query["status"] == "accepted"
    assert update["$set"]["location_sharing"]["expires_at"] > datetime.now(timezone.utc)


def test_matching_respects_categories_skills_radius_and_opt_out():
    from app.services.notification_matching import matching
    alert = {"category": "medical"}
    assert matching(alert, distance_km=10, skills=["medical"])[0] is True
    assert matching(alert, distance_km=10, skills=["medical"], raw_preferences={"skill_matching": False})[0] is False
    assert matching(alert, distance_km=2, raw_preferences={"categories": ["fire"]})[0] is False
    assert matching(alert, distance_km=2, raw_preferences={"enabled": False})[0] is False
    assert matching(alert, distance_km=2, raw_preferences={"radius_km": 1})[0] is False


def test_push_lock_screen_preview_is_private_by_default():
    from app.services.push import _notification
    alert = {"description": "Private medical details", "address": "Exact home address"}
    payload = _notification(alert)
    assert "Private medical details" not in payload["body"]
    assert payload["where"] == ""
    assert _notification(alert, include_sensitive_preview=True)["body"] == "Private medical details"


@pytest.mark.asyncio
async def test_text_first_detail_omits_photo_payload_but_preserves_count(client):
    c, db = client
    doc = incident(photos=["data:image/png;base64,picture"], photo_count=1)
    db.alerts.find_one = AsyncMock(return_value={**doc})
    response = await c.get(f"/api/alerts/{doc['_id']}?include_photos=false")
    assert response.status_code == 200
    assert "photos" not in response.json()
    assert response.json()["photo_count"] == 1
