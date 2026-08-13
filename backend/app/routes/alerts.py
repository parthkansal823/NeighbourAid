import asyncio
import math
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Request

from ..core.limits import limit_write
from ..core.security import decode_token_safe, get_current_user, require_role
from ..db.client import get_db
from ..models.alert import AlertCreate, AlertUpdateCreate, ETAUpdate
from ..services.ai import generate_headline, triage as ai_triage
from ..services.enrich import enrich_alert
from ..services.photo import analyze_photos
from ..services.ratelimit import anonymous_alert_limiter
from ..services.verification import (
    WITNESS_RADIUS_M,
    bump_witness,
    compute_verified_score,
    filter_corroborating,
    find_corroborating_alerts,
)
from ..services.weather import supports_category
from ..services.webhook import fire_alert_created
from ..services.websocket import (
    CATEGORY_PREFERRED_SKILLS,
    DEFAULT_RADIUS_KM,
    SKILL_RADIUS_KM,
    manager,
)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Strong references to in-flight background tasks. asyncio only holds a weak
# reference to a task, so without this a running enrichment can be collected
# partway through and simply vanish.
_background_tasks: set = set()


# Open alerts older than this with no volunteer accept are auto-resolved on
# next /nearby read. Lazy cleanup avoids a cron/task runner for a single-op
# chore and keeps the public feed from growing stale indefinitely.
AUTO_RESOLVE_AFTER = timedelta(hours=24)

# Multi-step escalation: an open unaccepted alert at MEDIUM that's been
# sitting too long auto-bumps to HIGH. Likewise HIGH → CRITICAL after a
# shorter window. Prevents alerts rotting in low-coverage areas — pure
# backend logic, no cron needed (runs on each /nearby read).
ESCALATE_MEDIUM_TO_HIGH_AFTER = timedelta(minutes=10)
ESCALATE_HIGH_TO_CRITICAL_AFTER = timedelta(minutes=4)

# Threshold of community flags before an alert is hidden from the public
# feed. Anyone can flag once; keeps griefing possible but slow. Three
# independent flags is a reasonable "this is clearly spam" signal.
FLAG_HIDE_THRESHOLD = 3

# List endpoints omit photos from the payload — base64-encoded images are
# large enough that including them per-alert would balloon /nearby and
# /mine responses. Clients fetch photos lazily via GET /{id}/photos when
# the card is expanded. This is the single biggest perf fix after adding
# photo uploads.
_LIST_PROJECTION = {"photos": 0, "photo_checks": 0, "flagged_by": 0, "witnessed_by": 0}


def _oid(alert_id: str) -> ObjectId:
    """Parse a path-param ObjectId or raise 400. Avoids leaking pymongo's
    InvalidId traceback as a 500."""
    try:
        return ObjectId(alert_id)
    except (InvalidId, TypeError):
        raise HTTPException(400, "Invalid alert id")


def _serialize(doc: dict, include_photos: bool = True) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc["reporter_id"] = str(doc["reporter_id"])
    if doc.get("accepted_by"):
        doc["accepted_by"] = str(doc["accepted_by"])
    # normalise verification fields so the frontend has stable defaults
    doc.setdefault("witnesses", 1)
    doc.setdefault("witnessed_by", [])
    doc.setdefault("verified_score", 0)
    doc.setdefault("address", None)
    doc.setdefault("weather", None)
    doc.setdefault("weather_match", False)
    doc.setdefault("corroborating_ids", [])
    doc.setdefault("urgency_confidence", 0.5)
    doc.setdefault("vulnerability", None)
    doc.setdefault("time_sensitivity", "hours")
    doc.setdefault("language", "en")
    doc.setdefault("triggers", [])
    doc.setdefault("priority_score", 40)
    doc.setdefault("headline", "")
    doc.setdefault("eta_minutes", None)
    doc.setdefault("eta_set_at", None)
    doc.setdefault("flags", 0)
    doc.setdefault("photo_evidence_score", 0)
    doc.setdefault("photo_confidence", 0.0)
    doc.setdefault("photo_findings", "")
    doc.setdefault("is_anonymous", False)
    # The IP hash is forensic-only — never expose it via the API.
    doc.pop("anonymous_ip_hash", None)
    # Photo count is stored denormalised on the doc so it survives list
    # projections (which strip the heavy `photos` array for payload size).
    # When a caller hands us a doc that was loaded with photos inline we
    # prefer len(photos) in case photo_count was never backfilled.
    doc["photo_count"] = (
        len(doc["photos"]) if isinstance(doc.get("photos"), list)
        else int(doc.get("photo_count") or 0)
    )
    if not include_photos:
        doc.pop("photos", None)
    else:
        doc.setdefault("photos", [])
    # drop internal-only fields so user IDs / flagger IDs are never leaked
    doc.pop("witnessed_by", None)
    doc.pop("flagged_by", None)
    doc.pop("photo_checks", None)
    return doc


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(a))


