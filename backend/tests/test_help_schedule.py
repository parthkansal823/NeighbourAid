"""Preferred visit windows and participant-only, factual job milestones."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.core.security import create_token
from app.routes import help as routes

NOW = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)


def auth(uid):
    return {"Authorization": f"Bearer {create_token({'sub': str(uid), 'role': 'reporter'})}"}


@pytest.fixture
def clock(monkeypatch):
    class Clock(datetime):
        value = NOW

        @classmethod
        def now(cls, tz=None):
            assert tz == timezone.utc
            return cls.value

    monkeypatch.setattr(routes, "datetime", Clock)
    return Clock


class Store:
    """Apply conditional writes to detached documents, not permissive mocks."""

    def __init__(self, doc):
        self.doc = deepcopy(doc)
        self.writes = 0
        self.before_update = None
        self.create_index = AsyncMock()

    def matches(self, query):
        for key, expected in query.items():
            actual = self.doc.get(key)
            if key == "offers.worker_id":
                actual = [offer["worker_id"] for offer in self.doc.get("offers", [])]
            if isinstance(expected, dict):
                for op, value in expected.items():
                    if op == "$gt":
                        if actual is None or actual <= value:
                            return False
                    elif op == "$in":
                        if actual not in value:
                            return False
                    elif op == "$ne":
                        if actual == value:
                            return False
                    else:
                        raise AssertionError(f"Unsupported query operator: {op}")
            elif isinstance(actual, list):
                if expected not in actual:
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        return deepcopy(self.doc) if self.matches(query) else None

    async def find_one_and_update(self, query, update, return_document=False):
        assert return_document is True
        if self.before_update:
            self.before_update(self.doc)
            self.before_update = None
        if not self.matches(query):
            return None
        self.doc.update(deepcopy(update["$set"]))
        self.writes += 1
        return deepcopy(self.doc)


@pytest.fixture
def job(client, clock, monkeypatch):
    c, db = client
    owner, worker = ObjectId(), ObjectId()
    row = {
        "_id": ObjectId(), "requester_id": owner,
        "accepted_worker_id": worker, "status": "accepted",
        "offers": [{"worker_id": worker, "price": 500}],
        "contact": "private-contact", "created_at": NOW - timedelta(hours=1),
        "accepted_at": NOW - timedelta(minutes=20),
        "expires_at": NOW + timedelta(days=1),
    }
    store = db.help_requests = Store(row)
    monkeypatch.setattr(routes, "_indexes_ready", False)
    return c, store, owner, worker


def body(**extra):
    return {
        "kind": "plumber", "title": "Kitchen tap needs repair",
        "location": {"coordinates": [76.7, 30.7]}, **extra,
    }


@pytest.mark.parametrize("window", [{}, {"schedule_start": None, "schedule_end": None}])
async def test_flexible_default_keeps_existing_creation_working(client, clock, window):
    c, db = client
    db.help_requests.create_index = AsyncMock()
    db.help_requests.insert_one = AsyncMock(return_value=type("Result", (), {"inserted_id": ObjectId()})())
    routes._indexes_ready = False
    response = await c.post("/api/help/", json=body(**window), headers=auth(ObjectId()))
    assert response.status_code == 201
    assert response.json().get("schedule_start") is None
    assert response.json().get("schedule_end") is None
    assert response.json()["timeline"] == [{"event": "posted", "at": NOW.isoformat()}]


@pytest.mark.parametrize("start,end", [
    (None, (NOW + timedelta(hours=2)).isoformat()),
    ((NOW + timedelta(hours=1)).isoformat(), None),
    ("2026-10-06T13:00:00", "2026-10-06T14:00:00"),
    (NOW.isoformat(), (NOW + timedelta(hours=1)).isoformat()),
    ((NOW - timedelta(hours=1)).isoformat(), (NOW + timedelta(hours=1)).isoformat()),
    ((NOW + timedelta(hours=1)).isoformat(), (NOW + timedelta(hours=1)).isoformat()),
    ((NOW + timedelta(hours=2)).isoformat(), (NOW + timedelta(hours=1)).isoformat()),
    ((NOW + timedelta(hours=1)).isoformat(), (NOW + timedelta(hours=26)).isoformat()),
    ((NOW + timedelta(days=14)).isoformat(), (NOW + timedelta(days=14, hours=1)).isoformat()),
    ("not a date", "not a date"),
])
async def test_invalid_windows_fail_before_database_work(client, clock, start, end):
    c, db = client
    db.help_requests.create_index = AsyncMock()
    db.help_requests.insert_one = AsyncMock()
    routes._indexes_ready = False
    response = await c.post(
        "/api/help/", json=body(schedule_start=start, schedule_end=end), headers=auth(ObjectId()),
    )
    assert response.status_code == 422
    db.help_requests.insert_one.assert_not_awaited()
    db.help_requests.create_index.assert_not_awaited()


async def test_window_normalizes_timezone_and_does_not_outlive_browse_deadline(client, clock):
    c, db = client
    db.help_requests.create_index = AsyncMock()
    db.help_requests.insert_one = AsyncMock(return_value=type("Result", (), {"inserted_id": ObjectId()})())
    routes._indexes_ready = False
    response = await c.post(
        "/api/help/", json=body(
            schedule_start="2026-10-06T18:30:00+05:30",
            schedule_end="2026-10-06T19:30:00+05:30",
        ), headers=auth(ObjectId()),
    )
    assert response.status_code == 201
    assert response.json()["schedule_start"] == "2026-10-06T13:00:00+00:00"
    assert response.json()["schedule_end"] == "2026-10-06T14:00:00+00:00"
    written = db.help_requests.insert_one.await_args.args[0]
    assert written["expires_at"] == NOW + timedelta(hours=2)


async def test_accepted_worker_can_start_and_repeat_without_rewriting_time(job, clock):
    c, store, _, worker = job
    url = f"/api/help/{store.doc['_id']}/start"
    first = await c.patch(url, headers=auth(worker))
    assert first.status_code == 200
    assert store.doc["status"] == "accepted"
    assert store.doc["work_started_at"] == NOW
    assert first.json()["timeline"][-1] == {"event": "started", "at": NOW.isoformat()}
    clock.value += timedelta(minutes=10)
    second = await c.patch(url, headers=auth(worker))
    assert second.status_code == 200
    assert second.json()["timeline"] == first.json()["timeline"]
    assert store.writes == 1


@pytest.mark.parametrize("viewer", ["owner", "stranger", "anonymous"])
async def test_only_accepted_worker_can_record_work_start(job, viewer):
    c, store, owner, _ = job
    who = owner if viewer == "owner" else ObjectId()
    headers = {} if viewer == "anonymous" else auth(who)
    response = await c.patch(f"/api/help/{store.doc['_id']}/start", headers=headers)
    assert response.status_code == (401 if viewer == "anonymous" else 404)
    assert store.writes == 0


@pytest.mark.parametrize("state", ["open", "done", "cancelled", "expired"])
async def test_start_never_reopens_a_closed_unaccepted_or_expired_job(job, state):
    c, store, _, worker = job
    if state == "expired":
        store.doc["expires_at"] = NOW
    else:
        store.doc["status"] = state
    response = await c.patch(f"/api/help/{store.doc['_id']}/start", headers=auth(worker))
    assert response.status_code == 404
    assert store.writes == 0


async def test_start_rechecks_status_in_atomic_update(job):
    c, store, _, worker = job
    store.before_update = lambda row: row.update(status="cancelled", cancelled_at=NOW)
    response = await c.patch(f"/api/help/{store.doc['_id']}/start", headers=auth(worker))
    assert response.status_code == 404
    assert store.doc["status"] == "cancelled"
    assert "work_started_at" not in store.doc


async def test_owner_completion_is_idempotent_and_retains_timeline(job, clock):
    c, store, owner, _ = job
    url = f"/api/help/{store.doc['_id']}/done"
    first = await c.patch(url, headers=auth(owner))
    assert first.status_code == 200
    assert first.json()["timeline"][-1] == {"event": "done", "at": NOW.isoformat()}
    assert store.doc["expires_at"] == NOW + timedelta(days=routes.REQUEST_TTL_DAYS)
    clock.value += timedelta(hours=1)
    second = await c.patch(url, headers=auth(owner))
    assert second.status_code == 200
    assert second.json()["timeline"] == first.json()["timeline"]
    assert store.writes == 1


async def test_done_cannot_overwrite_a_cancellation(job):
    c, store, owner, _ = job
    store.doc.update(status="cancelled", cancelled_at=NOW)
    response = await c.patch(f"/api/help/{store.doc['_id']}/done", headers=auth(owner))
    assert response.status_code == 404
    assert store.doc["status"] == "cancelled"
    assert "done_at" not in store.doc


async def test_worker_cannot_mark_requester_job_completed(job):
    c, store, _, worker = job
    response = await c.patch(f"/api/help/{store.doc['_id']}/done", headers=auth(worker))
    assert response.status_code == 404
    assert store.writes == 0


async def test_acceptance_records_real_time_and_keeps_scheduled_job_for_participants(job):
    c, store, owner, worker = job
    store.doc["status"] = "open"
    store.doc.pop("accepted_at")
    store.doc["expires_at"] = NOW + timedelta(hours=1)
    response = await c.patch(
        f"/api/help/{store.doc['_id']}/accept", params={"worker_id": str(worker)}, headers=auth(owner),
    )
    assert response.status_code == 200
    assert store.doc["accepted_at"] == NOW
    assert store.doc["expires_at"] == NOW + timedelta(days=routes.REQUEST_TTL_DAYS)
    assert response.json()["timeline"][-1] == {"event": "accepted", "at": NOW.isoformat()}


@pytest.mark.parametrize("viewer", ["owner", "worker", "stranger", "anonymous"])
def test_timeline_is_participant_only_and_normalizes_naive_mongo_dates(viewer):
    owner, worker = ObjectId(), ObjectId()
    doc = {
        "_id": ObjectId(), "requester_id": owner, "accepted_worker_id": worker,
        "status": "accepted", "offers": [], "contact": "private",
        "created_at": NOW.replace(tzinfo=None), "work_started_at": NOW.replace(tzinfo=None),
    }
    before = deepcopy(doc)
    who = {"owner": str(owner), "worker": str(worker), "stranger": str(ObjectId()), "anonymous": None}[viewer]
    serialized = routes._serialize(doc, viewer_id=who)
    assert doc == before, "serializing a response must not mutate stored milestones"
    if viewer in ("owner", "worker"):
        assert serialized["timeline"] == [
            {"event": "posted", "at": NOW.isoformat()},
            {"event": "started", "at": NOW.isoformat()},
        ]
        assert not any(event["event"] == "accepted" for event in serialized["timeline"])
    else:
        assert "timeline" not in serialized
        assert "work_started_at" not in serialized
        assert "contact" not in serialized
