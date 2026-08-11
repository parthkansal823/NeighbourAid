"""Safety check-ins — "I am safe" / "I need help" signals during area-wide
disasters. Think Facebook Safety Check but hyperlocal, open-source, and
displayed on the live map so loved ones and nearby volunteers can see
community-wide status at a glance.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..db.client import get_db
from ..models.user import GeoPoint

router = APIRouter(prefix="/api/safety", tags=["safety"])

_indexes_ready = False


async def _ensure_indexes(db) -> None:
    """Create the check-in indexes once per process, lazily on first use.

    `create_index` is idempotent but still a round trip to Mongo each time;
    running both on every `/near` read added two needless queries to a public
    endpoint the map polls.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    await db.safety_checkins.create_index([("location", "2dsphere")])
    await db.safety_checkins.create_index("expires_at", expireAfterSeconds=0)
    _indexes_ready = True


class CheckinCreate(BaseModel):
    status: Literal["safe", "need_help"]
    note: str = Field(default="", max_length=280)
    location: GeoPoint


@router.post("/", status_code=201)
async def create_checkin(
    body: CheckinCreate,
    payload: dict = Depends(get_current_user),
):
    """Post or refresh your safety status. Latest check-in per user wins."""
    db = get_db()
    # Also ensure indexes on the write path — the TTL index is what expires
    # stale check-ins, and it must exist even if nobody ever reads /near.
    await _ensure_indexes(db)
    user = await db.users.find_one(
        {"_id": ObjectId(payload["sub"])}, {"name": 1}
    )
    if not user:
        raise HTTPException(404, "User not found")

    now = datetime.now(timezone.utc)
    doc = {
        "user_id": ObjectId(payload["sub"]),
        "user_name": user.get("name", "Anonymous"),
        "status": body.status,
        "note": body.note.strip(),
        "location": body.location.model_dump(),
        "created_at": now,
        "expires_at": now + timedelta(hours=24),
    }
    # one active check-in per user — upsert-replace keeps the collection clean
    await db.safety_checkins.replace_one(
        {"user_id": ObjectId(payload["sub"])},
        doc,
        upsert=True,
    )
    return {
        "id": str(doc["user_id"]),  # one-per-user, user_id is stable
        "user_name": doc["user_name"],
        "status": doc["status"],
        "note": doc["note"],
        "location": doc["location"],
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
    }


@router.get("/near")
async def near(lat: float, lng: float, km: float = 5.0):
    """Public — list of recent check-ins within a radius. Used by the map
    + the safety page to give visibility over 'who's safe in my area'."""
    db = get_db()
    await _ensure_indexes(db)
    now = datetime.now(timezone.utc)
    cursor = db.safety_checkins.find(
        {
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": int(km * 1000),
                }
            },
            "expires_at": {"$gt": now},
        }
    ).limit(200)
    out = []
    async for doc in cursor:
        out.append(
            {
                "user_name": doc.get("user_name", "Anonymous"),
                "status": doc["status"],
                "note": doc.get("note", ""),
                "location": doc["location"],
                "created_at": doc["created_at"],
            }
        )
    return out


@router.get("/me")
async def my_checkin(payload: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.safety_checkins.find_one(
        {"user_id": ObjectId(payload["sub"])}
    )
    if not doc:
        return None
    return {
        "status": doc["status"],
        "note": doc.get("note", ""),
        "location": doc["location"],
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
    }
