import pytest
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
from app.core.security import create_token


class _cursor:
    """Stand-in for AsyncCommandCursor: async-iterable, nothing else.

    Deliberately not a MagicMock. The bug this guards against was a mock that
    was *too* accommodating — it iterated happily whether or not the caller
    awaited, so the route's missing `await` never showed up.
    """

    def __init__(self, rows):
        self._rows = list(rows)

    def __aiter__(self):
        self._it = iter(self._rows)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _token(role="reporter"):
    return create_token({"sub": str(ObjectId()), "role": role})


@pytest.mark.asyncio
async def test_stats_public_no_auth_needed(client):
    c, db = client
    db.alerts.count_documents = AsyncMock(return_value=0)

    # PyMongo's async driver: `await coll.aggregate(...)` resolves to an
    # async-iterable cursor. The old mock returned the iterable directly,
    # which matched Motor and silently reproduced a bug in the route.
    db.alerts.aggregate = AsyncMock(return_value=_cursor([]))

    resp = await c.get("/api/stats/")
    assert resp.status_code == 200
    body = resp.json()
    assert "active_alerts" in body
    assert "critical_open" in body
    assert "last_24h" in body


@pytest.mark.asyncio
async def test_user_me_requires_auth(client):
    c, _ = client
    resp = await c.get("/api/users/me")
    # FastAPI's HTTPBearer returns 403 when the header is missing
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_update_location_requires_valid_coords(client):
    c, db = client
    db.users.find_one_and_update = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "name": "x",
            "email": "x@x.com",
            "role": "reporter",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "created_at": "2024-01-01T00:00:00",
        }
    )
    resp = await c.patch(
        "/api/users/me/location",
        json={"location": {"type": "Point", "coordinates": [999, 999]}},
        headers={"Authorization": f"Bearer {_token()}"},
    )
    # 422 — our validator rejects out-of-range coords
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_news_endpoint_structure(client, monkeypatch):
    c, _ = client
    # Patch the symbol where it's actually used (imported into the route module).
    from app.routes import news as news_route

    async def fake_fetch():
        return [
            {
                "source": "Test",
                "title": "Fire in city centre",
                "link": "https://example.com/a",
                "summary": "...",
                "published": "",
            }
        ]

    monkeypatch.setattr(news_route, "fetch_news", fake_fetch)

    resp = await c.get("/api/news/recent")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["items"][0]["title"] == "Fire in city centre"


@pytest.mark.asyncio
async def test_my_stats_reporter_shape(client):
    c, db = client
    db.alerts.count_documents = AsyncMock(return_value=3)
    resp = await c.get(
        "/api/users/me/stats",
        headers={"Authorization": f"Bearer {_token('reporter')}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "reporter"
    assert body["posted"] == 3


@pytest.mark.asyncio
async def test_top_category_is_actually_computed(client):
    """Regression: the aggregate coroutine was never awaited.

    `async for` over an un-awaited coroutine yields nothing, so top_category
    silently stayed None on every request while the route returned 200. The
    broad `except Exception` in the handler meant nothing surfaced — the only
    evidence was a RuntimeWarning buried in the container log. A test that
    only asserts status 200, or only that the key exists, cannot see this.
    """
    c, db = client
    db.alerts.count_documents = AsyncMock(return_value=3)
    db.alerts.aggregate = AsyncMock(
        return_value=_cursor([{"_id": "medical", "n": 7}])
    )

    resp = await c.get("/api/stats/")
    assert resp.status_code == 200
    assert resp.json()["top_category"] == {"category": "medical", "count": 7}


@pytest.mark.asyncio
async def test_leaderboard_is_actually_computed(client):
    """Same missing await, same silent empty result."""
    c, db = client
    vol_id = ObjectId()
    db.alerts.aggregate = AsyncMock(
        return_value=_cursor([{"_id": vol_id, "accepted": 5, "resolved": 4}])
    )
    db.users.find = MagicMock(
        return_value=_cursor([{"_id": vol_id, "name": "Asha"}])
    )

    resp = await c.get("/api/stats/leaderboard")
    assert resp.status_code == 200
    assert resp.json()["top"], "leaderboard came back empty despite matching rows"