async def _auto_resolve_stale(db) -> None:
    """Mark any open-but-unaccepted alerts older than AUTO_RESOLVE_AFTER as
    resolved so they stop cluttering the volunteer feed. Best-effort — if the
    DB is unreachable we just skip it; the live read will retry next call."""
    cutoff = datetime.now(timezone.utc) - AUTO_RESOLVE_AFTER
    try:
        await db.alerts.update_many(
            {"status": "open", "accepted_by": None, "created_at": {"$lt": cutoff}},
            {
                "$set": {
                    "status": "resolved",
                    "resolved_at": datetime.now(timezone.utc),
                    "auto_resolved": True,
                }
            },
        )
    except Exception:  # noqa: BLE001 — cleanup must never break the request
        pass


async def _auto_escalate_unaccepted(db) -> list[dict]:
    """Walk the unaccepted-alerts table and bump urgency for ones that have
    been sitting too long. Returns the list of alerts that just got bumped
    so the caller can rebroadcast them to volunteers (an escalated alert
    that no one re-pings is no escalation at all).

    Two ladders run independently: HIGH → CRITICAL fires faster than
    MEDIUM → HIGH, on the assumption that already-HIGH alerts have less
    margin for delay than already-MEDIUM ones.

    Each rung is timed from when the alert *entered* its current urgency
    (`urgency_since`, falling back to `created_at` for docs written before
    that field existed) rather than from creation. Without that, an alert
    that sat at MEDIUM for an hour would climb MEDIUM → HIGH → CRITICAL on
    two consecutive reads seconds apart, because its `created_at` already
    satisfies both windows — which is not an escalation *ladder*, just a
    slow jump straight to CRITICAL."""
    now = datetime.now(timezone.utc)
    bumped: list[dict] = []

    ladders = [
        # (from_urgency, to_urgency, after_delta)
        ("HIGH", "CRITICAL", ESCALATE_HIGH_TO_CRITICAL_AFTER),
        ("MEDIUM", "HIGH", ESCALATE_MEDIUM_TO_HIGH_AFTER),
    ]
    try:
        for from_u, to_u, after in ladders:
            cutoff = now - after
            stale_at_current_urgency = {
                "$expr": {
                    "$lt": [{"$ifNull": ["$urgency_since", "$created_at"]}, cutoff]
                }
            }
            cursor = db.alerts.find(
                {
                    "status": "open",
                    "accepted_by": None,
                    "urgency": from_u,
                    **stale_at_current_urgency,
                }
            )
            async for doc in cursor:
                updated = await db.alerts.find_one_and_update(
                    # Re-assert the urgency inside the update filter so two
                    # concurrent /nearby reads can't both bump the same alert.
                    {"_id": doc["_id"], "urgency": from_u},
                    {
                        "$set": {
                            "urgency": to_u,
                            "urgency_since": now,
                            "auto_escalated": True,
                            "auto_escalated_at": now,
                            "urgency_reason": (
                                (doc.get("urgency_reason") or "")
                                + f" · auto-escalated {from_u}→{to_u} after no acceptance"
                            ).strip(" ·"),
                        }
                    },
                    return_document=True,
                    projection=_LIST_PROJECTION,
                )
                if updated is not None:
                    bumped.append(updated)
    except Exception:  # noqa: BLE001 — never let cleanup break the read path
        return bumped
    return bumped


