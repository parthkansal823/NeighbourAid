import asyncio
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user
from ..db.client import get_db
from ..models.user import LocationUpdate, ProfileUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


def _serialize_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "location": user["location"],
        "skills": user.get("skills", []),
        "has_vehicle": bool(user.get("has_vehicle", False)),
        "emergency_contacts": user.get("emergency_contacts", []),
        "created_at": user["created_at"],
    }


@router.get("/me")
async def me(payload: dict = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        raise HTTPException(404, "User not found")
    return _serialize_user(user)


@router.patch("/me/location")
async def update_location(
    body: LocationUpdate,
    payload: dict = Depends(get_current_user),
):
    db = get_db()
    result = await db.users.find_one_and_update(
        {"_id": ObjectId(payload["sub"])},
        {
            "$set": {
                "location": body.location.model_dump(),
                "location_updated_at": datetime.now(timezone.utc),
            }
        },
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "User not found")
    return _serialize_user(result)


@router.patch("/me/profile")
async def update_profile(
    body: ProfileUpdate,
    payload: dict = Depends(get_current_user),
):
    """Patch-style update: only non-None fields are written. Keeps the
    endpoint usable for any single-field tweak (e.g. toggling has_vehicle)
    without forcing the client to round-trip the whole profile."""
    updates: dict = {}
    if body.skills is not None:
        updates["skills"] = [s.value for s in body.skills]
    if body.has_vehicle is not None:
        updates["has_vehicle"] = bool(body.has_vehicle)
    if body.emergency_contacts is not None:
        updates["emergency_contacts"] = [c.model_dump() for c in body.emergency_contacts]
    if not updates:
        raise HTTPException(400, "No profile fields supplied")

    db = get_db()
    result = await db.users.find_one_and_update(
        {"_id": ObjectId(payload["sub"])},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "User not found")
    return _serialize_user(result)


@router.get("/me/stats")
async def my_stats(payload: dict = Depends(get_current_user)):
    """Lightweight stats for the profile page — alerts posted and accepted by me."""
    db = get_db()
    uid = ObjectId(payload["sub"])
    role = payload.get("role")

    # Counts in each branch are independent of each other, so they go out
    # together rather than one round trip after another — same reasoning as
    # routes/stats.py. The profile page waits on this before it can render.
    if role == "reporter":
        posted, resolved, open_ = await asyncio.gather(
            db.alerts.count_documents({"reporter_id": uid}),
            db.alerts.count_documents({"reporter_id": uid, "status": "resolved"}),
            db.alerts.count_documents({"reporter_id": uid, "status": "open"}),
        )
        return {
            "role": "reporter",
            "posted": posted,
            "open": open_,
            "resolved": resolved,
        }

    # volunteer
    accepted, resolved = await asyncio.gather(
        db.alerts.count_documents({"accepted_by": uid}),
        db.alerts.count_documents({"accepted_by": uid, "status": "resolved"}),
    )
    # Trust score is derived from the accept→resolve ratio with sample-size
    # smoothing so a 1-of-1 fluke doesn't auto-promote to "trusted".
    from .stats import _compute_trust  # local import — avoids a stats↔users cycle

    trust = _compute_trust(accepted, resolved)
    return {
        "role": "volunteer",
        "accepted": accepted,
        "resolved": resolved,
        "in_progress": accepted - resolved,
        "trust": trust,
    }
