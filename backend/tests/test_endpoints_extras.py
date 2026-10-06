"""Integration tests for the new endpoints added in the latest update:

  * GET    /api/alerts/{id}/photos     (lazy-load)
  * POST   /api/alerts/{id}/flag       (community moderation)
  * PATCH  /api/users/me/profile       (skills / vehicle / contacts)

These all go through the same FastAPI app + mock-Mongo plumbing as the
existing endpoint tests so the routing/auth wiring is exercised end-to-end.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.core.security import create_token


def _token(role: str = "reporter", sub: str | None = None) -> str:
    return create_token({"sub": sub or str(ObjectId()), "role": role})


# -----------------------------------------------------------------------
# /api/alerts/{id}/photos — lazy-loaded photo payload
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_photos_endpoint_returns_data_urls(client):
    c, db = client
    alert_id = ObjectId()
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": alert_id,
            "photos": ["data:image/jpeg;base64,xxx", "data:image/jpeg;base64,yyy"],
            "flags": 0,
        }
    )
    resp = await c.get(f"/api/alerts/{alert_id}/photos")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["photos"]) == 2
    assert body["photos"][0].startswith("data:image/")


@pytest.mark.asyncio
async def test_photos_endpoint_404_on_missing(client):
    c, db = client
    db.alerts.find_one = AsyncMock(return_value=None)
    resp = await c.get(f"/api/alerts/{ObjectId()}/photos")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_photos_endpoint_hides_flagged(client):
    c, db = client
    db.alerts.find_one = AsyncMock(
        return_value={"_id": ObjectId(), "photos": ["x"], "flags": 99}
    )
    resp = await c.get(f"/api/alerts/{ObjectId()}/photos")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_photos_endpoint_400_on_invalid_id(client):
    c, _ = client
    resp = await c.get("/api/alerts/not-a-real-id/photos")
    assert resp.status_code == 400


# -----------------------------------------------------------------------
# /api/alerts/{id}/flag — community moderation
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_requires_auth(client):
    c, _ = client
    resp = await c.post(f"/api/alerts/{ObjectId()}/flag")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_flag_rejects_self_flag(client):
    """A reporter can't flag their own alert."""
    c, db = client
    user_id = str(ObjectId())
    token = _token("reporter", sub=user_id)
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(user_id),
            "flagged_by": [],
            "flags": 0,
        }
    )
    resp = await c.post(
        f"/api/alerts/{ObjectId()}/flag",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_flag_idempotent_for_same_user(client):
    c, db = client
    user_id = str(ObjectId())
    token = _token("reporter", sub=user_id)
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(),  # different user
            "flagged_by": [user_id],
            "flags": 1,
        }
    )
    resp = await c.post(
        f"/api/alerts/{ObjectId()}/flag",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["already"] is True
    assert body["flags"] == 1


@pytest.mark.asyncio
async def test_flag_increments_count(client):
    c, db = client
    user_id = str(ObjectId())
    token = _token("reporter", sub=user_id)
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(),
            "flagged_by": [],
            "flags": 0,
        }
    )
    db.alerts.find_one_and_update = AsyncMock(return_value={"flags": 1})
    resp = await c.post(
        f"/api/alerts/{ObjectId()}/flag",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["already"] is False
    assert body["flags"] == 1


@pytest.mark.asyncio
async def test_flag_404_when_alert_gone(client):
    c, db = client
    db.alerts.find_one = AsyncMock(return_value=None)
    resp = await c.post(
        f"/api/alerts/{ObjectId()}/flag",
        headers={"Authorization": f"Bearer {_token('reporter')}"},
    )
    assert resp.status_code == 404


# -----------------------------------------------------------------------
# /api/users/me/profile — patch skills / vehicle / contacts
# -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_profile_update_rejects_empty_body(client):
    c, _ = client
    resp = await c.patch(
        "/api/users/me/profile",
        json={},  # no fields → 400
        headers={"Authorization": f"Bearer {_token('volunteer')}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_profile_update_rejects_unknown_skill(client):
    c, _ = client
    resp = await c.patch(
        "/api/users/me/profile",
        json={"skills": ["telepathy"]},  # not in the enum
        headers={"Authorization": f"Bearer {_token('volunteer')}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_profile_update_writes_skills_only(client):
    c, db = client
    db.users.find_one_and_update = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "name": "x",
            "email": "x@x.com",
            "role": "volunteer",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "skills": ["medical", "cpr"],
            "has_vehicle": False,
            "emergency_contacts": [],
            "created_at": "2024-01-01T00:00:00",
        }
    )
    resp = await c.patch(
        "/api/users/me/profile",
        json={"skills": ["medical", "cpr"]},
        headers={"Authorization": f"Bearer {_token('volunteer')}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["skills"] == ["medical", "cpr"]
    # Verify the $set call only included the requested field
    call = db.users.find_one_and_update.call_args
    update = call.args[1] if len(call.args) >= 2 else call.kwargs.get("update")
    assert "$set" in update
    assert set(update["$set"].keys()) == {"skills"}


@pytest.mark.asyncio
async def test_profile_update_caps_emergency_contacts(client):
    """The model's max_length=5 should reject 6 contacts."""
    c, _ = client
    resp = await c.patch(
        "/api/users/me/profile",
        json={
            "emergency_contacts": [
                {"name": f"Contact {i}", "phone": "+91" + str(i) * 10}
                for i in range(6)
            ]
        },
        headers={"Authorization": f"Bearer {_token('volunteer')}"},
    )
    assert resp.status_code == 422


# -----------------------------------------------------------------------
# Webhook service — fire-and-forget no-op when URL unset
# -----------------------------------------------------------------------


def test_webhook_no_op_when_url_unset(monkeypatch):
    from app.core import config as cfg
    from app.services import webhook

    monkeypatch.setattr(cfg.settings, "ALERT_WEBHOOK_URL", "")
    # Should not raise even though there's no event loop / asyncio context here
    webhook.fire_alert_created({"id": "abc"})


def test_webhook_payload_shape_is_minimal():
    from app.services.webhook import _webhook_payload

    payload = _webhook_payload(
        {
            "id": "alert-1",
            "category": "fire",
            "urgency": "CRITICAL",
            "description": "x",
            "status": "open",
            "address": "...",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "photo_count": 1,
            "verified_score": 80,
            "created_at": "2026-04-25T11:23:00+00:00",
            # These should NOT make it into the outbound payload
            "photos": ["data:image/jpeg;base64,LARGEBLOB"],
            "flagged_by": ["user-x"],
        }
    )
    assert payload["event"] == "alert.created"
    assert "photos" not in payload["alert"]
    assert "flagged_by" not in payload["alert"]
    assert payload["alert"]["photo_count"] == 1
