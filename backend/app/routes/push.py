"""Web push subscriptions.

Three endpoints and no cleverness: hand the browser the public key, store
what it gives back, delete it on request. The interesting half is in
services/push.py.

A subscription is not a secret but it is a capability — anyone holding one
can make that device buzz. So they are stored per user, only ever written
by the authenticated owner, and never returned in any listing.
"""

from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..core.limits import limit_write
from ..core.security import get_current_user
from ..db.client import get_db
from ..services.push import COLLECTION, is_enabled, public_key

router = APIRouter(prefix="/api/push", tags=["push"])

_indexes_ready = False


async def _ensure_indexes(db) -> None:
    """Same latch as routes/help.py — index creation is idempotent but it is
    still a round trip, and this runs on every subscribe."""
    global _indexes_ready
    if _indexes_ready:
        return
    # One row per endpoint. A browser that re-subscribes with the same
    # endpoint must update, not duplicate, or every alert is delivered twice.
    await db[COLLECTION].create_index("endpoint", unique=True)
    await db[COLLECTION].create_index("user_id")
    _indexes_ready = True


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=64)


class SubscriptionIn(BaseModel):
    """The shape `PushSubscription.toJSON()` produces, unchanged.

    Taking the browser's own object verbatim means the client never has to
    reshape it, and a future field the spec adds arrives without a change
    here — `expirationTime` is ignored rather than rejected for that reason.
    """

    endpoint: str = Field(min_length=12, max_length=2000)
    keys: SubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def https_only(cls, v: str) -> str:
        # Every real push service is https. A plain-http endpoint is either a
        # misconfiguration or someone pointing this server at something of
        # their choosing, and neither should be stored.
        if not v.startswith("https://"):
            raise ValueError("endpoint must be https")
        return v


@router.get("/key")
async def get_public_key() -> dict:
    """The `applicationServerKey` for `pushManager.subscribe()`.

    Public on purpose: it is public-key material, the client needs it before
    it can authenticate anything, and 503-ing when push is off is how the UI
    knows not to offer the toggle at all.
    """
    if not is_enabled():
        raise HTTPException(503, "Push notifications are not configured")
    return {"public_key": public_key()}


@router.post("/subscribe", status_code=201, dependencies=[Depends(limit_write)])
async def subscribe(
    body: SubscriptionIn,
    payload: dict = Depends(get_current_user),
) -> dict:
    """Store (or refresh) this device's subscription."""
    if not is_enabled():
        raise HTTPException(503, "Push notifications are not configured")

    db = get_db()
    await _ensure_indexes(db)

    # Keyed on endpoint, not on user: one person may carry a phone and a
    # laptop, and both should ring. Re-subscribing the same device replaces
    # its row, which is also how a browser's periodic key rotation lands.
    await db[COLLECTION].update_one(
        {"endpoint": body.endpoint},
        {
            "$set": {
                "user_id": ObjectId(payload["sub"]),
                "endpoint": body.endpoint,
                "keys": body.keys.model_dump(),
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {"status": "subscribed"}


@router.delete("/subscribe", status_code=204)
async def unsubscribe(
    body: SubscriptionIn,
    payload: dict = Depends(get_current_user),
) -> None:
    """Remove this device. Scoped to the owner so one account cannot
    unsubscribe another's device by quoting its endpoint."""
    db = get_db()
    await db[COLLECTION].delete_one(
        {"endpoint": body.endpoint, "user_id": ObjectId(payload["sub"])}
    )
