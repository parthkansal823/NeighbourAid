"""Deterministic interleavings using a small, atomic document-store double.

Only the MongoDB query/update operators these handlers use are supported.
Reads return detached snapshots; writes recheck filters against current state.
This exercises the race outcomes without connecting to any MongoDB instance.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.routes import help as help_routes

_MISSING = object()


def _field(doc, path):
    for part in path.split("."):
        if isinstance(doc, list) and part.isdigit():
            doc = doc[int(part)] if int(part) < len(doc) else _MISSING
        elif isinstance(doc, dict):
            doc = doc.get(part, _MISSING)
        else:
            return _MISSING
    return doc


def _matches(doc, query):
    if doc is None:
        return False
    for key, expected in query.items():
        actual = _field(doc, key)
        if isinstance(expected, dict):
            for operator, value in expected.items():
                if operator == "$exists":
                    matches = (actual is not _MISSING) == value
                elif operator == "$in":
                    matches = actual in value
                elif operator == "$ne":
                    matches = actual != value
                elif operator == "$gt":
                    matches = actual is not _MISSING and actual is not None and actual > value
                else:
                    raise AssertionError(f"Unsupported query operator: {operator}")
                if not matches:
                    return False
        elif actual != expected and not (expected is None and actual is _MISSING):
            return False
    return True


def _expression(value, doc, variables=None):
    variables = variables or {}
    if isinstance(value, str) and value.startswith("$$"):
        return _field(variables, value[2:])
    if isinstance(value, str) and value.startswith("$"):
        return _field(doc, value[1:])
    if isinstance(value, list):
        return [_expression(item, doc, variables) for item in value]
    if not isinstance(value, dict):
        return value
    if "$literal" in value:
        return deepcopy(value["$literal"])
    if "$filter" in value:
        spec = value["$filter"]
        items = _expression(spec["input"], doc, variables)
        return [item for item in items if _expression(
            spec["cond"], doc, {**variables, spec["as"]: item},
        )]
    if "$ifNull" in value:
        first, fallback = value["$ifNull"]
        result = _expression(first, doc, variables)
        return _expression(fallback, doc, variables) if result is None or result is _MISSING else result
    if "$concatArrays" in value:
        return [item for arr in value["$concatArrays"]
                for item in _expression(arr, doc, variables)]
    if "$ne" in value:
        left, right = _expression(value["$ne"], doc, variables)
        return left != right
    return {key: _expression(item, doc, variables) for key, item in value.items()}


class HelpStore:
    def __init__(self, row):
        self.row = deepcopy(row)
        self.before_delete = None
        self.before_update = None
        self.writes = 0

    async def find_one(self, query, projection=None):
        snapshot = deepcopy(self.row) if _matches(self.row, query) else None
        # Concurrent handlers can both validate the same initial snapshot.
        await asyncio.sleep(0)
        return snapshot

    async def update_one(self, query, update):
        # Supports the original two-write implementation as a regression
        # check: two concurrent pulls may run before either push.
        if _matches(self.row, query):
            match = update["$pull"]["offers"]
            self.row["offers"] = [off for off in self.row["offers"] if not _matches(off, match)]
            self.writes += 1
        await asyncio.sleep(0)

    async def find_one_and_update(self, query, update, return_document=False):
        assert return_document is True
        if self.before_update:
            self.before_update(self)
            self.before_update = None
        if not _matches(self.row, query):
            return None
        if isinstance(update, list):
            for stage in update:
                values = {key: _expression(value, self.row)
                          for key, value in stage["$set"].items()}
                self.row.update(deepcopy(values))
        elif "$push" in update:
            self.row["offers"].append(deepcopy(update["$push"]["offers"]))
        else:
            self.row.update(deepcopy(update["$set"]))
        self.writes += 1
        # Detached returned document, as with a real MongoDB response.
        snapshot = deepcopy(self.row)
        await asyncio.sleep(0)
        return snapshot

    async def delete_one(self, query):
        if self.before_delete:
            self.before_delete(self)
        deleted = _matches(self.row, query)
        if deleted:
            self.row = None
            self.writes += 1
        return SimpleNamespace(deleted_count=int(deleted))


@pytest.fixture
def store(monkeypatch):
    row = {
        "_id": ObjectId(), "requester_id": ObjectId(), "status": "open",
        "offers": [], "accepted_worker_id": None, "contact": "private-contact",
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    }
    collection = HelpStore(row)
    db = SimpleNamespace(
        help_requests=collection,
        users=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Worker"})),
    )
    monkeypatch.setattr(help_routes, "get_db", lambda: db)
    return collection, db


async def _quote(collection, worker, price=400, note=""):
    return await help_routes.make_offer(
        str(collection.row["_id"]),
        help_routes.OfferCreate(price=price, note=note),
        {"sub": str(worker)},
    )


async def _withdraw(collection):
    return await help_routes.withdraw_request(
        str(collection.row["_id"]), {"sub": str(collection.row["requester_id"])},
    )


async def test_concurrent_requotes_leave_one_offer_and_preserve_other_workers(store):
    collection, _ = store
    worker, other = ObjectId(), ObjectId()
    other_offer = {"worker_id": other, "price": 300, "note": "original"}
    collection.row["offers"] = [{"worker_id": worker, "price": 600}, other_offer]
    results = await asyncio.gather(_quote(collection, worker, 450), _quote(collection, worker, 500))
    assert collection.writes == 2
    assert len(collection.row["offers"]) == 2
    assert collection.row["offers"][0] == other_offer
    assert collection.row["offers"][1]["worker_id"] == worker
    assert collection.row["offers"][1]["price"] == 500
    assert all("offers" not in result and "contact" not in result for result in results)


async def test_acceptance_during_requote_does_not_remove_the_accepted_offer(store):
    collection, db = store
    worker = ObjectId()
    collection.row["offers"] = [{"worker_id": worker, "price": 600}]
    original = deepcopy(collection.row["offers"])

    async def accept_during_user_lookup(*args):
        collection.row.update(status="accepted", accepted_worker_id=worker)
        return {"name": "Worker"}

    db.users.find_one.side_effect = accept_during_user_lookup
    with pytest.raises(HTTPException) as exc:
        await _quote(collection, worker, 450)
    assert exc.value.status_code == 409
    assert collection.row["offers"] == original
    assert collection.row["accepted_worker_id"] == worker
    assert collection.writes == 0


@pytest.mark.parametrize("initial", [None, []])
async def test_offer_pipeline_treats_dollar_strings_as_data(store, initial):
    collection, db = store
    worker = ObjectId()
    collection.row["offers"] = initial
    db.users.find_one.return_value = {"name": "$contact"}
    await _quote(collection, worker, note="$requester_id")
    assert collection.row["offers"][0]["worker_name"] == "$contact"
    assert collection.row["offers"][0]["note"] == "$requester_id"


async def test_offer_arriving_before_delete_is_preserved_and_cancelled(store):
    collection, _ = store
    offer = {"worker_id": ObjectId(), "price": 300}
    collection.before_delete = lambda coll: coll.row["offers"].append(offer)
    result = await _withdraw(collection)
    assert result["status"] == "cancelled"
    assert collection.row["offers"] == [offer]


@pytest.mark.parametrize("state", ["done", "cancelled"])
@pytest.mark.parametrize("offers", [False, True])
async def test_withdrawal_never_overwrites_a_concurrent_closure(store, state, offers):
    collection, _ = store
    if offers:
        collection.row["offers"] = [{"worker_id": ObjectId(), "price": 300}]
    close = lambda coll: coll.row.update(status=state)
    collection.before_delete = close
    collection.before_update = close
    with pytest.raises(HTTPException) as exc:
        await _withdraw(collection)
    assert exc.value.status_code == 409
    assert collection.row["status"] == state
    assert collection.writes == 0


async def test_an_accepted_request_with_no_offers_is_kept(store):
    collection, _ = store
    collection.row.update(status="accepted", accepted_worker_id=ObjectId())
    result = await _withdraw(collection)
    assert result["status"] == "cancelled"
    assert collection.row is not None


async def test_concurrent_withdrawals_report_deletion_only_once(store):
    collection, _ = store
    results = await asyncio.gather(_withdraw(collection), _withdraw(collection), return_exceptions=True)
    assert results[0] == {"status": "deleted"}
    assert isinstance(results[1], HTTPException)
    assert results[1].status_code == 404
    assert collection.row is None
    assert collection.writes == 1
