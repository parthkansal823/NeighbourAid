"""Multi-source verification scoring.

An alert's `verified_score` (0-100) combines independent signals:
  • witnesses      — distinct users who say they also see the incident
  • corroboration  — other alerts of the same category posted nearby recently
  • weather_match  — external weather data consistent with the alert category
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from bson import ObjectId

from .ai import similarity

CORROBORATE_RADIUS_M = 500
CORROBORATE_WINDOW_MIN = 30
WITNESS_RADIUS_M = 2000  # users within 2 km can add a witness vote

# Text-similarity floor for treating a nearby same-category alert as
# corroboration of *this* incident. Same category + same 500 m + same
# 30 min is a strong prior, but not proof: two unrelated medical alerts
# can easily coincide in a dense neighbourhood. Requiring some textual
# overlap is what keeps `verified_score` meaningful.
CORROBORATE_SIMILARITY_MIN = 0.25


def compute_verified_score(
    witnesses: int,
    corroborating_alerts: int,
    weather_match: bool,
) -> int:
    """Composite 0-100 score. Each independent source adds capped weight."""
    score = 0
    score += min(40, witnesses * 8)          # up to 40 pts from community witnesses
    score += min(40, corroborating_alerts * 15)  # up to 40 pts from nearby same-category alerts
    if weather_match:
        score += 20                          # 20 pts from external weather confirmation
    return min(100, score)


async def find_corroborating_alerts(db, category: str, coordinates: list[float]):
    """Return open alerts of the same category within the corroboration
    radius/window — excluding resolved ones. Caller filters out the alert
    being scored if needed."""
    since = datetime.now(timezone.utc) - timedelta(minutes=CORROBORATE_WINDOW_MIN)
    cursor = db.alerts.find(
        {
            "category": category,
            "status": {"$ne": "resolved"},
            "created_at": {"$gte": since},
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": coordinates},
                    "$maxDistance": CORROBORATE_RADIUS_M,
                }
            },
        }
    )
    return [doc async for doc in cursor]


def filter_corroborating(description: str, candidates: list[dict]) -> list[dict]:
    """Narrow raw geo/category candidates down to ones that actually describe
    the same incident.

    `find_corroborating_alerts` matches on category + radius + time window
    only, so it happily returns "child lost at the market" as corroboration
    for "elderly man collapsed". Requiring `CORROBORATE_SIMILARITY_MIN`
    textual overlap is what makes the resulting count trustworthy enough to
    feed into `compute_verified_score`.
    """
    return [
        c
        for c in candidates
        if similarity(description, c.get("description", "")) >= CORROBORATE_SIMILARITY_MIN
    ]


async def bump_witness(db, alert_id: ObjectId, user_id: str) -> dict | None:
    """Idempotently add a witness — one user can only confirm once."""
    return await db.alerts.find_one_and_update(
        {"_id": alert_id, "witnessed_by": {"$ne": user_id}},
        {
            "$addToSet": {"witnessed_by": user_id},
            "$inc": {"witnesses": 1},
        },
        return_document=True,
    )
