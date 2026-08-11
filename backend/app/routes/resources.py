"""Community-pinned resource map.

Endpoints:
  POST /api/resources/      — create (auth required, any role)
  GET  /api/resources/near  — public list within radius
  DELETE /api/resources/{id} — owner can remove their own pin

A 2dsphere index is created lazily on first list call (matches the
pattern in routes/safety.py — keeps lifespan() lean). A TTL index on
`expires_at` makes Mongo expire stale rows automatically.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user
from ..db.client import get_db
from ..models.resource import ResourceCreate

router = APIRouter(prefix="/api/resources", tags=["resources"])


def _serialize(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "kind": doc.get("kind"),
        "name": doc.get("name"),
        "contact": doc.get("contact"),
        "capacity": doc.get("capacity"),
        "notes": doc.get("notes"),
        "location": doc.get("location"),
        "owner_id": str(doc["owner_id"]) if doc.get("owner_id") else None,
        "owner_name": doc.get("owner_name"),
        "created_at": doc.get("created_at"),
        "expires_at": doc.get("expires_at"),
    }


_indexes_ready = False


async def _ensure_indexes(db) -> None:
    """Create the indexes once per process, lazily on first use, rather than
    at startup so the lifespan path stays minimal.

    `create_index` is idempotent but *not* free — it's a round trip to Mongo
    on every call. Doing it unconditionally meant two extra round trips on
    every single read of a public endpoint, which is the kind of overhead
    that shows up immediately on a free-tier database.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    await db.resources.create_index([("location", "2dsphere")])
    await db.resources.create_index("expires_at", expireAfterSeconds=0)
    _indexes_ready = True


@router.post("/", status_code=201)
async def create_resource(
    body: ResourceCreate,
    payload: dict = Depends(get_current_user),
):
    db = get_db()
    await _ensure_indexes(db)
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])}, {"name": 1})
    if not user:
        raise HTTPException(404, "User not found")
    now = datetime.now(timezone.utc)
    doc = {
        "kind": body.kind.value,
        "name": body.name,
        "contact": body.contact,
        "capacity": body.capacity,
        "notes": body.notes,
        "location": body.location.model_dump(),
        "owner_id": ObjectId(payload["sub"]),
        "owner_name": user.get("name") or "Volunteer",
        "created_at": now,
        "expires_at": now + timedelta(hours=body.valid_for_hours),
    }
    result = await db.resources.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


@router.get("/near")
async def list_near(lat: float, lng: float, km: float = 25.0):
    """Public — anyone (logged in or not) can browse the resource pins."""
    db = get_db()
    await _ensure_indexes(db)
    now = datetime.now(timezone.utc)
    cursor = db.resources.find(
        {
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": int(max(0.5, min(km, 200)) * 1000),
                }
            },
            "expires_at": {"$gt": now},
        }
    ).limit(200)
    return [_serialize(doc) async for doc in cursor]


@router.delete("/{resource_id}", status_code=204)
async def delete_resource(
    resource_id: str,
    payload: dict = Depends(get_current_user),
):
    """Only the user who created the pin can remove it. No admin override
    yet — moderators will arrive when there's enough volume to justify."""
    db = get_db()
    try:
        oid = ObjectId(resource_id)
    except (InvalidId, TypeError):
        raise HTTPException(400, "Invalid resource id")
    result = await db.resources.delete_one(
        {"_id": oid, "owner_id": ObjectId(payload["sub"])}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Resource not found or not yours")
    return None
