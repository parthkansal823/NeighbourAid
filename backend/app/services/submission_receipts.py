"""Durable, scoped report receipts; no process-local lock is relied upon.

Mongo's unique ``_id`` reserves a scoped client key. A short leased claim
allows retries after a crashed worker; the deterministically allocated alert
``_id`` fences overlapping workers and survives receipt TTL cleanup. This is
at-most-one alert insertion, not an exactly-once external notification claim.
No bearer token, anonymous capability, or IP is stored here. Only API-safe
creation response snapshots are retained, with a bounded 30-day lifetime.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

LEASE_SECONDS = 60
RETENTION_DAYS = 30
ANONYMOUS_CLIENT_HEADER = "X-Anonymous-Client-ID"
INTERNAL_ALERT_FIELDS = ("_submission_key", "_submission_hash")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _error(code: str, message: str, status: int = 409) -> HTTPException:
    headers = {"Retry-After": "2"} if code in {"SUBMISSION_PENDING", "RECEIPT_UNAVAILABLE"} else None
    return HTTPException(status, {"code": code, "message": message}, headers=headers)


def _pending() -> HTTPException:
    return _error("SUBMISSION_PENDING", "This report is still being submitted. Retry the same report shortly.")


def _uuid(value: Any, field: str) -> str:
    try:
        parsed = UUID(str(value))
        if parsed.version != 4:
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise _error("INVALID_SUBMISSION_ID", f"{field} must be an opaque UUID v4.", 400) from None
    return str(parsed)


def _scope(account_id: Any, anonymous_client_id: Any) -> str:
    if account_id is not None:
        try:
            return f"user:{ObjectId(str(account_id))}"
        except (InvalidId, ValueError, TypeError):
            raise _error("INVALID_SUBMISSION_SCOPE", "Invalid account scope.", 400) from None
    if anonymous_client_id is None:
        raise _error("MISSING_ANONYMOUS_CLIENT_ID", f"{ANONYMOUS_CLIENT_HEADER} is required for retryable anonymous reports.", 400)
    opaque_id = _uuid(anonymous_client_id, ANONYMOUS_CLIENT_HEADER)
    return "anonymous:" + hashlib.sha256(opaque_id.encode()).hexdigest()


def payload_hash(payload: dict) -> str:
    """Fingerprint the validated model, not raw JSON ordering or auth headers."""
    normalized = {key: value for key, value in payload.items() if key != "client_submission_id"}
    encoded = json.dumps(jsonable_encoder(normalized), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _alert_view(doc: dict) -> dict:
    result = deepcopy(doc)
    for field in INTERNAL_ALERT_FIELDS:
        result.pop(field, None)
    return result


@dataclass(frozen=True)
class SubmissionClaim:
    receipt_id: str
    scope: str
    payload_hash: str
    owner: str
    alert_id: ObjectId
    replay: dict | None = None
    persisted_alert: dict | None = None


async def ensure_receipt_indexes(db) -> None:
    # _id is already a unique index: the scope+UUID digest is the reservation.
    await db.submission_receipts.create_index("expires_at", expireAfterSeconds=0)


def _claim(doc: dict, **values) -> SubmissionClaim:
    return SubmissionClaim(doc["_id"], doc["scope"], doc["payload_hash"], doc["owner"], doc["alert_id"], **values)


async def _existing_alert(db, claim: SubmissionClaim) -> dict | None:
    doc = await db.alerts.find_one({"_id": claim.alert_id})
    if doc is None:
        return None
    # Do not recover an unrelated alert even on an ID collision or bad data.
    if doc.get("_submission_key") != claim.receipt_id or doc.get("_submission_hash") != claim.payload_hash:
        raise _error("IDEMPOTENCY_CONFLICT", "This submission key was already used for a different report.")
    return _alert_view(doc)


async def begin_submission(
    db, *, client_submission_id: Any = None, payload: dict,
    account_id: Any = None, anonymous_client_id: Any = None,
) -> SubmissionClaim | None:
    """Reserve before triage/side effects, or return a scoped replay/recovery.

    Missing IDs deliberately preserve legacy clients. Do not silently fall
    back to non-idempotent creation if a keyed receipt cannot be persisted.
    ``persisted_alert`` must be serialized and completed before any side effect.
    """
    if client_submission_id is None:
        return None
    submission_id = _uuid(client_submission_id, "client_submission_id")
    scope = _scope(account_id, anonymous_client_id)
    fingerprint = payload_hash(payload)
    receipt_id = hashlib.sha256(json.dumps([scope, submission_id]).encode()).hexdigest()
    now = _now()
    candidate = {
        "_id": receipt_id, "scope": scope, "payload_hash": fingerprint,
        "owner": str(uuid4()), "state": "pending",
        "alert_id": ObjectId(hashlib.sha256(("alert:" + receipt_id).encode()).hexdigest()[:24]),
        "created_at": now, "lease_until": now + timedelta(seconds=LEASE_SECONDS),
        "expires_at": now + timedelta(days=RETENTION_DAYS),
    }
    try:
        # Also covers tests/old workers which did not run the startup hook.
        await ensure_receipt_indexes(db)
        doc = await db.submission_receipts.find_one({"_id": receipt_id, "scope": scope})
        created = False
        if doc is None:
            # TTL may remove a receipt while its alert still exists. Check the
            # permanent fence BEFORE reserving a changed hash, otherwise that
            # rejected request could poison the legitimate original retry.
            await _existing_alert(db, _claim(candidate))
            try:
                await db.submission_receipts.insert_one(candidate)
                doc = candidate
                created = True
            except DuplicateKeyError:
                doc = await db.submission_receipts.find_one({"_id": receipt_id, "scope": scope})
        if doc is None:
            raise _pending()
        if doc["payload_hash"] != fingerprint:
            raise _error("IDEMPOTENCY_CONFLICT", "This submission key was already used for a different report.")
        if doc.get("state") == "completed" and isinstance(doc.get("response"), dict):
            return _claim(doc, replay=deepcopy(doc["response"]))
        existing = await _existing_alert(db, _claim(doc))
        if existing is not None:
            return _claim(doc, persisted_alert=existing)
        if created:
            return _claim(doc)
        # Compare-and-swap the lease: only one retry can become the new owner.
        claimed = await db.submission_receipts.find_one_and_update(
            {"_id": receipt_id, "scope": scope, "payload_hash": fingerprint,
             "state": "pending", "lease_until": {"$lte": now}},
            {"$set": {"owner": candidate["owner"], "lease_until": candidate["lease_until"], "expires_at": candidate["expires_at"]}},
            return_document=ReturnDocument.AFTER,
        )
        if claimed is None:
            # Completion can race the previous read; prefer its actual receipt.
            completed = await db.submission_receipts.find_one({"_id": receipt_id, "scope": scope, "payload_hash": fingerprint, "state": "completed"})
            if completed is not None and isinstance(completed.get("response"), dict):
                return _claim(completed, replay=deepcopy(completed["response"]))
            raise _pending()
        return _claim(claimed)
    except PyMongoError:
        raise _error("RECEIPT_UNAVAILABLE", "Submission receipts are temporarily unavailable. Retry the same report.", 503) from None


async def insert_submission_alert(db, claim: SubmissionClaim | None, doc: dict) -> tuple[dict, bool]:
    """Persist once and return (alert, created); never broadcast on False."""
    stored = deepcopy(doc)
    try:
        if claim is not None:
            active = await db.submission_receipts.find_one({
                "_id": claim.receipt_id, "scope": claim.scope, "payload_hash": claim.payload_hash,
                "owner": claim.owner, "state": "pending", "lease_until": {"$gt": _now()},
            })
            if active is None:
                existing = await _existing_alert(db, claim)
                if existing is not None:
                    return existing, False
                raise _pending()
            stored.update({"_id": claim.alert_id, "_submission_key": claim.receipt_id, "_submission_hash": claim.payload_hash})
        try:
            result = await db.alerts.insert_one(stored)
        except DuplicateKeyError:
            if claim is None:
                raise
            existing = await _existing_alert(db, claim)
            if existing is None:
                raise _pending()
            return existing, False
        stored["_id"] = result.inserted_id
        return _alert_view(stored), True
    except PyMongoError:
        raise _error("RECEIPT_UNAVAILABLE", "The report may have been saved. Retry the same report to confirm delivery.", 503) from None


async def complete_submission(db, claim: SubmissionClaim | None, response: dict) -> dict:
    """Store the API-safe creation response before background/broadcast work."""
    if claim is None:
        return response
    snapshot = jsonable_encoder(_alert_view(response))
    if str(snapshot.get("id")) != str(claim.alert_id):
        raise ValueError("Receipt response does not match the allocated alert")
    try:
        # Recovery is allowed for an existing alert, but never for another scope.
        if await _existing_alert(db, claim) is None:
            raise _pending()
        completed = await db.submission_receipts.find_one_and_update(
            {"_id": claim.receipt_id, "scope": claim.scope, "payload_hash": claim.payload_hash, "state": "pending", "owner": claim.owner},
            {"$set": {"state": "completed", "response": snapshot, "completed_at": _now()}, "$unset": {"lease_until": ""}},
            return_document=ReturnDocument.AFTER,
        )
        if completed is None:
            completed = await db.submission_receipts.find_one({"_id": claim.receipt_id, "scope": claim.scope, "payload_hash": claim.payload_hash, "state": "completed"})
        if completed is None or not isinstance(completed.get("response"), dict):
            raise _pending()
        return deepcopy(completed["response"])
    except PyMongoError:
        raise _error("RECEIPT_UNAVAILABLE", "The report was saved but its receipt is unavailable. Retry the same report.", 503) from None


async def release_submission(db, claim: SubmissionClaim | None) -> None:
    """Release only this lease, not the stable identity or unknown insert result."""
    if claim is None:
        return
    try:
        await db.submission_receipts.update_one(
            {"_id": claim.receipt_id, "scope": claim.scope, "payload_hash": claim.payload_hash, "owner": claim.owner, "state": "pending"},
            {"$set": {"lease_until": _now()}},
        )
    except PyMongoError:
        pass  # The bounded lease recovers if the database is still unavailable.
