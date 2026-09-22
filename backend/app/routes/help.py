"""Paid neighbourhood help — an electrician, a plumber, someone to look at a
laptop that will not start.

WHY THIS IS A SEPARATE MODULE AND NOT A NEW AlertCategory

It was tempting to add `repair` and `tech` to AlertCategory and be done. That
would have been wrong, and the reason is worth writing down.

An alert is an emergency. Everything the alert pipeline does assumes that:
urgency triage ranks it, a geo-fenced broadcast wakes nearby volunteers,
escalation bumps it if nobody accepts, corroboration counts how many people
are reporting the same thing, and the whole feed is ordered by who needs help
most urgently.

None of that applies to a dead fuse box. There is no urgency band for it, no
one should be woken at 3am, nothing should escalate, and a second person
asking for a plumber on the same street is not corroboration — it is a second
job. Putting these in the same collection would have meant carrying an
emergency's machinery on a request that needs none of it, and, far worse,
letting a paid job compete for space in a feed whose entire purpose is that
the most urgent thing is at the top.

So: separate collection, separate feed, separate page. It reuses what it
genuinely shares — geo search, auth, the rate limiter, the skill vocabulary —
and nothing else.

WHAT "PAID" MEANS HERE, AND WHAT IT DOES NOT

A requester states a budget range. A worker makes an offer. They agree and
settle between themselves.

This deliberately does NOT process payments. Taking money would mean KYC,
an escrow account, refunds, chargebacks, dispute resolution and a payment
licence — none of which belongs in a crisis-response app, and all of which
would have to be right before a single rupee moved. Money here is an
expectation the two parties set in advance so nobody is surprised, which is
the part that actually prevents most disputes.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from ..core.limits import limit_write
from ..core.security import get_current_user
from ..db.client import get_db
from ..models.user import GeoPoint

router = APIRouter(prefix="/api/help", tags=["help"])

_indexes_ready = False


async def _ensure_indexes(db) -> None:
    """Create the indexes once per process, lazily on first use.

    Same pattern and same reasoning as routes/safety.py: `create_index` is
    idempotent but is still a round trip to Mongo on every call, and this
    collection is read by a public browse endpoint.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    await db.help_requests.create_index([("location", "2dsphere")])
    # Browse filters on status and sorts by recency; /mine filters on the
    # requester. Both are the whole query, so both get a compound index.
    await db.help_requests.create_index([("status", 1), ("created_at", -1)])
    await db.help_requests.create_index([("requester_id", 1), ("created_at", -1)])
    # Requests expire rather than pile up. A plumber wanted three weeks ago
    # is noise, and nobody comes back to close their own request.
    await db.help_requests.create_index("expires_at", expireAfterSeconds=0)
    _indexes_ready = True


# The trades people actually ask a neighbour for. Deliberately a closed set:
# free text here would make the list unfilterable and unsearchable, and the
# whole value of this page is finding the one person who can do the thing.
HelpKind = Literal[
    "electrician",
    "plumber",
    "carpenter",
    "mechanic",
    "appliance",
    "tech",
    "tutor",
    "cleaning",
    "moving",
    "other",
]

# How long a request stays open before the TTL index removes it.
REQUEST_TTL_DAYS = 14

# Budget bounds, in rupees. The ceiling is not about what work costs — it is
# an abuse guard, because an unbounded number in a public listing is an
# invitation. The floor allows 0 for "tell me your price".
BUDGET_MAX = 500000


class HelpCreate(BaseModel):
    kind: HelpKind
    title: str = Field(min_length=4, max_length=120)
    description: str = Field(default="", max_length=1000)
    location: GeoPoint
    budget_min: int = Field(default=0, ge=0, le=BUDGET_MAX)
    budget_max: int = Field(default=0, ge=0, le=BUDGET_MAX)
    # Free text rather than a structured phone field: some people will want
    # to be reached on WhatsApp, some by a shop landline, some not at all
    # until they have seen who is offering.
    contact: str = Field(default="", max_length=120)

    @field_validator("title", "description", "contact")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("budget_max")
    @classmethod
    def _sane_range(cls, v: int, info) -> int:
        lo = info.data.get("budget_min", 0)
        # A max below the min is a typo, not a preference, and it would make
        # the listing read as an insult ("₹500–₹100").
        if v and lo and v < lo:
            raise ValueError("budget_max cannot be less than budget_min")
        return v


