"""Multi-source verification scoring.

An alert's `verified_score` (0-100) combines independent signals:
  • witnesses      — distinct users who say they also see the incident
  • corroboration  — other alerts of the same category posted nearby recently
  • weather_match  — external weather data consistent with the alert category
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import unicodedata

from bson import ObjectId

from .ai import _char_similarity, concepts_in, similarity

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
    score += min(40, max(0, witnesses) * 8)
    score += min(40, max(0, corroborating_alerts) * 15)
    if weather_match:
        score += 20                          # 20 pts from external weather confirmation
    return min(100, score)


async def find_corroborating_alerts(db, category: str, coordinates: list[float], *, is_drill: bool = False):
    """Return open alerts of the same category within the corroboration
    radius/window — excluding resolved ones. Caller filters out the alert
    being scored if needed."""
    since = datetime.now(timezone.utc) - timedelta(minutes=CORROBORATE_WINDOW_MIN)
    cursor = db.alerts.find(
        {
            "category": category,
            "status": {"$ne": "resolved"},
            # Never corroborate against a report that is already folded into
            # another one. Two things went wrong without this:
            #
            #  1. `pick_canonical` could choose a duplicate as the canonical,
            #     so a new report attached to a card the feed HIDES. Witnesses
            #     then piled up somewhere nobody could see, which defeats the
            #     entire point of folding — concentrating "how many people are
            #     saying this" onto one visible card. A live database had
            #     eight of these chains.
            #  2. verified_score double-counted: a duplicate is not an
            #     independent report of the incident, it IS the incident,
            #     already counted once through the alert it folded into.
            #
            # `None` also matches documents written before the field existed.
            "duplicate_of": None,
            "is_drill": True if is_drill else {"$ne": True},
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


_LOCATION_NUMBER = re.compile(
    r"(?:gate|sector|block|ward|house|plot|गेट|सेक्टर|ब्लॉक|वार्ड|ਮਕਾਨ|ਗੇਟ|ਸੈਕਟਰ|ਬਲਾਕ|ਗਲੀ)\s*[-:#]?\s*(\d+)",
    re.IGNORECASE,
)


def _normalise(text: str) -> str:
    return "".join(str(unicodedata.decimal(c)) if c.isdecimal() else c
                   for c in unicodedata.normalize("NFKC", text or "")).casefold()


def same_incident(a: str, b: str) -> bool:
    """Conservative folding: shared hazard words alone never hide a report.

    A cross-script match needs a shared numbered location. Conflicting
    numbers reject a match even when wording is near identical. Unnumbered
    cross-script reports remain separate, rather than guessing a location.
    This is a retrieval rule, not an AI authenticity judgement.
    """
    a, b = _normalise(a), _normalise(b)
    if not a.strip() or not b.strip():
        return False
    numbers_a, numbers_b = set(re.findall(r"\d+", a)), set(re.findall(r"\d+", b))
    if numbers_a and numbers_b and numbers_a != numbers_b:
        return False
    if _char_similarity(a, b) >= 0.8:
        return True
    locations_a = set(_LOCATION_NUMBER.findall(a))
    locations_b = set(_LOCATION_NUMBER.findall(b))
    return bool(locations_a & locations_b and concepts_in(a) & concepts_in(b)
                and similarity(a, b) >= CORROBORATE_SIMILARITY_MIN)


def filter_corroborating(description: str, candidates: list[dict], *, reporter_id: str | None = None) -> list[dict]:
    """At most one report per identified author; anonymous tips add no proof."""
    kept, authors = [], set()
    for candidate in candidates:
        author = str(candidate["reporter_id"]) if candidate.get("reporter_id") else None
        if candidate.get("is_anonymous") or (author and (author == reporter_id or author in authors)):
            continue
        if same_incident(description, candidate.get("description", "")):
            kept.append(candidate)
            if author:
                authors.add(author)
    return kept


def score_for_alert(doc: dict) -> int:
    """Rebuild a bounded score without undoing anonymity or vision penalties."""
    score = compute_verified_score(
        int(doc.get("witnesses") or 0), len(doc.get("corroborating_ids") or []),
        bool(doc.get("weather_match")),
    ) + max(0, min(30, int(doc.get("photo_evidence_score") or 0)))
    # Cap bonuses BEFORE deductions; otherwise a saturated score erases a
    # contradiction penalty as soon as another witness arrives.
    score = min(100, score)
    if doc.get("is_anonymous"):
        score -= 5 if doc.get("via") == "whatsapp" else 10
    if doc.get("photo_verdict") == "no":
        from .vision import CONTRADICTION_PENALTY
        score -= CONTRADICTION_PENALTY
    return max(0, min(100, score))


def score_ceiling(doc: dict) -> int:
    """Upper bound that enrichment must respect even at saturation."""
    return score_for_alert({**doc, "witnesses": 99, "corroborating_ids": [1] * 99,
                            "weather_match": True, "photo_evidence_score": 30})


async def refresh_score(db, doc: dict) -> dict:
    """Compare-and-set: a stale witness must not overwrite new AI evidence.

    Contended writes reread at most three times; the last live document is
    returned if contention continues, never overwritten with an old snapshot.
    """
    fields = ("witnesses", "corroborating_ids", "weather_match", "photo_evidence_score",
              "photo_verdict", "is_anonymous", "via", "verified_score")
    for _ in range(3):
        updated = await db.alerts.find_one_and_update(
            {"_id": doc["_id"], **{field: doc.get(field) for field in fields}},
            {"$set": {"verified_score": score_for_alert(doc)}}, return_document=True,
        )
        if updated:
            return updated
        latest = await db.alerts.find_one({"_id": doc["_id"]})
        if not latest:
            return doc
        doc = latest
    return doc


def evidence_summary(doc: dict) -> dict:
    """Public explanation; no witness IDs, no percentage of truth."""
    return {
        "independent_witnesses": max(0, int(doc.get("witnesses") or 1) - 1),
        "similar_reports": len(doc.get("corroborating_ids") or []),
        "weather_context": bool(doc.get("weather_match")),
        "attachment_quality_score": max(0, min(30, int(doc.get("photo_evidence_score") or 0))),
        "photo_review": doc.get("photo_verdict") or "not_checked",
        "fact_checked": False,
    }


async def bump_witness(db, alert_id: ObjectId, user_id: str) -> dict | None:
    """Idempotently add a witness — one user can only confirm once."""
    return await db.alerts.find_one_and_update(
        {"_id": alert_id, "witnessed_by": {"$ne": user_id},
         "status": {"$ne": "resolved"}, "reporter_id": {"$ne": ObjectId(user_id)}},
        {
            "$addToSet": {"witnessed_by": user_id},
            "$inc": {"witnesses": 1},
        },
        return_document=True,
    )


def pick_canonical(corroborating: list[dict]) -> dict | None:
    """Of several reports of one incident, the one the others fold into.

    The OLDEST wins, which is the only choice that is stable. Picking the
    newest, or the highest-scoring, means the canonical alert changes as more
    people report — so a volunteer who accepted a card watches it turn into a
    different card, and any link already shared points at a report that is now
    a duplicate of something else.

    The first person to report also tends to be the one standing closest to
    it, and theirs is the alert that has already been broadcast to volunteers.

    Returns None when there is nothing to fold into, which is the common case.
    """
    if not corroborating:
        return None
    # A document written before created_at existed sorts last rather than
    # crashing the comparison — it is a bad canonical anyway.
    far_future = datetime.max.replace(tzinfo=timezone.utc)

    def _created(doc: dict):
        value = doc.get("created_at")
        return value if isinstance(value, datetime) else far_future

    return min(corroborating, key=_created)
