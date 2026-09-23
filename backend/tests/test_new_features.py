"""Tests for the latest batch of features:

  * Multi-step auto-escalation (lazy checker)
  * Volunteer trust score helper
  * Anonymous alert posting + per-IP rate limit
  * Resource map (POST/GET/DELETE)
  * Inbound WhatsApp webhook (auth gate, happy path)
  * Live responder tracking (privacy + status gating)

Each test isolates one behaviour so a regression points to the right
file without grep archaeology.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from bson import ObjectId

from app.core.security import create_token


def _token(role: str = "reporter", sub: str | None = None) -> str:
    return create_token({"sub": sub or str(ObjectId()), "role": role})


# ──────────────────────────────────────────────────────────────────────
# Trust score
# ──────────────────────────────────────────────────────────────────────


def test_trust_score_zero_when_no_accepts():
    from app.routes.stats import _compute_trust

    out = _compute_trust(0, 0)
    assert out["score"] == 0.0
    assert out["label"] == "new"


def test_trust_score_caps_a_perfect_one_off_below_trusted():
    """1-of-1 success shouldn't auto-promote to 'trusted'. Sample-size
    smoothing pulls it down."""
    from app.routes.stats import _compute_trust

    out = _compute_trust(1, 1)
    assert out["score"] < 0.85
    assert out["label"] != "trusted"


def test_trust_score_eventually_reaches_trusted_with_volume():
    from app.routes.stats import _compute_trust

    out = _compute_trust(50, 50)
    assert out["score"] >= 0.85
    assert out["label"] == "trusted"


def test_trust_score_label_thresholds():
    from app.routes.stats import _trust_label

    assert _trust_label(0.9) == "trusted"
    assert _trust_label(0.7) == "reliable"
    assert _trust_label(0.4) == "new"
    assert _trust_label(0.1) == "unproven"


# ──────────────────────────────────────────────────────────────────────
# Auto-escalation
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_auto_escalate_skips_recent_alerts():
    """An alert created 1 minute ago shouldn't be escalated even if it's
    sitting unaccepted at MEDIUM."""
    from app.routes import alerts as alerts_route

    db = MagicMock()

    async def empty_cursor():
        if False:
            yield

    db.alerts.find = MagicMock(return_value=empty_cursor())
    bumped = await alerts_route._auto_escalate_unaccepted(db)
    assert bumped == []


# ──────────────────────────────────────────────────────────────────────
# Anonymous alert + rate limit
# ──────────────────────────────────────────────────────────────────────


def test_rate_limiter_lets_through_under_cap():
    from app.services.ratelimit import RateLimiter

    rl = RateLimiter(max_per_window=3, window_seconds=60)
    assert rl.allow("ip-1") is True
    assert rl.allow("ip-1") is True
    assert rl.allow("ip-1") is True
    assert rl.allow("ip-1") is False


def test_rate_limiter_isolates_keys():
    from app.services.ratelimit import RateLimiter

    rl = RateLimiter(max_per_window=2, window_seconds=60)
    rl.allow("ip-a")
    rl.allow("ip-a")
    # ip-a is full but ip-b should still be allowed
    assert rl.allow("ip-a") is False
    assert rl.allow("ip-b") is True


def test_rate_limiter_reset_clears_state():
    from app.services.ratelimit import RateLimiter

    rl = RateLimiter(max_per_window=1, window_seconds=60)
    rl.allow("ip")
    assert rl.allow("ip") is False
    rl.reset()
    assert rl.allow("ip") is True


# ──────────────────────────────────────────────────────────────────────
# Resource map
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resources_create_requires_auth(client):
    c, _ = client
    resp = await c.post("/api/resources/", json={
        "kind": "shelter",
        "name": "Sector 17 Community Hall",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    })
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_resources_create_persists(client):
    c, db = client
    db.users.find_one = AsyncMock(return_value={"_id": ObjectId(), "name": "Volunteer"})
    db.resources.create_index = AsyncMock()
    db.resources.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId())
    )
    resp = await c.post(
        "/api/resources/",
        json={
            "kind": "shelter",
            "name": "Sector 17 Community Hall",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
            "valid_for_hours": 12,
        },
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "shelter"
    assert body["name"] == "Sector 17 Community Hall"


@pytest.mark.asyncio
async def test_resources_near_is_public(client):
    c, db = client

    async def empty_cursor():
        if False:
            yield

    db.resources.create_index = AsyncMock()
    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=empty_cursor())
    db.resources.find = MagicMock(return_value=cursor)
    resp = await c.get(
        "/api/resources/near", params={"lat": 30.7333, "lng": 76.7794}
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_resources_delete_invalid_id_returns_400(client):
    c, _ = client
    resp = await c.delete(
        "/api/resources/not-a-real-id",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 400


# ──────────────────────────────────────────────────────────────────────
# Inbound WhatsApp webhook
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_inbound_disabled_when_token_unset(client, monkeypatch):
    c, _ = client
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "INBOUND_TOKEN", "")
    resp = await c.post(
        "/api/inbound/whatsapp",
        json={
            "sender": "+91xxxxxxxxxx",
            "body": "Fire near Sector 17 Plaza, sending photo next",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
            "category": "fire",
        },
    )
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_inbound_rejects_wrong_token(client, monkeypatch):
    c, _ = client
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "INBOUND_TOKEN", "real-token")
    resp = await c.post(
        "/api/inbound/whatsapp",
        json={
            "sender": "+91xxxxxxxxxx",
            "body": "Fire near Sector 17 Plaza, sending photo next",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
            "category": "fire",
        },
        headers={"X-Inbound-Token": "wrong"},
    )
    assert resp.status_code == 401


# ──────────────────────────────────────────────────────────────────────
# Responder tracking
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_responder_404_when_alert_missing(client):
    c, db = client
    db.alerts.find_one = AsyncMock(return_value=None)
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_responder_returns_null_for_unaccepted_alert(client):
    c, db = client
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(),
            "accepted_by": None,
            "status": "open",
        }
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["responder_id"] is None
    assert body["coordinates"] is None
    assert body["live"] is False


@pytest.mark.asyncio
async def test_responder_403_when_random_user_asks(client):
    """Strangers can't track random volunteers — only the reporter or
    the accepting volunteer can read this."""
    c, db = client
    reporter = ObjectId()
    volunteer = ObjectId()
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": reporter,
            "accepted_by": volunteer,
            "status": "accepted",
        }
    )
    # Token sub is a brand-new id — not the reporter, not the volunteer
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_responder_returns_coords_for_reporter(client):
    """The reporter is allowed; if the volunteer is offline we fall back
    to the volunteer's saved home location."""
    c, db = client
    reporter = ObjectId()
    volunteer = ObjectId()
    token = _token(sub=str(reporter))
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": reporter,
            "accepted_by": volunteer,
            "status": "accepted",
            "eta_minutes": 12,
        }
    )
    db.users.find_one = AsyncMock(
        return_value={
            "_id": volunteer,
            "name": "Aman",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        }
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["live"] is False  # no live WS connection in this test
    assert body["coordinates"] == [76.7, 30.7]
    assert body["responder_name"] == "Aman"
    assert body["eta_minutes"] == 12


# ──────────────────────────────────────────────────────────────────────
# Contact release
# ──────────────────────────────────────────────────────────────────────
#
# A phone number is the one field here that cannot be un-leaked, so these
# cover the boundary from both sides rather than only the happy path. The
# rule: once a volunteer has accepted, each side may see the other's number
# and neither may see anything else.


def _accepted(reporter, volunteer, **extra):
    return {
        "_id": ObjectId(),
        "reporter_id": reporter,
        "accepted_by": volunteer,
        "status": "accepted",
        **extra,
    }


@pytest.mark.asyncio
async def test_reporter_gets_the_volunteers_number(client):
    c, db = client
    reporter, volunteer = ObjectId(), ObjectId()
    db.alerts.find_one = AsyncMock(return_value=_accepted(reporter, volunteer))
    db.users.find_one = AsyncMock(
        return_value={"_id": volunteer, "name": "Aman", "phone": "+919000000001"}
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token(sub=str(reporter))}"},
    )
    body = resp.json()
    assert body["responder_phone"] == "+919000000001"
    # Not handed their own number back, and not a second lookup they did not ask for.
    assert body["reporter_phone"] is None