async def _volunteer_context_from_request(request: Request, db) -> dict | None:
    """Best-effort auth parsing for the public /nearby feed.

    Volunteers get a richer result set: alerts that match their skills can
    extend beyond the default radius, and each alert includes distance /
    skill-match metadata. Anonymous/public callers keep the simpler radius-only
    behavior.
    """
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None

    payload = decode_token_safe(auth.split(" ", 1)[1].strip())
    if not payload or payload.get("role") != "volunteer":
        return None

    try:
        user = await db.users.find_one(
            {"_id": ObjectId(payload["sub"])},
            {"skills": 1, "has_vehicle": 1},
        )
    except (InvalidId, TypeError):
        return None

    return {
        "id": payload["sub"],
        "skills": list((user or {}).get("skills") or []),
        "has_vehicle": bool((user or {}).get("has_vehicle", False)),
    }


@router.get("/mine")
async def my_alerts(payload: dict = Depends(require_role("reporter"))):
    db = get_db()
    cursor = (
        db.alerts.find({"reporter_id": ObjectId(payload["sub"])}, _LIST_PROJECTION)
        .sort("created_at", -1)
    )
    return [_serialize(doc, include_photos=False) async for doc in cursor]


@router.get("/nearby")
async def get_nearby(request: Request, lat: float, lng: float, km: float = 5.0):
    db = get_db()
    volunteer = await _volunteer_context_from_request(request, db)
    # Opportunistic cleanups on each list read — no cron needed.
    await _auto_resolve_stale(db)
    bumped = await _auto_escalate_unaccepted(db)
    # Re-broadcast escalated alerts so volunteers see the new urgency.
    for doc in bumped:
        try:
            await manager.broadcast_nearby(_serialize(doc, include_photos=False))
        except Exception:  # noqa: BLE001
            pass
    query_radius_km = max(km, SKILL_RADIUS_KM) if volunteer else km
    cursor = db.alerts.find(
        {
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": int(query_radius_km * 1000),
                }
            },
            "status": {"$ne": "resolved"},
            # Hide heavily-flagged alerts from public reads
            "flags": {"$lt": FLAG_HIDE_THRESHOLD},
        },
        _LIST_PROJECTION,
    ).limit(100)

    if not volunteer:
        return [_serialize(doc, include_photos=False) async for doc in cursor]

    preferred_skills = set(volunteer["skills"])
    out = []
    async for doc in cursor:
        item = _serialize(doc, include_photos=False)
        a_lng, a_lat = item["location"]["coordinates"]
        distance_km = _haversine_m(lat, lng, a_lat, a_lng) / 1000
        category_skills = set(CATEGORY_PREFERRED_SKILLS.get(item.get("category", "other"), []))
        skill_match = bool(preferred_skills.intersection(category_skills))
        effective_radius = SKILL_RADIUS_KM if skill_match else max(km, DEFAULT_RADIUS_KM)
        if distance_km > effective_radius:
            continue
        item["is_skill_match"] = skill_match
        item["your_distance_km"] = round(distance_km, 2)
        item["your_has_vehicle"] = volunteer["has_vehicle"]
        out.append(item)
    return out


@router.get("/heatmap")
async def heatmap(lat: float, lng: float, km: float = 25.0, hours: int = 72):
    """Lightweight heatmap feed: list of [lat, lng, weight] tuples for active
    alerts in the window. Used by the map dashboard to render a density
    overlay. Weight is a 0..1 normalisation of urgency + verification."""
    db = get_db()
    # Clamp once and report the clamped value back — echoing the caller's raw
    # `hours` would tell a client asking for 999 h that it got a 999 h window
    # when the query actually covered 168.
    hours = max(1, min(hours, 168))
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    cursor = db.alerts.find(
        {
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": int(max(1, min(km, 200)) * 1000),
                }
            },
            "created_at": {"$gte": since},
            "flags": {"$lt": FLAG_HIDE_THRESHOLD},
        },
        {"location": 1, "urgency": 1, "verified_score": 1, "status": 1},
    ).limit(500)

    urg_weight = {"CRITICAL": 1.0, "HIGH": 0.75, "MEDIUM": 0.5, "LOW": 0.25}
    out = []
    async for doc in cursor:
        coords = doc.get("location", {}).get("coordinates") or []
        if len(coords) != 2:
            continue
        lng_, lat_ = coords
        u = urg_weight.get(doc.get("urgency", "MEDIUM"), 0.5)
        v = min(1.0, (doc.get("verified_score") or 0) / 100.0)
        status_mult = 0.6 if doc.get("status") == "resolved" else 1.0
        weight = round(status_mult * (0.7 * u + 0.3 * v), 3)
        out.append([lat_, lng_, weight])
    return {"points": out, "window_hours": hours}


