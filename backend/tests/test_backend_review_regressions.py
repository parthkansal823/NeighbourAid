"""Route regressions exercised without a MongoDB connection or app lifespan."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.security import create_token
from app.routes import help as help_routes
from app.routes import resources, safety


class _Cursor:
    def __init__(self, documents):
        self.documents = documents

    def limit(self, count):
        return _Cursor(self.documents[:count])

    async def __aiter__(self):
        for document in self.documents:
            yield deepcopy(document)


@pytest.fixture
async def review_client(monkeypatch):
    app = FastAPI()
    db = SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Neighbour"})))
    for module, name in (
        (safety, "safety_checkins"),
        (resources, "resources"),
        (help_routes, "help_requests"),
    ):
        collection = SimpleNamespace(
            create_index=AsyncMock(),
            find=MagicMock(side_effect=lambda query: _Cursor([])),
            find_one=AsyncMock(return_value=None),
            insert_one=AsyncMock(return_value=SimpleNamespace(inserted_id=ObjectId())),
        )
        setattr(db, name, collection)
        monkeypatch.setattr(module, "get_db", lambda: db)
        monkeypatch.setattr(module, "_indexes_ready", False)
        app.include_router(module.router)

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, db


@pytest.mark.parametrize("collection", ["safety", "resources"])
@pytest.mark.parametrize(
    "field,value",
    [
        ("lat", "90.01"),
        ("lat", "-90.01"),
        ("lng", "180.01"),
        ("lng", "-180.01"),
        ("lat", "nan"),
        ("lng", "nan"),
        ("lat", "inf"),
        ("lng", "-inf"),
        ("km", "0"),
        ("km", "-1"),
        ("km", "nan"),
        ("km", "inf"),
        ("km", "-inf"),
        ("km", "200.01"),
        ("km", "1e308"),
    ],
)
async def test_near_rejects_invalid_geo_input_before_database_work(
    review_client, collection, field, value,
):
    client, db = review_client
    params = {"lat": "30.7", "lng": "76.7", "km": "5", field: value}

    response = await client.get(f"/api/{collection}/near", params=params)

    # Previously coordinates reached Mongo unchecked; safety's NaN/infinite
    # radii raised during int conversion, while resources silently clamped.
    assert response.status_code == 422
    store = getattr(db, "safety_checkins" if collection == "safety" else collection)
    store.find.assert_not_called()
    store.create_index.assert_not_awaited()


@pytest.mark.parametrize("collection,default_km", [("safety", 5), ("resources", 25)])
@pytest.mark.parametrize(
    "lat,lng,km",
    [(0, 0, None), (-90, -180, 200), (90, 180, 0.25)],
)
async def test_near_accepts_valid_bounds_and_preserves_query_behavior(
    review_client, collection, default_km, lat, lng, km,
):
    client, db = review_client
    params = {"lat": lat, "lng": lng}
    if km is not None:
        params["km"] = km

    response = await client.get(f"/api/{collection}/near", params=params)

    assert response.status_code == 200
    assert response.json() == []
    store = getattr(db, "safety_checkins" if collection == "safety" else collection)
    query = store.find.call_args.args[0]
    geo = query["location"]["$nearSphere"]
    assert geo["$geometry"] == {"type": "Point", "coordinates": [lng, lat]}
    effective_km = default_km if km is None else km
    if collection == "resources":
        effective_km = max(0.5, effective_km)
    assert geo["$maxDistance"] == int(effective_km * 1000)
    assert query["expires_at"]["$gt"].tzinfo == timezone.utc


async def test_help_near_hides_expired_rows_even_before_ttl_deletes_them(
    review_client, monkeypatch,
):
    client, db = review_client
    now = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            assert tz == timezone.utc
            return now

    monkeypatch.setattr(help_routes, "datetime", _Clock)
    worker = ObjectId()
    template = {
        "requester_id": ObjectId(),
        "kind": "plumber",
        "title": "Kitchen tap needs repair",
        "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        "contact": "private-contact",
        "offers": [{"worker_id": worker, "price": 500, "note": "private quote"}],
        "accepted_worker_id": None,
        "status": "open",
        "created_at": now - timedelta(days=14),
    }
    active_id = ObjectId()
    documents = [
        {**template, "_id": ObjectId(), "expires_at": now - timedelta(microseconds=1)},
        {**template, "_id": ObjectId(), "expires_at": now},
        {**template, "_id": active_id, "expires_at": now + timedelta(microseconds=1)},
        {**template, "_id": ObjectId(), "expires_at": now + timedelta(days=1), "status": "done"},
        {**template, "_id": ObjectId(), "expires_at": now + timedelta(days=1), "kind": "tech"},
    ]

    def find(query):
        # Retain expired documents in storage, like Mongo's asynchronous TTL
        # deletion. Only an actual query predicate excludes them from results.
        matching = []
        for document in documents:
            if document["status"] != query["status"]:
                continue
            if "kind" in query and document["kind"] != query["kind"]:
                continue
            cutoff = query.get("expires_at", {}).get("$gt")
            if cutoff is not None and document["expires_at"] <= cutoff:
                continue
            matching.append(document)
        return _Cursor(matching)

    db.help_requests.find.side_effect = find
    response = await client.get(
        "/api/help/near", params={"lat": 30.7, "lng": 76.7, "kind": "plumber"},
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(active_id)]
    row = response.json()[0]
    assert "contact" not in row
    assert "offers" not in row
    assert row["offer_count"] == 1
    assert len(documents) == 5, "expiry filtering must not depend on deletion"


def _auth(user_id):
    return {"Authorization": f"Bearer {create_token({'sub': str(user_id), 'role': 'reporter'})}"}


@pytest.fixture
def review_clock(monkeypatch):
    clock = SimpleNamespace(now=datetime(2026, 10, 6, 12, tzinfo=timezone.utc))

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            assert tz == timezone.utc
            return clock.now

    for module in (safety, help_routes, resources):
        monkeypatch.setattr(module, "datetime", _Clock)
    return clock


@pytest.mark.parametrize("status", ["safe", "need_help"])
@pytest.mark.parametrize("seconds", [-1, 0, 1, None])
async def test_safety_me_only_returns_an_unexpired_own_status(
    review_client, review_clock, status, seconds,
):
    client, db = review_client
    user_id = ObjectId()
    document = {
        "user_id": user_id, "status": status, "note": "at home",
        "location": {"type": "Point", "coordinates": [76.7, 30.7]},
        "created_at": review_clock.now - timedelta(days=1),
    }
    if seconds is not None:
        document["expires_at"] = review_clock.now + timedelta(seconds=seconds)

    async def find_one(query):
        assert query["user_id"] == user_id
        cutoff = query.get("expires_at", {}).get("$gt")
        if cutoff is not None and (
            "expires_at" not in document or document["expires_at"] <= cutoff
        ):
            return None
        return deepcopy(document)

    db.safety_checkins.find_one.side_effect = find_one
    response = await client.get("/api/safety/me", headers=_auth(user_id))

    assert response.status_code == 200
    if seconds is None or seconds <= 0:
        assert response.json() is None
    else:
        assert response.json()["status"] == status
        assert response.json()["note"] == "at home"
        assert "expires_at" in response.json()
        assert "user_id" not in response.json()


class _HelpExpiryStore:
    """A detached-read store that checks the atomic filter before any write."""

    def __init__(self, document):
        self.document = deepcopy(document)
        self.writes = 0

    def _matches(self, query):
        for field, expected in query.items():
            if field == "offers.worker_id":
                if not any(offer["worker_id"] == expected for offer in self.document["offers"]):
                    return False
                continue
            actual = self.document.get(field)
            if isinstance(expected, dict):
                for operator, value in expected.items():
                    if operator == "$gt":
                        if actual is None or actual <= value:
                            return False
                    elif operator == "$ne":
                        if actual == value:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        return deepcopy(self.document) if self._matches(query) else None

    async def find_one_and_update(self, query, update, return_document=False):
        assert return_document is True
        if not self._matches(query):
            return None
        if isinstance(update, list):
            # Preserve other quotes while applying this handler's re-quote
            # pipeline. The expiry query, not the test, decides if it runs.
            arrays = update[0]["$set"]["offers"]["$concatArrays"]
            offer = deepcopy(arrays[1]["$literal"][0])
            offers = self.document.get("offers") or []
            self.document["offers"] = [
                item for item in offers if item["worker_id"] != offer["worker_id"]
            ] + [offer]
        else:
            self.document.update(deepcopy(update["$set"]))
        self.writes += 1
        return deepcopy(self.document)


def _help_document(now, worker):
    return {
        "_id": ObjectId(), "requester_id": ObjectId(), "status": "open",
        "title": "Kitchen tap needs repair", "contact": "private-contact",
        "offers": [{"worker_id": worker, "price": 600, "note": "original quote"}],
        "accepted_worker_id": None, "expires_at": now + timedelta(days=1),
    }


@pytest.mark.parametrize("action", ["offers", "accept"])
@pytest.mark.parametrize("seconds", [-1, 0, 1, None])
async def test_help_mutations_require_unexpired_request_in_atomic_filter(
    review_client, review_clock, action, seconds,
):
    client, db = review_client
    worker = ObjectId()
    document = _help_document(review_clock.now, worker)
    if seconds is None:
        document.pop("expires_at")
    else:
        document["expires_at"] = review_clock.now + timedelta(seconds=seconds)
    store = db.help_requests = _HelpExpiryStore(document)
    url = f"/api/help/{document['_id']}/{action}"

    if action == "offers":
        response = await client.post(url, json={"price": 400}, headers=_auth(worker))
    else:
        response = await client.patch(
            url, params={"worker_id": str(worker)}, headers=_auth(document["requester_id"]),
        )

    if seconds is None or seconds <= 0:
        assert response.status_code == (409 if action == "offers" else 404)
        assert store.writes == 0
        assert store.document == document, "a refused action must preserve the row"
    else:
        assert response.status_code == (201 if action == "offers" else 200)
        assert store.writes == 1
        if action == "offers":
            assert store.document["offers"][0]["price"] == 400
            assert "contact" not in response.json()
            assert "offers" not in response.json()
        else:
            assert store.document["status"] == "accepted"
            assert store.document["accepted_worker_id"] == worker
            assert response.json()["contact"] == "private-contact"


async def test_help_offer_rechecks_expiry_after_awaited_user_lookup(
    review_client, review_clock,
):
    client, db = review_client
    worker = ObjectId()
    document = _help_document(review_clock.now, worker)
    document["expires_at"] = review_clock.now + timedelta(seconds=1)
    store = db.help_requests = _HelpExpiryStore(document)

    async def user_lookup(*args):
        review_clock.now = document["expires_at"]
        return {"name": "Worker"}

    db.users.find_one.side_effect = user_lookup
    response = await client.post(
        f"/api/help/{document['_id']}/offers", json={"price": 400}, headers=_auth(worker),
    )

    assert response.status_code == 409
    assert store.writes == 0
    assert store.document == document


@pytest.mark.parametrize("title", ["    ", "\t\n \u2003", " x  ", " abc "])
async def test_help_title_must_meet_minimum_length_after_trim(review_client, title):
    client, db = review_client
    response = await client.post(
        "/api/help/", headers=_auth(ObjectId()),
        json={"kind": "tech", "title": title, "location": {"coordinates": [76.7, 30.7]}},
    )

    assert response.status_code == 422
    db.help_requests.insert_one.assert_not_awaited()
    db.help_requests.create_index.assert_not_awaited()


async def test_help_creation_keeps_valid_trimmed_text_and_budget_semantics(review_client):
    client, db = review_client
    response = await client.post(
        "/api/help/", headers=_auth(ObjectId()),
        json={
            "kind": "tech", "title": "  Laptop needs repair  ",
            "description": "  Will not boot  ", "contact": "  Call me  ",
            "location": {"coordinates": [76.7, 30.7]}, "budget_min": 0, "budget_max": 0,
        },
    )

    assert response.status_code == 201
    written = db.help_requests.insert_one.await_args.args[0]
    assert written["title"] == "Laptop needs repair"
    assert written["description"] == "Will not boot"
    assert written["contact"] == "Call me"
    assert written["budget_min"] == written["budget_max"] == 0


@pytest.mark.parametrize("name", ["  ", "\u2003\t", " x "])
async def test_resource_name_must_meet_minimum_length_after_trim(review_client, name):
    client, db = review_client
    response = await client.post(
        "/api/resources/", headers=_auth(ObjectId()),
        json={"kind": "water", "name": name, "location": {"coordinates": [76.7, 30.7]}},
    )

    assert response.status_code == 422
    db.resources.insert_one.assert_not_awaited()
    db.resources.create_index.assert_not_awaited()


@pytest.mark.parametrize("geo_type", ["LineString", "Polygon", "point", ""])
async def test_resource_rejects_non_point_geometry_before_database_work(review_client, geo_type):
    client, db = review_client
    response = await client.post(
        "/api/resources/", headers=_auth(ObjectId()),
        json={
            "kind": "water", "name": "Water station",
            "location": {"type": geo_type, "coordinates": [76.7, 30.7]},
        },
    )

    assert response.status_code == 422
    db.resources.insert_one.assert_not_awaited()
    db.resources.create_index.assert_not_awaited()


@pytest.mark.parametrize("explicit_point", [False, True])
@pytest.mark.parametrize("contact,notes", [(None, None), ("  ", "\t")])
async def test_resource_creation_preserves_optional_fields_and_point_default(
    review_client, explicit_point, contact, notes,
):
    client, db = review_client
    location = {"coordinates": [76.7, 30.7]}
    if explicit_point:
        location["type"] = "Point"
    response = await client.post(
        "/api/resources/", headers=_auth(ObjectId()),
        json={
            "kind": "water", "name": "  Water station  ", "location": location,
            "contact": contact, "notes": notes, "capacity": 0, "valid_for_hours": 1,
        },
    )

    assert response.status_code == 201
    written = db.resources.insert_one.await_args.args[0]
    assert written["name"] == "Water station"
    assert written["location"] == {"type": "Point", "coordinates": [76.7, 30.7]}
    assert written["contact"] is written["notes"] is None
    assert written["capacity"] == 0
    assert written["expires_at"] - written["created_at"] == timedelta(hours=1)
