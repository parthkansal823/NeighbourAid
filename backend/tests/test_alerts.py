import pytest
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
from app.core.security import create_token


def _volunteer_token():
    return create_token({"sub": str(ObjectId()), "role": "volunteer"})


def _reporter_token():
    return create_token({"sub": str(ObjectId()), "role": "reporter"})


def _cursor_from_docs(docs):
    async def iterate():
        for doc in docs:
            yield doc

    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=iterate())
    cursor.sort = MagicMock(return_value=iterate())
    cursor.__aiter__ = lambda _self: iterate()
    return cursor


@pytest.mark.asyncio
async def test_get_nearby_is_public(client):
    c, db = client

    async def empty_cursor():
        if False:
            yield

    # The /nearby endpoint now applies a .limit(100) projection, and /mine
    # does .sort(...). Make the cursor mock chainable so either call path works.
    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=empty_cursor())
    cursor.sort = MagicMock(return_value=empty_cursor())
    cursor.__aiter__ = lambda _self: empty_cursor()
    db.alerts.find = MagicMock(return_value=cursor)
    db.alerts.update_many = AsyncMock()

    resp = await c.get(
        "/api/alerts/nearby",
        params={"lat": 30.7333, "lng": 76.7794},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_nearby_returns_list(client):
    c, db = client

    async def empty_cursor():
        if False:
            yield

    # The /nearby endpoint now applies a .limit(100) projection, and /mine
    # does .sort(...). Make the cursor mock chainable so either call path works.
    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=empty_cursor())
    cursor.sort = MagicMock(return_value=empty_cursor())
    cursor.__aiter__ = lambda _self: empty_cursor()
    db.alerts.find = MagicMock(return_value=cursor)
    db.alerts.update_many = AsyncMock()

    resp = await c.get(
        "/api/alerts/nearby",
        params={"lat": 30.7333, "lng": 76.7794},
        headers={"Authorization": f"Bearer {_volunteer_token()}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_nearby_includes_skill_match_for_volunteer(client):
    c, db = client
    volunteer_id = ObjectId()
    db.users.find_one = AsyncMock(
        return_value={"_id": volunteer_id, "skills": ["medical"], "has_vehicle": True}
    )
    db.alerts.update_many = AsyncMock()
    db.alerts.find = MagicMock(
        return_value=_cursor_from_docs(
            [
                {
                    "_id": ObjectId(),
                    "reporter_id": ObjectId(),
                    "category": "medical",
                    "description": "Elderly person collapsed near the market",
                    "urgency": "HIGH",
                    "urgency_reason": "",
                    "location": {
                        "type": "Point",
                        "coordinates": [76.8844, 30.7333],  # ~10 km east
                    },
                    "status": "open",
                    "accepted_by": None,
                    "created_at": "2026-04-24T00:00:00+00:00",
                    "resolved_at": None,
                    "flags": 0,
                }
            ]
        )
    )

    token = create_token({"sub": str(volunteer_id), "role": "volunteer"})
    resp = await c.get(
        "/api/alerts/nearby",
        params={"lat": 30.7333, "lng": 76.7794, "km": 5},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["is_skill_match"] is True
    assert body[0]["your_has_vehicle"] is True
    assert body[0]["your_distance_km"] > 5


@pytest.mark.asyncio
async def test_get_nearby_excludes_non_matching_volunteer_outside_radius(client):
    c, db = client
    volunteer_id = ObjectId()
    db.users.find_one = AsyncMock(
        return_value={"_id": volunteer_id, "skills": ["swim"], "has_vehicle": False}
    )
    db.alerts.update_many = AsyncMock()
    db.alerts.find = MagicMock(
        return_value=_cursor_from_docs(
            [
                {
                    "_id": ObjectId(),
                    "reporter_id": ObjectId(),
                    "category": "medical",
                    "description": "Need CPR support urgently",
                    "urgency": "HIGH",
                    "urgency_reason": "",
                    "location": {
                        "type": "Point",
                        "coordinates": [76.8844, 30.7333],  # ~10 km east
                    },
                    "status": "open",
                    "accepted_by": None,
                    "created_at": "2026-04-24T00:00:00+00:00",
                    "resolved_at": None,
                    "flags": 0,
                }
            ]
        )
    )

    token = create_token({"sub": str(volunteer_id), "role": "volunteer"})
    resp = await c.get(
        "/api/alerts/nearby",
        params={"lat": 30.7333, "lng": 76.7794, "km": 5},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_my_alerts_requires_reporter(client):
    c, _ = client
    resp = await c.get(
        "/api/alerts/mine",
        headers={"Authorization": f"Bearer {_volunteer_token()}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_my_alerts_returns_list(client):
    c, db = client

    async def empty_cursor():
        if False:
            yield

    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=empty_cursor())
    db.alerts.find = MagicMock(return_value=cursor)

    resp = await c.get(
        "/api/alerts/mine",
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_cancel_alert_not_found(client):
    c, db = client
    db.alerts.delete_one = AsyncMock(return_value=MagicMock(deleted_count=0))
    resp = await c.delete(
        f"/api/alerts/{ObjectId()}",
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_alert_success(client):
    c, db = client
    db.alerts.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
    resp = await c.delete(
        f"/api/alerts/{ObjectId()}",
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_create_alert_requires_reporter(client):
    c, _ = client
    payload = {
        "category": "medical",
        "description": "Person collapsed on the street",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post(
        "/api/alerts/",
        json=payload,
        headers={"Authorization": f"Bearer {_volunteer_token()}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_cancel_alert_invalid_id(client):
    """Malformed IDs must 400, never 500."""
    c, _ = client
    resp = await c.delete(
        "/api/alerts/not-a-real-id",
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_flag_alert_invalid_id(client):
    c, _ = client
    resp = await c.post(
        "/api/alerts/not-a-real-id/flag",
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_alert_is_public_share_link(client):
    """The public /alert/{id} path is intentionally unauthenticated so share
    links work even for people without an account."""
    c, db = client
    alert_id = ObjectId()
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": alert_id,
            "reporter_id": ObjectId(),
            "category": "medical",
            "description": "test",
            "urgency": "HIGH",
            "urgency_reason": "",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "status": "open",
            "accepted_by": None,
            "created_at": "2026-04-24T00:00:00+00:00",
            "resolved_at": None,
            "flags": 0,
            "photos": ["data:image/jpeg;base64,xxx"],
        }
    )
    resp = await c.get(f"/api/alerts/{alert_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(alert_id)


@pytest.mark.asyncio
async def test_get_alert_hides_flagged(client):
    c, db = client
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(),
            "category": "medical",
            "description": "test",
            "urgency": "HIGH",
            "urgency_reason": "",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "status": "open",
            "accepted_by": None,
            "created_at": "2026-04-24T00:00:00+00:00",
            "resolved_at": None,
            "flags": 5,  # heavily flagged
        }
    )
    resp = await c.get(f"/api/alerts/{ObjectId()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_heatmap_endpoint(client):
    c, db = client

    async def empty_cursor():
        if False:
            yield

    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=empty_cursor())
    db.alerts.find = MagicMock(return_value=cursor)

    resp = await c.get(
        "/api/alerts/heatmap",
        params={"lat": 30.7333, "lng": 76.7794, "km": 25, "hours": 72},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "points" in body
    assert body["window_hours"] == 72


@pytest.mark.asyncio
async def test_eta_requires_volunteer(client):
    c, _ = client
    resp = await c.patch(
        f"/api/alerts/{ObjectId()}/eta",
        json={"eta_minutes": 10},
        headers={"Authorization": f"Bearer {_reporter_token()}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_eta_validates_range(client):
    """241 minutes should be rejected — max is 240."""
    c, _ = client
    resp = await c.patch(
        f"/api/alerts/{ObjectId()}/eta",
        json={"eta_minutes": 241},
        headers={"Authorization": f"Bearer {_volunteer_token()}"},
    )
    assert resp.status_code == 422