@router.post("/", status_code=201)
async def create_alert(
    alert: AlertCreate,
    payload: dict = Depends(require_role("reporter")),
):
    db = get_db()
    lng, lat = alert.location.coordinates[0], alert.location.coordinates[1]
    reporter_id = payload["sub"]

    # 1. AI multi-aspect triage (local HF with heuristic fallback)
    t = ai_triage(alert.description)

    # 2. Only the signal we can compute from our own database. Address and
    #    weather are third-party HTTP calls and used to be awaited here,
    #    putting 500-1500 ms of somebody else's latency between "send" and
    #    the alert existing. They now run after the insert — see
    #    services/enrich.py — and the card fills in over the WebSocket.
    corroborating = await find_corroborating_alerts(
        db, alert.category.value, [lng, lat]
    )

    address = None
    weather = None
    weather_match = False
    # Keep only corroborating alerts whose text is semantically close —
    # avoids same-category-same-area-but-different-incident false positives.
    corroborating = filter_corroborating(alert.description, corroborating)
    corroborating_ids = [doc["_id"] for doc in corroborating]
    # Photos are optional; when supplied we validate each one and let the
    # visual evidence bump the overall verified_score.
    photo_analysis = analyze_photos(alert.photos)
    verified_score = compute_verified_score(
        witnesses=1,
        corroborating_alerts=len(corroborating_ids),
        weather_match=weather_match,
    )
    verified_score = min(100, verified_score + photo_analysis["photo_evidence_score"])
    headline = generate_headline(alert.description)

    doc = {
        "reporter_id": ObjectId(reporter_id),
        "category": alert.category.value,
        "description": alert.description,
        "headline": headline,
        "urgency": t.urgency,
        "urgency_reason": t.urgency_reason,
        "urgency_confidence": t.urgency_confidence,
        "vulnerability": t.vulnerability,
        "time_sensitivity": t.time_sensitivity,
        "language": t.language,
        "triggers": t.triggers,
        "priority_score": t.priority_score,
        "location": alert.location.model_dump(),
        "status": "open",
        "accepted_by": None,
        "created_at": datetime.now(timezone.utc),
        "resolved_at": None,
        "address": address,
        "weather": weather,
        "weather_match": weather_match,
        "witnesses": 1,
        "witnessed_by": [reporter_id],
        "corroborating_ids": [str(x) for x in corroborating_ids],
        "verified_score": verified_score,
        "photos": alert.photos,
        "photo_count": len(alert.photos),
        "photo_checks": photo_analysis["photo_checks"],
        "photo_evidence_score": photo_analysis["photo_evidence_score"],
        "photo_confidence": photo_analysis["photo_confidence"],
        "photo_findings": photo_analysis["photo_findings"],
        "eta_minutes": None,
        "eta_set_at": None,
        "flags": 0,
        "flagged_by": [],
    }
    result = await db.alerts.insert_one(doc)
    doc["_id"] = result.inserted_id

    # 3. Boost corroborating alerts — they just got independently confirmed
    if corroborating_ids:
        await db.alerts.update_many(
            {"_id": {"$in": corroborating_ids}},
            {"$inc": {"verified_score": 15}},
        )

    # Broadcast the lightweight version (no photos) to volunteers — keeps
    # the WebSocket frame small. Clients can pull photos on click.
    broadcast_doc = {k: v for k, v in doc.items() if k not in ("photos", "photo_checks", "flagged_by", "witnessed_by")}
    broadcast_doc["_id"] = doc["_id"]
    serialized_light = _serialize(broadcast_doc, include_photos=False)
    await manager.broadcast_nearby(serialized_light)

    # Fan out to any external automation (n8n / Zapier / etc.). Fire-and-forget.
    # Address + weather run after the alert is live. `create_task` not
    # `await`: the reporter's response must not wait on a third-party
    # lookup, and the enricher re-broadcasts when it lands so open feeds
    # update without a refresh.
    task = asyncio.create_task(
        enrich_alert(
            db,
            doc["_id"],
            lat,
            lng,
            alert.category.value,
            witnesses=doc["witnesses"],
            corroborating_count=len(corroborating_ids),
            photo_evidence_score=photo_analysis["photo_evidence_score"],
        )
    )
    # asyncio holds only a weak reference to a task, so without this a
    # running enrichment can be collected partway through and vanish.
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    fire_alert_created(serialized_light)

    # Return the full doc with photos so the reporter can see what they posted
    return _serialize(doc, include_photos=True)


