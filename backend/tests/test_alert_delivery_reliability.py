"""Delivery prerequisites and races that mocks of individual writes miss."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId
import pytest


@pytest.mark.asyncio
async def test_startup_indexes_volunteer_location_for_offline_push(monkeypatch):
    from app.db import client as db_client

    db = MagicMock()
    for collection in (db.alerts, db.users, db.medical_reviews, db.clinicians):
        collection.create_index = AsyncMock()
    mongo = MagicMock()
    mongo.get_default_database.return_value = db
    monkeypatch.setattr(db_client, "AsyncMongoClient", lambda *_args: mongo)
    monkeypatch.setattr(db_client, "_client", None)
    monkeypatch.setattr(db_client, "_db", None)

    await db_client.connect()

    # push_nearby uses $nearSphere on users.location, which MongoDB rejects
    # without a geospatial index even when all alert indexes exist.
    db.users.create_index.assert_any_await([("location", "2dsphere")])


class EscalationStore:
    """A document can change after the sweep read and before its atomic write."""

    def __init__(self, document, concurrent_change=None):
        self.document = deepcopy(document)
        self.concurrent_change = concurrent_change or {}
        self.selected = False
        self.writes = 0

    @staticmethod
    def matches(document, query):
        for key, value in query.items():
            if key == "$expr":
                clock, cutoff = value["$lt"]
                primary, fallback = clock["$ifNull"]
                since = document.get(primary[1:]) or document.get(fallback[1:])
                if since >= cutoff:
                    return False
            elif document.get(key) != value:
                return False
        return True

    def find(self, query):
        async def cursor():
            if not self.selected and self.matches(self.document, query):
                self.selected = True
                snapshot = deepcopy(self.document)
                self.document.update(self.concurrent_change)
                yield snapshot

        return cursor()

    async def find_one_and_update(self, query, update, **_kwargs):
        if not self.matches(self.document, query):
            return None
        self.document.update(update["$set"])
        self.writes += 1
        return deepcopy(self.document)


def stale_alert(urgency="HIGH"):
    return {
        "_id": ObjectId(),
        "status": "open",
        "accepted_by": None,
        "urgency": urgency,
        "urgency_since": datetime.now(timezone.utc) - timedelta(minutes=20),
        "created_at": datetime.now(timezone.utc) - timedelta(minutes=30),
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", ["accepted", "resolved", "clock_reset"])
async def test_escalation_does_not_overwrite_changed_eligibility(scenario):
    from app.routes.alerts import _auto_escalate_unaccepted

    change = {
        "accepted": {"status": "accepted", "accepted_by": ObjectId()},
        "resolved": {"status": "resolved"},
        "clock_reset": {"urgency_since": datetime.now(timezone.utc)},
    }[scenario]
    store = EscalationStore(stale_alert(), change)
    db = MagicMock(alerts=store)

    bumped = await _auto_escalate_unaccepted(db)

    assert store.selected, "the concurrent edit must happen after a stale read"
    assert store.writes == 0
    assert store.document["urgency"] == "HIGH"
    assert bumped == [], "a handled alert must not be re-paged as an escalation"


@pytest.mark.asyncio
@pytest.mark.parametrize("from_urgency,to_urgency", [
    ("MEDIUM", "HIGH"), ("HIGH", "CRITICAL"),
])
async def test_still_unaccepted_alert_escalates_exactly_one_rung(from_urgency, to_urgency):
    from app.routes.alerts import _auto_escalate_unaccepted

    store = EscalationStore(stale_alert(from_urgency))
    db = MagicMock(alerts=store)

    bumped = await _auto_escalate_unaccepted(db)

    assert store.writes == 1
    assert store.document["urgency"] == to_urgency
    assert len(bumped) == 1
    assert bumped[0]["urgency"] == to_urgency