class OfferCreate(BaseModel):
    price: int = Field(ge=0, le=BUDGET_MAX)
    note: str = Field(default="", max_length=300)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


def _serialize(doc: dict, viewer_id: str | None = None) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc["requester_id"] = str(doc["requester_id"])
    offers = doc.get("offers") or []
    for off in offers:
        off["worker_id"] = str(off["worker_id"])

    # Contact details are not public.
    #
    # A phone number on an open listing is a number that gets scraped. It is
    # released to the requester (their own row) and to a worker whose offer
    # has been accepted — the point at which the two of them are actually
    # arranging a visit.
    is_requester = viewer_id is not None and viewer_id == doc["requester_id"]
    accepted = doc.get("accepted_worker_id")
    is_accepted_worker = (
        viewer_id is not None and accepted is not None and viewer_id == str(accepted)
    )
    if not (is_requester or is_accepted_worker):
        doc.pop("contact", None)

    doc["accepted_worker_id"] = str(accepted) if accepted else None
    doc["offer_count"] = len(offers)
    # The offers themselves are the requester's to read. A worker seeing what
    # everyone else quoted turns this into a reverse auction, which is not
    # what a neighbour asking for a plumber signed up for.
    if not is_requester:
        doc.pop("offers", None)
    return doc


@router.post("/", status_code=201, dependencies=[Depends(limit_write)])
async def create_request(
    body: HelpCreate,
    payload: dict = Depends(get_current_user),
):
    """Post a request for paid help."""
    db = get_db()
    await _ensure_indexes(db)

    now = datetime.now(timezone.utc)
    doc = {
        "requester_id": ObjectId(payload["sub"]),
        "kind": body.kind,
        "title": body.title,
        "description": body.description,
        "location": body.location.model_dump(),
        "budget_min": body.budget_min,
        "budget_max": body.budget_max,
        "contact": body.contact,
        "status": "open",
        "offers": [],
        "accepted_worker_id": None,
        "created_at": now,
        "expires_at": now + timedelta(days=REQUEST_TTL_DAYS),
    }
    result = await db.help_requests.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc, viewer_id=payload["sub"])


@router.get("/near")
async def list_near(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    km: float = Query(default=10.0, gt=0, le=50),
    kind: str | None = Query(default=None),
):
    """Open requests near a point, nearest first.

    Public on purpose. Someone deciding whether this app is worth installing
    should be able to see whether anyone nearby actually needs their trade.
    Contact details are withheld by `_serialize` regardless.
    """
    db = get_db()
    await _ensure_indexes(db)

    query: dict = {
        "location": {
            "$nearSphere": {
                "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                "$maxDistance": int(km * 1000),
            }
        },
        "status": "open",
    }
    if kind:
        query["kind"] = kind

    cursor = db.help_requests.find(query).limit(100)
    return [_serialize(doc) async for doc in cursor]


@router.get("/mine")
async def my_requests(payload: dict = Depends(get_current_user)):
    """Requests I posted, and requests I have offered on.

    Both in one call: a worker's "did they accept?" and a requester's "who
    replied?" are the same screen, and two round trips for one screen is one
    too many on a phone.
    """
    db = get_db()
    await _ensure_indexes(db)
    uid = ObjectId(payload["sub"])

    posted_cursor, offered_cursor = (
        db.help_requests.find({"requester_id": uid}).sort("created_at", -1).limit(50),
        db.help_requests.find({"offers.worker_id": uid})
        .sort("created_at", -1)
        .limit(50),
    )
    posted, offered = await asyncio.gather(
        posted_cursor.to_list(50), offered_cursor.to_list(50)
    )
    return {
        "posted": [_serialize(d, viewer_id=payload["sub"]) for d in posted],
        "offered": [_serialize(d, viewer_id=payload["sub"]) for d in offered],
    }