def _client_ip(request: Request) -> str:
    """Best-effort client IP, honouring a single proxy hop. We trust the
    first X-Forwarded-For entry only when running behind Render/nginx —
    on bare uvicorn the header isn't set."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/anonymous", status_code=201)
async def create_anonymous_alert(alert: AlertCreate, request: Request):
    """Public, unauthenticated alert creation for sensitive cases (domestic
    abuse, missing persons where the reporter can't safely identify
    themselves, bystander reports).

    Rate-limited per IP to keep griefing slow. The reporter_id is set to
    a sentinel string and the alert is flagged `is_anonymous=True` so the
    UI can render a "via anonymous tip" badge — volunteers should know
    they can't reach back out for clarification.
    """
    ip = _client_ip(request)
    if not anonymous_alert_limiter.allow(ip):
        raise HTTPException(
            429, "Too many anonymous reports from this network — try again later"
        )

    db = get_db()
    lng, lat = alert.location.coordinates[0], alert.location.coordinates[1]
    t = ai_triage(alert.description)
    # Deferred exactly as in create_alert: an anonymous report is often the
    # most urgent kind — nobody can be called back for details — so it is the
    # last place to spend a reporter's time on a street name.
    corroborating = await find_corroborating_alerts(
        db, alert.category.value, [lng, lat]
    )
    address = None
    weather = None
    weather_match = supports_category(alert.category.value, weather)
    corroborating = filter_corroborating(alert.description, corroborating)
    corroborating_ids = [c["_id"] for c in corroborating]
    photo_analysis = analyze_photos(alert.photos)
    verified_score = compute_verified_score(
        witnesses=1,
        corroborating_alerts=len(corroborating_ids),
        weather_match=weather_match,
    )
    # Anonymous reports get a small trust penalty — no reputation, no
    # contact-back path. They're real but should sort below identified ones.
    verified_score = max(0, min(100, verified_score + photo_analysis["photo_evidence_score"] - 10))

    doc = {
        # ObjectId() generates a fresh sentinel; the alert isn't tied to any
        # real user, but reporter_id stays an ObjectId so all the existing
        # serialisation paths work without special-casing strings.
        "reporter_id": ObjectId(),
        "is_anonymous": True,
        "anonymous_ip_hash": str(hash(ip)),  # crude, just for abuse forensics
        "category": alert.category.value,
        "description": alert.description,
        "headline": generate_headline(alert.description),
        "urgency": t.urgency,
        "urgency_reason": t.urgency_reason + " · anonymous tip",
        "urgency_confidence": t.urgency_confidence,
        "vulnerability": t.vulnerability,
        "time_sensitivity": t.time_sensitivity,
        "language": t.language,
        "triggers": t.triggers,
        "priority_score": t.priority_score,
        "location": alert.location.model_dump(),
        "status": "open",
        "accepted_by": None,
        "created_at": datetime.now(timezone.utc),
        "resolved_at": None,
        "address": address,
        "weather": weather,
        "weather_match": weather_match,
        "witnesses": 1,
        "witnessed_by": [],
        "corroborating_ids": [str(x) for x in corroborating_ids],
        "verified_score": verified_score,
        "photos": alert.photos,
        "photo_count": len(alert.photos),
        "photo_checks": photo_analysis["photo_checks"],
        "photo_evidence_score": photo_analysis["photo_evidence_score"],
        "photo_confidence": photo_analysis["photo_confidence"],
        "photo_findings": photo_analysis["photo_findings"],
        "eta_minutes": None,
        "eta_set_at": None,
        "flags": 0,
        "flagged_by": [],
    }
    result = await db.alerts.insert_one(doc)
    doc["_id"] = result.inserted_id

    serialized_light = _serialize({**doc}, include_photos=False)
    await manager.broadcast_nearby(serialized_light)
    # Address + weather run after the alert is live. `create_task` not
    # `await`: the reporter's response must not wait on a third-party
    # lookup, and the enricher re-broadcasts when it lands so open feeds
    # update without a refresh.
    task = asyncio.create_task(
        enrich_alert(
            db,
            doc["_id"],
            lat,
            lng,
            alert.category.value,
            witnesses=doc["witnesses"],
            corroborating_count=len(corroborating_ids),
            photo_evidence_score=photo_analysis["photo_evidence_score"],
        )
    )
    # asyncio holds only a weak reference to a task, so without this a
    # running enrichment can be collected partway through and vanish.
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    fire_alert_created(serialized_light)
    return _serialize(doc, include_photos=True)


@router.get("/{alert_id}")
async def get_alert(alert_id: str):
    """Public fetch — used by the share link so anyone can open an alert."""
    db = get_db()
    oid = _oid(alert_id)
    doc = await db.alerts.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Alert not found")
    if (doc.get("flags") or 0) >= FLAG_HIDE_THRESHOLD:
        raise HTTPException(404, "Alert not found")
    return _serialize(doc, include_photos=True)


@router.get("/{alert_id}/photos")
async def get_photos(alert_id: str):
    """Lazy-loaded photo payload — kept out of list endpoints for payload
    size. Returned as a plain list of data URLs."""
    db = get_db()
    oid = _oid(alert_id)
    doc = await db.alerts.find_one({"_id": oid}, {"photos": 1, "flags": 1})
    if not doc:
        raise HTTPException(404, "Alert not found")
    if (doc.get("flags") or 0) >= FLAG_HIDE_THRESHOLD:
        raise HTTPException(404, "Alert not found")
    return {"photos": doc.get("photos") or []}


@router.get("/{alert_id}/responder")
async def get_responder_position(
    alert_id: str,
    payload: dict = Depends(get_current_user),
):
    """Live-ish position of the volunteer who accepted the alert.

    Privacy:
      - Only the reporter or the accepting volunteer can read this.
      - We expose coordinates only while `status == "accepted"`. Once the
        alert is resolved the volunteer's coords go cold immediately —
        you can't trail them around the city after the fact.
      - We prefer the WebSocket's in-memory live coords (refreshed as the
        volunteer moves) and only fall back to the user's stored "home
        location" if they're offline. The `live` flag tells the client
        which one it got.
    """
    db = get_db()
    oid = _oid(alert_id)
    alert = await db.alerts.find_one(
        {"_id": oid},
        {"reporter_id": 1, "accepted_by": 1, "status": 1, "eta_minutes": 1, "eta_set_at": 1},
    )
    if not alert:
        raise HTTPException(404, "Alert not found")

    accepted_by = alert.get("accepted_by")
    if alert.get("status") != "accepted" or not accepted_by:
        return {
            "responder_id": None,
            "coordinates": None,
            "live": False,
            "eta_minutes": alert.get("eta_minutes"),
            "eta_set_at": alert.get("eta_set_at"),
            "status": alert.get("status"),
        }

    user_id = payload["sub"]
    if user_id != str(alert["reporter_id"]) and user_id != str(accepted_by):
        # Random users don't get to track random volunteers
        raise HTTPException(403, "Only the reporter or accepting volunteer can read this")

    coords = manager.coords_for(str(accepted_by))
    live = coords is not None

    # One lookup covers both needs: the responder's display name always, and
    # their saved home location only when the live socket has nothing.
    user = await db.users.find_one({"_id": accepted_by}, {"location": 1, "name": 1})
    if not live and user and isinstance(user.get("location"), dict):
        # Better than nothing, but stays marked stale so the UI doesn't
        # render a "live" dot over a location that may be hours old.
        coords = user["location"].get("coordinates") or None

    return {
        "responder_id": str(accepted_by),
        "responder_name": (user or {}).get("name") or "Volunteer",
        "coordinates": coords,
        "live": live,
        "eta_minutes": alert.get("eta_minutes"),
        "eta_set_at": alert.get("eta_set_at"),
        "status": alert.get("status"),
    }


@router.get("/{alert_id}/updates")
async def list_updates(
    alert_id: str,
    payload: dict = Depends(get_current_user),
):
    """Chronological list of situational updates posted by reporters / volunteers / witnesses."""
    db = get_db()
    oid = _oid(alert_id)
    if not await db.alerts.find_one({"_id": oid}, {"_id": 1}):
        raise HTTPException(404, "Alert not found")
    cursor = db.alert_updates.find({"alert_id": oid}).sort(
        "created_at", 1
    )
    out = []
    async for doc in cursor:
        out.append(
            {
                "id": str(doc["_id"]),
                "author_name": doc.get("author_name") or "Anonymous",
                "author_role": doc.get("author_role"),
                "body": doc["body"],
                "created_at": doc["created_at"],
            }
        )
    return out


@router.post(
    "/{alert_id}/updates",
    status_code=201,
    dependencies=[Depends(limit_write)],
)
async def add_update(
    alert_id: str,
    body: AlertUpdateCreate,
    payload: dict = Depends(get_current_user),
):
    """Post a short situational update. Min 3, max 500 chars. Any authenticated user can post."""
    db = get_db()
    text = body.body

    oid = _oid(alert_id)
    alert = await db.alerts.find_one({"_id": oid}, {"_id": 1})
    if not alert:
        raise HTTPException(404, "Alert not found")

    user = await db.users.find_one(
        {"_id": ObjectId(payload["sub"])}, {"name": 1, "role": 1}
    )
    doc = {
        "alert_id": oid,
        "author_id": ObjectId(payload["sub"]),
        "author_name": user.get("name") if user else None,
        "author_role": user.get("role") if user else payload.get("role"),
        "body": text,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.alert_updates.insert_one(doc)
    return {
        "id": str(result.inserted_id),
        "author_name": doc["author_name"] or "Anonymous",
        "author_role": doc["author_role"],
        "body": doc["body"],
        "created_at": doc["created_at"],
    }


@router.post(
    "/{alert_id}/witness",
    status_code=200,
    dependencies=[Depends(limit_write)],
)
async def witness_alert(
    alert_id: str,
    payload: dict = Depends(get_current_user),
):
    """Any authenticated user within WITNESS_RADIUS_M can confirm they
    also see the incident. Idempotent — second call by the same user is a
    no-op. Requires a small proof-of-locality check: the user's stored
    home location must be within the radius of the alert."""
    db = get_db()
    user_id = payload["sub"]
    oid = _oid(alert_id)

    alert = await db.alerts.find_one({"_id": oid})
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert["status"] == "resolved":
        raise HTTPException(409, "Alert already resolved")
    if str(alert["reporter_id"]) == user_id:
        raise HTTPException(400, "You cannot witness your own alert")

    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(404, "User not found")

    # A user who never shared a location can't prove locality. Returning 400
    # here (rather than letting the KeyError below become a 500) also tells
    # the client exactly what to do about it.
    user_coords = (user.get("location") or {}).get("coordinates")
    if not (isinstance(user_coords, list) and len(user_coords) == 2):
        raise HTTPException(
            400,
            "Set your location in your profile before confirming an incident",
        )

    a_lng, a_lat = alert["location"]["coordinates"]
    u_lng, u_lat = user_coords
    if _haversine_m(a_lat, a_lng, u_lat, u_lng) > WITNESS_RADIUS_M:
        raise HTTPException(
            403,
            f"Too far to witness — must be within {WITNESS_RADIUS_M / 1000:.1f} km",
        )

    updated = await bump_witness(db, oid, user_id)
    if not updated:
        return _serialize(alert, include_photos=False)

    new_score = compute_verified_score(
        witnesses=updated["witnesses"],
        corroborating_alerts=len(updated.get("corroborating_ids", [])),
        weather_match=updated.get("weather_match", False),
    )
    # Re-add the photo bump which compute_verified_score doesn't know about
    new_score = min(100, new_score + (updated.get("photo_evidence_score") or 0))
    updated = await db.alerts.find_one_and_update(
        {"_id": oid},
        {"$set": {"verified_score": new_score}},
        return_document=True,
        projection=_LIST_PROJECTION,
    )
    serialized = _serialize(updated, include_photos=False)
    await manager.broadcast_nearby(serialized)
    return serialized


@router.post(
    "/{alert_id}/flag",
    status_code=200,
    dependencies=[Depends(limit_write)],
)
async def flag_alert(
    alert_id: str,
    payload: dict = Depends(get_current_user),
):
    """Community moderation: any authenticated user can flag an alert as
    spam/fake. Idempotent per user."""
    db = get_db()
    user_id = payload["sub"]
    oid = _oid(alert_id)

    alert = await db.alerts.find_one({"_id": oid}, {"reporter_id": 1, "flagged_by": 1, "flags": 1})
    if not alert:
        raise HTTPException(404, "Alert not found")
    if str(alert["reporter_id"]) == user_id:
        raise HTTPException(400, "You cannot flag your own alert")
    if user_id in (alert.get("flagged_by") or []):
        return {"flags": int(alert.get("flags") or 0), "already": True}

    updated = await db.alerts.find_one_and_update(
        {"_id": oid},
        {
            "$addToSet": {"flagged_by": user_id},
            "$inc": {"flags": 1},
        },
        return_document=True,
        projection={"flags": 1},
    )
    if not updated:
        # Raced with a delete — treat as already-gone
        raise HTTPException(404, "Alert not found")
    return {"flags": int(updated.get("flags") or 0), "already": False}


@router.delete("/{alert_id}", status_code=204)
async def cancel_alert(
    alert_id: str,
    payload: dict = Depends(require_role("reporter")),
):
    db = get_db()
    oid = _oid(alert_id)
    result = await db.alerts.delete_one(
        {
            "_id": oid,
            "reporter_id": ObjectId(payload["sub"]),
            "status": "open",
        }
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Alert not found, not yours, or already accepted")
    return None


@router.patch("/{alert_id}/accept")
async def accept_alert(
    alert_id: str,
    payload: dict = Depends(require_role("volunteer")),
):
    db = get_db()
    oid = _oid(alert_id)
    result = await db.alerts.find_one_and_update(
        {"_id": oid, "status": "open"},
        {"$set": {"status": "accepted", "accepted_by": ObjectId(payload["sub"])}},
        return_document=True,
        projection=_LIST_PROJECTION,
    )
    if not result:
        raise HTTPException(404, "Alert not found or already accepted")
    serialized = _serialize(result, include_photos=False)
    await manager.broadcast_nearby(serialized)
    return serialized


@router.patch("/{alert_id}/eta")
async def set_eta(
    alert_id: str,
    body: ETAUpdate,
    payload: dict = Depends(require_role("volunteer")),
):
    """Accepting volunteer publishes an estimated arrival time (minutes)."""
    db = get_db()
    oid = _oid(alert_id)
    result = await db.alerts.find_one_and_update(
        {"_id": oid, "accepted_by": ObjectId(payload["sub"])},
        {
            "$set": {
                "eta_minutes": body.eta_minutes,
                "eta_set_at": datetime.now(timezone.utc),
            }
        },
        return_document=True,
        projection=_LIST_PROJECTION,
    )
    if not result:
        raise HTTPException(404, "Alert not found or not accepted by you")
    serialized = _serialize(result, include_photos=False)
    await manager.broadcast_nearby(serialized)
    return serialized


@router.patch("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    payload: dict = Depends(require_role("volunteer")),
):
    db = get_db()
    oid = _oid(alert_id)
    result = await db.alerts.find_one_and_update(
        {"_id": oid, "accepted_by": ObjectId(payload["sub"])},
        {"$set": {"status": "resolved", "resolved_at": datetime.now(timezone.utc)}},
        return_document=True,
        projection=_LIST_PROJECTION,
    )
    if not result:
        raise HTTPException(404, "Alert not found or not accepted by you")
    return _serialize(result, include_photos=False)
