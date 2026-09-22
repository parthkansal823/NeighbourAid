"""Safety check-ins — /api/safety.

This module had no tests at all: 43% coverage was import-time only, so every
branch of create/near/me was unverified. It is the feature people use during
an area-wide disaster to say "I am safe" or "I need help", which makes it a
bad one to leave unexercised.

The check-in document itself is never asserted field-by-field against a
literal dict; what is asserted is the behaviour that would actually hurt if
it broke — the privacy boundary on /near, the one-per-user upsert, the TTL
filter, and the indexes the queries depend on.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
from app.core.security import create_token


def _token(role="volunteer"):
    return create_token({"sub": str(ObjectId()), "role": role})


def _cursor_from_docs(docs):
    async def iterate():
        for doc in docs:
            yield doc

    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=iterate())
    cursor.__aiter__ = lambda _self: iterate()
    return cursor


def _checkin_doc(**over):
    doc = {
        "_id": ObjectId(),
        "user_id": ObjectId(),
        "user_name": "Asha",
        "status": "safe",
        "note": "at home",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        "created_at": "2026-09-21T00:00:00+00:00",
        "expires_at": "2026-09-22T00:00:00+00:00",
    }
    doc.update(over)
    return doc


@pytest.fixture(autouse=True)
def _reset_index_guard():
    """`_ensure_indexes` latches a module-level flag after its first run, so
    without this the first test to touch the route hides the index calls from
    every test after it — and whichever test asserted on them would pass or
    fail depending on suite order."""
    from app.routes import safety

    safety._indexes_ready = False
    yield
    safety._indexes_ready = False


# --------------------------------------------------------------------------
# POST /api/safety/
# --------------------------------------------------------------------------

async def test_create_checkin_requires_auth(client):
    c, _ = client
    resp = await c.post(
        "/api/safety/",
        json={
            "status": "safe",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        },
    )
    assert resp.status_code == 401


async def test_create_checkin_upserts_one_per_user(client):
    """The collection holds at most one live check-in per person, so posting
    again must replace rather than append — the /me lookup and the unique
    index on user_id both assume it."""
    c, db = client
    db.users.find_one = AsyncMock(return_value={"_id": ObjectId(), "name": "Asha"})
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.replace_one = AsyncMock()

    resp = await c.post(
        "/api/safety/",
        json={
            "status": "safe",
            "note": "at home",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        },
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "safe"

    db.safety_checkins.replace_one.assert_awaited_once()
    _filter, _doc = db.safety_checkins.replace_one.await_args.args[:2]
    assert set(_filter) == {"user_id"}, "must match on user_id alone"
    assert db.safety_checkins.replace_one.await_args.kwargs["upsert"] is True


async def test_create_checkin_404s_for_a_deleted_user(client):
    """A token outlives the account it names. Without the lookup this wrote a
    check-in attributed to a user that no longer exists."""
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.replace_one = AsyncMock()

    resp = await c.post(
        "/api/safety/",
        json={
            "status": "safe",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        },
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404
    db.safety_checkins.replace_one.assert_not_awaited()


async def test_create_checkin_rejects_an_unknown_status(client):
    """status is a Literal["safe", "need_help"]; anything else is a client bug
    and must not reach the database as a value the map cannot render."""
    c, db = client
    db.users.find_one = AsyncMock(return_value={"_id": ObjectId(), "name": "Asha"})
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.replace_one = AsyncMock()

    resp = await c.post(
        "/api/safety/",
        json={
            "status": "maybe",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        },
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 422
    db.safety_checkins.replace_one.assert_not_awaited()


async def test_create_checkin_builds_the_indexes_its_queries_need(client):
    """The write path creates the indexes too, deliberately: the TTL index is
    what expires stale check-ins, and it has to exist even if nobody ever
    reads /near. user_id must be UNIQUE or two concurrent upserts can both
    miss the filter and both insert, breaking one-per-user."""
    c, db = client
    db.users.find_one = AsyncMock(return_value={"_id": ObjectId(), "name": "Asha"})
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.replace_one = AsyncMock()

    await c.post(
        "/api/safety/",
        json={
            "status": "safe",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        },
        headers={"Authorization": f"Bearer {_token()}"},
    )

    calls = db.safety_checkins.create_index.await_args_list
    specs = [call.args[0] for call in calls]
    assert [("location", "2dsphere")] in specs
    assert "expires_at" in specs

    user_id_call = next(c for c in calls if c.args[0] == "user_id")
    assert user_id_call.kwargs.get("unique") is True

    ttl_call = next(c for c in calls if c.args[0] == "expires_at")
    assert ttl_call.kwargs.get("expireAfterSeconds") == 0


# --------------------------------------------------------------------------
# GET /api/safety/near
# --------------------------------------------------------------------------

async def test_near_is_public(client):
    """Deliberately unauthenticated: during a disaster someone without an
    account still needs to see whether their area is reporting safe."""
    c, db = client
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.find = MagicMock(return_value=_cursor_from_docs([]))

    resp = await c.get("/api/safety/near", params={"lat": 30.7333, "lng": 76.7794})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_near_never_leaks_user_id_or_expiry(client):
    """/near is public, so the response is a deliberately narrow projection.
    Leaking user_id would let anyone map a person's account to their live
    location."""
    c, db = client
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.find = MagicMock(
        return_value=_cursor_from_docs([_checkin_doc(), _checkin_doc(status="need_help")])
    )

    resp = await c.get("/api/safety/near", params={"lat": 30.7333, "lng": 76.7794})
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    for row in rows:
        assert set(row) == {"user_name", "status", "note", "location", "created_at"}
        assert "user_id" not in row
        assert "_id" not in row
        assert "expires_at" not in row


async def test_near_filters_out_expired_checkins(client):
    """The TTL index deletes eventually, not instantly, so the query also has
    to exclude anything already past expires_at — otherwise a stale "safe"
    keeps showing after the person's status should have lapsed."""
    c, db = client
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.find = MagicMock(return_value=_cursor_from_docs([]))

    await c.get("/api/safety/near", params={"lat": 30.7333, "lng": 76.7794})

    query = db.safety_checkins.find.call_args.args[0]
    assert "$gt" in query["expires_at"]
    assert "$nearSphere" in query["location"]


