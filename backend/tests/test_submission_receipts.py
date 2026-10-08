"""Realistic atomic fake: concurrent writes, crashes, unknown commit results.

No MongoDB/network is used. Collection locks model Mongo's documented single-
document compare-and-swap and _id uniqueness, rather than independent mocks
which could never catch a double reservation.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi import HTTPException
from pymongo.errors import ConnectionFailure, DuplicateKeyError

from app.services import submission_receipts as receipts


class Collection:
    def __init__(self):
        self.docs = {}
        self.lock = asyncio.Lock()
        self.indexes = []
        self.fail_before = False
        self.fail_after = False

    @staticmethod
    def matches(doc, query):
        for key, expected in query.items():
            value = doc.get(key)
            if isinstance(expected, dict):
                if "$lte" in expected and (value is None or value > expected["$lte"]):
                    return False
                if "$gt" in expected and (value is None or value <= expected["$gt"]):
                    return False
            elif value != expected:
                return False
        return True

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        async with self.lock:
            if self.fail_before:
                raise ConnectionFailure("not available")
            stored = deepcopy(doc)
            stored.setdefault("_id", ObjectId())
            if stored["_id"] in self.docs:
                raise DuplicateKeyError("duplicate _id")
            self.docs[stored["_id"]] = stored
            if self.fail_after:
                raise ConnectionFailure("response lost after commit")
            return SimpleNamespace(inserted_id=stored["_id"])

    async def find_one(self, query):
        await asyncio.sleep(0)
        async with self.lock:
            return next((deepcopy(doc) for doc in self.docs.values() if self.matches(doc, query)), None)

    async def find_one_and_update(self, query, update, **_kwargs):
        await asyncio.sleep(0)
        async with self.lock:
            if self.fail_before:
                raise ConnectionFailure("not available")
            for doc in self.docs.values():
                if self.matches(doc, query):
                    doc.update(deepcopy(update.get("$set", {})))
                    for key in update.get("$unset", {}):
                        doc.pop(key, None)
                    return deepcopy(doc)
        return None

    async def update_one(self, query, update):
        doc = await self.find_one_and_update(query, update)
        return SimpleNamespace(modified_count=int(doc is not None))


class Database:
    def __init__(self):
        self.submission_receipts = Collection()
        self.alerts = Collection()


@pytest.fixture
def db():
    return Database()


@pytest.fixture
def identity():
    return {"client_submission_id": str(uuid4()), "account_id": ObjectId(), "payload": {"description": "Need help", "category": "medical", "location": {"coordinates": [76.7794, 30.7333]}}}


def response_for(doc):
    return {"id": str(doc["_id"]), "description": doc["description"], "created_at": doc.get("created_at"), "status": "open"}


async def persist(db, claim):
    doc, created = await receipts.insert_submission_alert(db, claim, {"description": "Need help", "created_at": datetime.now(timezone.utc)})
    return await receipts.complete_submission(db, claim, response_for(doc)), created


async def test_legacy_requests_do_not_allocate_receipts(db):
    assert await receipts.begin_submission(db, payload={}, anonymous_client_id="invalid") is None
    assert db.submission_receipts.docs == {}
    doc, created = await receipts.insert_submission_alert(db, None, {"description": "Legacy"})
    assert created and doc["_id"] in db.alerts.docs
    assert await receipts.complete_submission(db, None, {"id": str(doc["_id"])}) == {"id": str(doc["_id"])}


def test_canonical_payload_fingerprint_normalizes_order_and_ignores_key():
    assert receipts.payload_hash({"b": [1, 2], "a": "मदद"}) == receipts.payload_hash({"a": "मदद", "client_submission_id": str(uuid4()), "b": [1, 2]})
    assert receipts.payload_hash({"b": [1, 2]}) != receipts.payload_hash({"b": [2, 1]})
    with pytest.raises(ValueError):
        receipts.payload_hash({"lat": float("nan")})


@pytest.mark.parametrize("value", ["short", "Bearer secret", "00000000-0000-0000-0000-000000000000"])
async def test_nonopaque_submission_ids_are_rejected(db, identity, value):
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **{**identity, "client_submission_id": value})
    assert exc.value.status_code == 400
    assert db.submission_receipts.docs == {}


async def test_anonymous_capability_is_required_and_only_hash_stored(db, identity):
    anonymous_id = str(uuid4())
    params = {**identity, "account_id": None}
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **params)
    assert exc.value.detail["code"] == "MISSING_ANONYMOUS_CLIENT_ID"
    claim = await receipts.begin_submission(db, **params, anonymous_client_id=anonymous_id)
    assert anonymous_id not in repr(db.submission_receipts.docs)
    assert claim.scope.startswith("anonymous:")
    assert "description" not in next(iter(db.submission_receipts.docs.values()))


async def test_account_and_anonymous_scopes_never_share_receipts(db, identity):
    first = await receipts.begin_submission(db, **identity)
    original, _ = await persist(db, first)
    second = await receipts.begin_submission(db, **{**identity, "account_id": ObjectId()})
    anonymous = await receipts.begin_submission(db, **{**identity, "account_id": None}, anonymous_client_id=str(uuid4()))
    assert second.replay is None and anonymous.replay is None
    assert len({first.alert_id, second.alert_id, anonymous.alert_id}) == 3
    assert original["id"] == str(first.alert_id)


async def test_same_key_changed_payload_conflicts_without_leaking_response(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    await persist(db, claim)
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **{**identity, "payload": {"description": "Different private report"}})
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "IDEMPOTENCY_CONFLICT"
    assert "Need help" not in str(exc.value.detail)
    assert len(db.alerts.docs) == 1


async def test_parallel_reservations_have_one_owner_and_retryable_pending(db, identity):
    results = await asyncio.gather(*(receipts.begin_submission(db, **identity) for _ in range(10)), return_exceptions=True)
    claims = [result for result in results if isinstance(result, receipts.SubmissionClaim)]
    errors = [result for result in results if isinstance(result, HTTPException)]
    assert len(claims) == 1 and len(errors) == 9
    assert all(error.detail["code"] == "SUBMISSION_PENDING" and error.headers == {"Retry-After": "2"} for error in errors)
    assert len(db.submission_receipts.docs) == 1


async def test_lost_http_response_replays_original_snapshot_not_mutable_reference(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    original, created = await persist(db, claim)
    assert created
    replay = await receipts.begin_submission(db, **identity)
    assert replay.replay == original
    replay.replay["status"] = "changed by caller"
    again = await receipts.begin_submission(db, **identity)
    assert again.replay["status"] == "open"
    assert len(db.alerts.docs) == 1


async def test_unknown_insert_outcome_recovers_saved_alert_without_retry_insert(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    db.alerts.fail_after = True
    with pytest.raises(HTTPException) as exc:
        await receipts.insert_submission_alert(db, claim, {"description": "Need help"})
    assert exc.value.status_code == 503
    db.alerts.fail_after = False
    retry = await receipts.begin_submission(db, **identity)
    assert retry.persisted_alert["_id"] == claim.alert_id
    assert not any(field in retry.persisted_alert for field in receipts.INTERNAL_ALERT_FIELDS)
    saved = await receipts.complete_submission(db, retry, response_for(retry.persisted_alert))
    assert saved["id"] == str(claim.alert_id)
    assert len(db.alerts.docs) == 1


async def test_expired_worker_lease_recovers_without_stuck_pending_or_new_alert_id(db, identity, monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(receipts, "_now", lambda: now)
    old = await receipts.begin_submission(db, **identity)
    now += timedelta(seconds=receipts.LEASE_SECONDS + 1)
    retry = await receipts.begin_submission(db, **identity)
    assert retry.owner != old.owner and retry.alert_id == old.alert_id
    with pytest.raises(HTTPException):
        await receipts.insert_submission_alert(db, old, {"description": "Need help"})
    _, created = await persist(db, retry)
    assert created and len(db.alerts.docs) == 1


async def test_expired_claim_compare_and_swap_has_one_new_owner(db, identity, monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(receipts, "_now", lambda: now)
    old = await receipts.begin_submission(db, **identity)
    now += timedelta(seconds=receipts.LEASE_SECONDS + 1)
    results = await asyncio.gather(*(receipts.begin_submission(db, **identity) for _ in range(8)), return_exceptions=True)
    assert sum(isinstance(result, receipts.SubmissionClaim) for result in results) == 1
    assert next(result for result in results if isinstance(result, receipts.SubmissionClaim)).alert_id == old.alert_id


async def test_same_active_claim_concurrent_insert_is_fenced_by_unique_alert_id(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    results = await asyncio.gather(*(receipts.insert_submission_alert(db, claim, {"description": "Need help"}) for _ in range(8)))
    assert sum(created for _, created in results) == 1
    assert {doc["_id"] for doc, _ in results} == {claim.alert_id}
    assert len(db.alerts.docs) == 1


async def test_release_does_not_delete_identity_or_release_someone_elses_lease(db, identity, monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(receipts, "_now", lambda: now)
    old = await receipts.begin_submission(db, **identity)
    await receipts.release_submission(db, old)
    replacement = await receipts.begin_submission(db, **identity)
    await receipts.release_submission(db, old)
    stored = db.submission_receipts.docs[old.receipt_id]
    assert stored["owner"] == replacement.owner
    assert stored["lease_until"] > now
    assert old.alert_id == replacement.alert_id


async def test_stale_owner_cannot_replace_completed_receipt(db, identity, monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(receipts, "_now", lambda: now)
    old = await receipts.begin_submission(db, **identity)
    now += timedelta(seconds=receipts.LEASE_SECONDS + 1)
    new = await receipts.begin_submission(db, **identity)
    original, _ = await persist(db, new)
    assert await receipts.complete_submission(db, old, {**original, "status": "forged stale status"}) == original


async def test_receipt_write_failure_after_alert_commit_is_recoverable(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    doc, _ = await receipts.insert_submission_alert(db, claim, {"description": "Need help"})
    db.submission_receipts.fail_before = True
    with pytest.raises(HTTPException) as exc:
        await receipts.complete_submission(db, claim, response_for(doc))
    assert exc.value.status_code == 503
    db.submission_receipts.fail_before = False
    retry = await receipts.begin_submission(db, **identity)
    assert retry.persisted_alert["_id"] == claim.alert_id
    await receipts.complete_submission(db, retry, response_for(retry.persisted_alert))
    assert len(db.alerts.docs) == 1


async def test_ttl_deleted_receipt_still_recovers_stable_alert_and_payload_conflict(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    await persist(db, claim)
    db.submission_receipts.docs.clear()  # Model Mongo's asynchronous TTL deletion.
    retry = await receipts.begin_submission(db, **identity)
    assert retry.alert_id == claim.alert_id and retry.persisted_alert is not None
    db.submission_receipts.docs.clear()
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **{**identity, "payload": {"description": "Changed"}})
    assert exc.value.detail["code"] == "IDEMPOTENCY_CONFLICT"
    assert len(db.alerts.docs) == 1
    # A rejected changed payload must not poison the original receipt key.
    original_retry = await receipts.begin_submission(db, **identity)
    assert original_retry.persisted_alert["_id"] == claim.alert_id


async def test_unrelated_alert_is_never_recovered_even_on_id_collision(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    db.alerts.docs[claim.alert_id] = {"_id": claim.alert_id, "description": "Another account"}
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **identity)
    assert exc.value.detail["code"] == "IDEMPOTENCY_CONFLICT"
    assert "Another account" not in str(exc.value.detail)


async def test_receipt_storage_is_ttl_bounded_and_database_failure_never_falls_back(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    row = db.submission_receipts.docs[claim.receipt_id]
    assert row["expires_at"] - row["created_at"] == timedelta(days=receipts.RETENTION_DAYS)
    assert (("expires_at",), {"expireAfterSeconds": 0}) in db.submission_receipts.indexes
    db.submission_receipts.fail_before = True
    with pytest.raises(HTTPException) as exc:
        await receipts.begin_submission(db, **{**identity, "client_submission_id": str(uuid4())})
    assert exc.value.status_code == 503
    assert db.alerts.docs == {}


async def test_complete_rejects_wrong_alert_identity(db, identity):
    claim = await receipts.begin_submission(db, **identity)
    with pytest.raises(ValueError):
        await receipts.complete_submission(db, claim, {"id": str(ObjectId())})