@router.post("/{request_id}/offers", status_code=201, dependencies=[Depends(limit_write)])
async def make_offer(
    request_id: str,
    body: OfferCreate,
    payload: dict = Depends(get_current_user),
):
    """Offer to do the job at a price."""
    db = get_db()
    oid = _oid(request_id)
    worker_id = ObjectId(payload["sub"])

    doc = await db.help_requests.find_one({"_id": oid}, {"requester_id": 1, "status": 1})
    if not doc:
        raise HTTPException(404, "Request not found")
    if doc["requester_id"] == worker_id:
        raise HTTPException(400, "You cannot offer on your own request")
    if doc.get("status") != "open":
        raise HTTPException(409, "This request is no longer open")

    user = await db.users.find_one({"_id": worker_id}, {"name": 1})
    offer = {
        "worker_id": worker_id,
        "worker_name": (user or {}).get("name", "Neighbour"),
        "price": body.price,
        "note": body.note,
        "created_at": datetime.now(timezone.utc),
    }

    # One offer per worker, replaced if they quote again — `$pull` then
    # `$push` in two steps would leave a window where the offer is gone, so
    # the pull is filtered to this worker and the push runs after it.
    await db.help_requests.update_one(
        {"_id": oid}, {"$pull": {"offers": {"worker_id": worker_id}}}
    )
    updated = await db.help_requests.find_one_and_update(
        {"_id": oid, "status": "open"},
        {"$push": {"offers": offer}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(409, "This request is no longer open")
    return _serialize(updated, viewer_id=payload["sub"])


@router.patch("/{request_id}/accept")
async def accept_offer(
    request_id: str,
    worker_id: str = Query(...),
    payload: dict = Depends(get_current_user),
):
    """Accept one worker's offer. Only the requester can."""
    db = get_db()
    oid = _oid(request_id)
    w_oid = _oid(worker_id)

    updated = await db.help_requests.find_one_and_update(
        {
            "_id": oid,
            "requester_id": ObjectId(payload["sub"]),
            "status": "open",
            "offers.worker_id": w_oid,
        },
        {"$set": {"status": "accepted", "accepted_worker_id": w_oid}},
        return_document=True,
    )
    if not updated:
        # One 404 for "not yours", "not open" and "no such offer" on purpose:
        # distinguishing them would let anyone probe which requests exist and
        # who has offered on them.
        raise HTTPException(404, "Request not found, not yours, or no longer open")
    return _serialize(updated, viewer_id=payload["sub"])


@router.patch("/{request_id}/done")
async def mark_done(request_id: str, payload: dict = Depends(get_current_user)):
    """Close a request. Only the requester can."""
    db = get_db()
    updated = await db.help_requests.find_one_and_update(
        {"_id": _oid(request_id), "requester_id": ObjectId(payload["sub"])},
        {"$set": {"status": "done", "done_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(404, "Request not found or not yours")
    return _serialize(updated, viewer_id=payload["sub"])


@router.delete("/{request_id}")
async def withdraw_request(request_id: str, payload: dict = Depends(get_current_user)):
    """Withdraw a request. Only the requester can.

    Two outcomes, decided by whether anyone else has put work in:

    * Nobody has offered — the row is deleted. It exists in no one else's
      screen, so there is nothing to explain to anyone.
    * Someone has offered, or a worker was accepted — the row is kept and
      marked `cancelled`. A plumber who quoted, rearranged an afternoon and
      set out is owed the word "cancelled", not a row that silently stops
      existing. `/mine` returns it to them as `offered`, so they see it.

    Nothing is kept forever either way: a cancelled row still carries the
    `expires_at` it was created with, so the TTL index clears it on the same
    14-day schedule as everything else.
    """
    db = get_db()
    oid = _oid(request_id)
    owner = {"_id": oid, "requester_id": ObjectId(payload["sub"])}

    doc = await db.help_requests.find_one(owner, {"offers": 1, "status": 1})
    if not doc:
        raise HTTPException(404, "Request not found or not yours")
    if doc.get("status") in ("done", "cancelled"):
        raise HTTPException(409, f"Request is already {doc['status']}")

    if not (doc.get("offers") or []):
        await db.help_requests.delete_one(owner)
        return {"status": "deleted"}

    updated = await db.help_requests.find_one_and_update(
        owner,
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": datetime.now(timezone.utc),
            }
        },
        return_document=True,
    )
    return _serialize(updated, viewer_id=payload["sub"])


def _oid(value: str) -> ObjectId:
    """Parse an id or raise 400, rather than leaking pymongo's InvalidId as
    a 500. Same helper as routes/alerts.py."""
    from bson.errors import InvalidId  # noqa: PLC0415

    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(400, "Invalid id")