async def test_near_passes_lng_lat_in_that_order(client):
    """GeoJSON is [longitude, latitude]. Swapping them is silent -- the query
    succeeds and simply returns check-ins from the wrong place, which during
    a disaster is worse than an error."""
    c, db = client
    db.safety_checkins.create_index = AsyncMock()
    db.safety_checkins.find = MagicMock(return_value=_cursor_from_docs([]))

    await c.get("/api/safety/near", params={"lat": 30.7333, "lng": 76.7794})

    query = db.safety_checkins.find.call_args.args[0]
    coords = query["location"]["$nearSphere"]["$geometry"]["coordinates"]
    assert coords == [76.7794, 30.7333]


# --------------------------------------------------------------------------
# GET /api/safety/me
# --------------------------------------------------------------------------

async def test_my_checkin_requires_auth(client):
    c, _ = client
    resp = await c.get("/api/safety/me")
    assert resp.status_code == 401


async def test_my_checkin_returns_null_when_none_posted(client):
    """Null rather than 404: the profile page treats "no check-in yet" as a
    normal state, not an error to surface."""
    c, db = client
    db.safety_checkins.find_one = AsyncMock(return_value=None)

    resp = await c.get(
        "/api/safety/me", headers={"Authorization": f"Bearer {_token()}"}
    )
    assert resp.status_code == 200
    assert resp.json() is None


async def test_my_checkin_returns_own_checkin_with_expiry(client):
    """Unlike /near, /me may include expires_at — it is the viewer's own
    record, and the UI needs it to show when the status lapses."""
    c, db = client
    db.safety_checkins.find_one = AsyncMock(return_value=_checkin_doc(note="ok"))

    resp = await c.get(
        "/api/safety/me", headers={"Authorization": f"Bearer {_token()}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "safe"
    assert body["note"] == "ok"
    assert "expires_at" in body
    assert "user_id" not in body


async def test_my_checkin_looks_up_by_the_callers_own_id(client):
    """The filter must come from the token, never from a query parameter, or
    one user could read another's check-in."""
    c, db = client
    db.safety_checkins.find_one = AsyncMock(return_value=None)
    uid = str(ObjectId())
    token = create_token({"sub": uid, "role": "volunteer"})

    await c.get("/api/safety/me", headers={"Authorization": f"Bearer {token}"})

    query = db.safety_checkins.find_one.await_args.args[0]
    assert query == {"user_id": ObjectId(uid)}
