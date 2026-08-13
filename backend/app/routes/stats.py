"""Public aggregate stats used by the landing page."""

from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter

from ..db.client import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/")
async def stats():
    db = get_db()
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    active_filter = {"status": {"$ne": "resolved"}}
    last_24h_filter = {"created_at": {"$gte": since_24h}}

    active_count = await db.alerts.count_documents(active_filter)
    critical_count = await db.alerts.count_documents(
        {**active_filter, "urgency": "CRITICAL"}
    )
    last_24h_count = await db.alerts.count_documents(last_24h_filter)
    resolved_24h = await db.alerts.count_documents(
        {**last_24h_filter, "status": "resolved"}
    )

    # top category in the last 24 hours
    top_category = None
    try:
        # `await` is required: PyMongo's async driver returns a coroutine that
        # resolves to the cursor, where Motor returned the cursor directly.
        # Without it the coroutine was never awaited, `async for` iterated
        # nothing, and top_category silently stayed None on every request —
        # a wrong answer rather than an error, and the broad `except` below
        # meant nothing ever surfaced. It showed up only as a RuntimeWarning
        # buried in the container log.
        cursor = await db.alerts.aggregate(
            [
                {"$match": last_24h_filter},
                {"$group": {"_id": "$category", "n": {"$sum": 1}}},
                {"$sort": {"n": -1}},
                {"$limit": 1},
            ]
        )
        async for row in cursor:
            top_category = {"category": row["_id"], "count": row["n"]}
    except Exception:  # noqa: BLE001 — aggregate failures shouldn't break the landing page
        top_category = None

    volunteers_online = None
    try:
        from ..services.websocket import manager
        volunteers_online = manager.count()
    except Exception:  # noqa: BLE001
        volunteers_online = None

    return {
        "active_alerts": active_count,
        "critical_open": critical_count,
        "last_24h": last_24h_count,
        "resolved_24h": resolved_24h,
        "top_category": top_category,
        "volunteers_online": volunteers_online,
        "as_of": now.isoformat(),
    }


def _trust_label(score: float) -> str:
    """Map a 0..1 trust score into a human label so the UI doesn't have to."""
    if score >= 0.85:
        return "trusted"
    if score >= 0.6:
        return "reliable"
    if score >= 0.3:
        return "new"
    return "unproven"


def _compute_trust(accepted: int, resolved: int) -> dict:
    """Trust score = resolved/accepted, with a confidence floor that
    penalises volunteers who have only handled 1–2 alerts (small sample
    size shouldn't earn "trusted" status). Returns the score, label, and
    raw counts so the UI can render a tooltip."""
    if accepted <= 0:
        return {"score": 0.0, "label": "new", "accepted": 0, "resolved": 0}
    raw_ratio = resolved / accepted
    # Bayesian-ish smoothing: pretend every volunteer also has 2 "neutral"
    # samples at 60% — keeps a 1-of-1 success from auto-jumping to 1.0.
    smoothed = (resolved + 2 * 0.6) / (accepted + 2)
    score = round(min(1.0, max(0.0, min(raw_ratio, smoothed))), 2)
    return {
        "score": score,
        "label": _trust_label(score),
        "accepted": accepted,
        "resolved": resolved,
    }


@router.get("/leaderboard")
async def leaderboard(limit: int = 5, days: int = 30):
    """Top volunteers by alerts resolved in the last `days` window.
    Each row also carries a trust score (resolved ÷ accepted with sample-
    size smoothing) so the UI can show "trusted / reliable / new / unproven"."""
    db = get_db()
    # Clamp once, then report the clamped values back so the response never
    # claims a wider window (or longer list) than was actually queried.
    days = max(1, min(days, 365))
    limit = max(1, min(limit, 50))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"accepted_by": {"$ne": None}, "created_at": {"$gte": since}}},
        {
            "$group": {
                "_id": "$accepted_by",
                "accepted": {"$sum": 1},
                "resolved": {
                    "$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}
                },
            }
        },
        {"$sort": {"resolved": -1, "accepted": -1}},
        {"$limit": limit},
    ]
    top = []
    try:
        # Same await as above — the leaderboard was silently always empty.
        cursor = await db.alerts.aggregate(pipeline)
        async for row in cursor:
            top.append(row)
    except Exception:  # noqa: BLE001
        return {"window_days": days, "top": []}

    if not top:
        return {"window_days": days, "top": []}

    user_ids = [row["_id"] for row in top if isinstance(row["_id"], ObjectId)]
    users = {}
    try:
        async for u in db.users.find({"_id": {"$in": user_ids}}, {"name": 1}):
            users[u["_id"]] = u.get("name", "Anonymous")
    except Exception:  # noqa: BLE001
        pass

    return {
        "window_days": days,
        "top": [
            {
                "name": users.get(row["_id"], "Volunteer"),
                "resolved": row["resolved"],
                "trust": _compute_trust(row["accepted"], row["resolved"]),
            }
            for row in top
        ],
    }