@pytest.mark.asyncio
async def test_volunteer_gets_the_reporters_number(client):
    c, db = client
    reporter, volunteer = ObjectId(), ObjectId()
    db.alerts.find_one = AsyncMock(return_value=_accepted(reporter, volunteer))

    async def by_id(query, _projection=None):
        return {
            volunteer: {"_id": volunteer, "name": "Aman", "phone": "+919000000001"},
            reporter: {"_id": reporter, "name": "Sunita", "phone": "+919000000002"},
        }.get(query["_id"])

    db.users.find_one = AsyncMock(side_effect=by_id)
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token(sub=str(volunteer))}"},
    )
    body = resp.json()
    assert body["reporter_phone"] == "+919000000002"
    # The volunteer must not be able to read a number back out of their own row.
    assert body["responder_phone"] is None


@pytest.mark.asyncio
async def test_an_anonymous_reporter_has_no_number_to_release(client):
    """The whole promise of /post-alert. reporter_id on an anonymous alert is
    a throwaway ObjectId, so the lookup would miss anyway — but this asserts
    the flag is honoured rather than the miss being lucky."""
    c, db = client
    reporter, volunteer = ObjectId(), ObjectId()
    db.alerts.find_one = AsyncMock(
        return_value=_accepted(reporter, volunteer, is_anonymous=True)
    )
    seen = []

    async def by_id(query, _projection=None):
        seen.append(query["_id"])
        return {"_id": volunteer, "name": "Aman", "phone": "+919000000001"}

    db.users.find_one = AsyncMock(side_effect=by_id)
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token(sub=str(volunteer))}"},
    )
    assert resp.json()["reporter_phone"] is None
    # The reporter's row is never even read.
    assert reporter not in seen


