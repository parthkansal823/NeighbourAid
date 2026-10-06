"""Private, adult, non-emergency clinician-review requests.

No diagnosis, prescriptions, automatic approval, or promised response time.
Operator-approved credentials are checked from Mongo on EVERY reviewer call;
neither a signup role nor a JWT claim grants clinical access. Keep medical
text out of alerts, broadcasts, push payloads and third-party AI services.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from ..core.limits import limit_write
from ..core.security import get_current_user
from ..db.client import get_db

router = APIRouter(prefix="/api/medical-review", tags=["medical-review"])
RETENTION_HOURS = 72


def _now():
    return datetime.now(timezone.utc)


def _approved(now):
    return {"active": True, "valid_until": {"$gt": now}, "approved_at": {"$exists": True}}


def _oid(value):
    if not ObjectId.is_valid(value):
        raise HTTPException(404, "Review request not found")
    return ObjectId(value)


class ReviewRequest(BaseModel):
    question: str = Field(min_length=10, max_length=1200)
    consent: Literal[True]
    adult_self: Literal[True]
    not_emergency: Literal[True]

    @field_validator("consent", "adult_self", "not_emergency", mode="before")
    @classmethod
    def _explicit_consent(cls, value):
        if value is not True:
            raise ValueError("explicit confirmation required")
        return value

    @field_validator("question")
    @classmethod
    def _trim(cls, value):
        value = value.strip()
        if len(value) < 10:
            raise ValueError("question must contain at least 10 non-space characters")
        return value


class ReviewResponse(BaseModel):
    disposition: Literal["emergency", "in_person", "more_information"]
    note: str = Field(min_length=10, max_length=1200)

    @field_validator("note")
    @classmethod
    def _trim(cls, value):
        value = value.strip()
        if len(value) < 10:
            raise ValueError("note must contain at least 10 non-space characters")
        return value


def _serialize(doc):
    # Explicit allow-list: never accidentally expose credential evidence,
    # requester's email, phone, location, or internal operator metadata.
    response = doc.get("response")
    if response:
        response = {key: response[key] for key in ("disposition", "note", "reviewed_at", "clinician_name", "council", "registration") if key in response}
    return {
        "id": str(doc["_id"]), "question": doc["question"],
        "status": doc["status"], "created_at": doc["created_at"],
        "expires_at": doc["expires_at"], "response": response,
    }


async def _clinician(user=Depends(get_current_user)):
    db = get_db()
    profile = await db.clinicians.find_one({"_id": ObjectId(user["sub"]), **_approved(_now())})
    if not profile or not await db.users.find_one({"_id": ObjectId(user["sub"])}, {"_id": 1}):
        raise HTTPException(403, "Current operator-approved clinician access required")
    return profile


@router.get("/status")
async def status():
    ready = await get_db().clinicians.find_one(_approved(_now()), {"_id": 1})
    return {"accepting_requests": bool(ready), "emergency_service": False, "retention_hours": RETENTION_HOURS}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    profile = await get_db().clinicians.find_one({"_id": ObjectId(user["sub"]), **_approved(_now())}, {"_id": 1})
    return {"can_review": bool(profile)}


@router.post("/requests", status_code=201, dependencies=[Depends(limit_write)])
async def request_review(body: ReviewRequest, user=Depends(get_current_user)):
    db = get_db()
    requester = ObjectId(user["sub"])
    if not await db.users.find_one({"_id": requester}, {"_id": 1}):
        raise HTTPException(401, "Account no longer exists")
    now = _now()
    if not await db.clinicians.find_one(_approved(now), {"_id": 1}):
        raise HTTPException(503, "No approved clinician is accepting requests. Seek local medical care; do not wait here.")
    # Logical cap prevents an unattended account flooding the private queue.
    if await db.medical_reviews.count_documents({"requester_id": requester, "status": {"$in": ["pending", "claimed"]}, "expires_at": {"$gt": now}}) >= 3:
        raise HTTPException(409, "You already have three pending reviews")
    doc = {"_id": ObjectId(), "requester_id": requester, "question": body.question,
           "status": "pending", "created_at": now, "expires_at": now + timedelta(hours=RETENTION_HOURS),
           "consent_at": now, "consent_version": "adult-self-non-emergency-v1"}
    await db.medical_reviews.insert_one(doc)
    return _serialize(doc)


@router.get("/mine")
async def mine(user=Depends(get_current_user)):
    cursor = get_db().medical_reviews.find({"requester_id": ObjectId(user["sub"]), "expires_at": {"$gt": _now()}}).sort("created_at", -1).limit(20)
    return [_serialize(doc) async for doc in cursor]


@router.delete("/requests/{request_id}", dependencies=[Depends(limit_write)])
async def withdraw(request_id: str, user=Depends(get_current_user)):
    result = await get_db().medical_reviews.delete_one({"_id": _oid(request_id), "requester_id": ObjectId(user["sub"])})
    if not result.deleted_count:
        raise HTTPException(404, "Review request not found")
    return {"deleted": True}


@router.get("/queue")
async def queue(limit: int = Query(20, ge=1, le=50), clinician=Depends(_clinician)):
    # Unclaimed cases show timestamps ONLY, not medical text or identities.
    db = get_db()
    now = _now()
    pending = db.medical_reviews.find({"status": "pending", "requester_id": {"$ne": clinician["_id"]}, "expires_at": {"$gt": now}}, {"_id": 1, "created_at": 1, "expires_at": 1}).sort("created_at", 1).limit(limit)
    assigned = db.medical_reviews.find({"assigned_to": clinician["_id"], "expires_at": {"$gt": now}}).sort("created_at", -1).limit(limit)
    return {"pending": [{"id": str(d["_id"]), "created_at": d["created_at"], "expires_at": d["expires_at"]} async for d in pending], "assigned": [_serialize(d) async for d in assigned]}


@router.post("/requests/{request_id}/claim", dependencies=[Depends(limit_write)])
async def claim(request_id: str, clinician=Depends(_clinician)):
    doc = await get_db().medical_reviews.find_one_and_update(
        {"_id": _oid(request_id), "status": "pending", "requester_id": {"$ne": clinician["_id"]}, "expires_at": {"$gt": _now()}},
        {"$set": {"status": "claimed", "assigned_to": clinician["_id"], "claimed_at": _now()}}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(409, "Request unavailable or already claimed")
    return _serialize(doc)


@router.post("/requests/{request_id}/response", dependencies=[Depends(limit_write)])
async def respond(request_id: str, body: ReviewResponse, clinician=Depends(_clinician)):
    response = {"disposition": body.disposition, "note": body.note, "reviewed_at": _now(),
                "clinician_name": clinician["name"], "council": clinician["council"], "registration": clinician["registration"]}
    doc = await get_db().medical_reviews.find_one_and_update(
        {"_id": _oid(request_id), "status": "claimed", "assigned_to": clinician["_id"], "expires_at": {"$gt": _now()}},
        {"$set": {"status": "reviewed", "response": response}}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(409, "You must hold the current assignment; this request may have expired or been withdrawn")
    return _serialize(doc)