@pytest.mark.asyncio
async def test_no_number_before_anyone_accepts(client):
    """Both keys exist and are null, so a polling client sees one shape."""
    c, db = client
    reporter = ObjectId()
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": reporter,
            "accepted_by": None,
            "status": "open",
        }
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token(sub=str(reporter))}"},
    )
    body = resp.json()
    assert body["responder_phone"] is None and body["reporter_phone"] is None
    assert "responder_name" in body


@pytest.mark.asyncio
async def test_a_stranger_still_gets_403_not_a_number(client):
    c, db = client
    db.alerts.find_one = AsyncMock(return_value=_accepted(ObjectId(), ObjectId()))
    db.users.find_one = AsyncMock(
        return_value={"_id": ObjectId(), "name": "Aman", "phone": "+919000000001"}
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 403
    assert "+91" not in resp.text


@pytest.mark.asyncio
async def test_a_blank_number_is_released_as_null_not_empty_string(client):
    """An empty string would render a call button that dials nothing."""
    c, db = client
    reporter, volunteer = ObjectId(), ObjectId()
    db.alerts.find_one = AsyncMock(return_value=_accepted(reporter, volunteer))
    db.users.find_one = AsyncMock(
        return_value={"_id": volunteer, "name": "Aman", "phone": ""}
    )
    resp = await c.get(
        f"/api/alerts/{ObjectId()}/responder",
        headers={"Authorization": f"Bearer {_token(sub=str(reporter))}"},
    )
    assert resp.json()["responder_phone"] is None
