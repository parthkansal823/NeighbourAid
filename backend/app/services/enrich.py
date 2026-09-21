"""Post-insert enrichment: address and weather, fetched after the alert posts.

WHY THIS IS NOT INLINE

Alert creation used to `await asyncio.gather(reverse_geocode(...),
current_weather(...), ...)` before inserting. Both are calls to third-party
services over the public internet, and both were on the path between a person
pressing "send" and the alert existing. Measured, Nominatim alone runs
500-1500 ms and its timeout was 2 s — so a reporter in an emergency could
wait two seconds for a *street name* before volunteers were told anything.

That is the wrong trade. The coordinates are what dispatch a volunteer, and
they are in hand the moment the form is submitted. The address is a
convenience for reading the card, and the weather only adjusts a confidence
score. Neither is worth delaying the alert.

So the alert now posts immediately with `address: None` and `weather: None`,
and this runs afterwards. When the data arrives the document is updated and
re-broadcast, so connected volunteers see the card fill in without a refresh.
The client already merges by `id` and only pings on first sight, so the
second frame updates the card silently.

Nothing here raises. An alert that exists with no address is a working alert;
an exception escaping a background task is a log line nobody reads.
"""

from __future__ import annotations

import asyncio
import logging

from bson import ObjectId

from .geocode import reverse_geocode
from .llm import classify as llm_classify, is_enabled as llm_enabled
from .verification import compute_verified_score
from .weather import current_weather, supports_category
from .websocket import manager

log = logging.getLogger(__name__)

# Lower index = more urgent. Used to ensure the LLM can only raise an urgency.
_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

# Generous compared with the 2 s this used to get inline, because nothing is
# waiting on it any more. The reporter has their confirmation and volunteers
# have the alert; this only decides how soon the card gains a street name.
ENRICH_TIMEOUT_SECONDS = 8.0


async def _maybe_upgrade_urgency(db, alert_id: ObjectId, update: dict) -> None:
    """Ask the local LLM, but only where the classifier matched nothing.

    `keyword:default` is the classifier saying so explicitly: no pattern, no
    keyword in any of the eight languages, so MEDIUM is a guess rather than a
    judgement. That is exactly the implied-danger case the model is better at
    (6/7 vs 5/7 measured) and the only place it is worth its seconds.

    Deliberately one-directional: the model may raise an urgency, never lower
    one. Measured alone it scores worse than the classifier overall, largely
    by moving things around confidently; letting it *downgrade* would risk
    burying a real emergency on the strength of an engine we know is the
    weaker of the two at this.
    """
    if not llm_enabled():
        return
    doc = await db.alerts.find_one(
        {"_id": alert_id}, {"description": 1, "urgency": 1, "urgency_reason": 1}
    )
    if not doc or doc.get("urgency_reason") != "keyword:default":
        return

    band = await llm_classify(doc.get("description", ""))
    if band is None or band == doc.get("urgency"):
        return
    if _RANK.get(band, 99) >= _RANK.get(doc.get("urgency"), 99):
        return  # same or less urgent — leave the classifier's answer alone

    update["urgency"] = band
    update["urgency_reason"] = "llm:implied"
    update["urgency_confidence"] = 0.7
    log.info("LLM raised alert %s from %s to %s", alert_id, doc.get("urgency"), band)


async def enrich_alert(
    db,
    alert_id: ObjectId,
    lat: float,
    lng: float,
    category: str,
    witnesses: int,
    corroborating_count: int,
    photo_evidence_score: int,
) -> None:
    """Fetch address + weather, persist them, and re-broadcast the alert.

    Scoring inputs are passed in rather than re-read: they were computed at
    insert time and re-deriving them here would race with witnesses being
    added in the meantime.
    """
    try:
        address, weather = await asyncio.wait_for(
            asyncio.gather(
                reverse_geocode(lat, lng, timeout=ENRICH_TIMEOUT_SECONDS),
                current_weather(lat, lng),
                return_exceptions=False,
            ),
            timeout=ENRICH_TIMEOUT_SECONDS,
        )
    except (TimeoutError, asyncio.TimeoutError):
        log.info("enrichment timed out for alert %s", alert_id)
        return
    except Exception as exc:  # noqa: BLE001 — a background task must not die loudly
        log.info("enrichment failed for alert %s: %s", alert_id, exc)
        return

    weather_match = supports_category(category, weather)
    verified_score = compute_verified_score(
        witnesses=witnesses,
        corroborating_alerts=corroborating_count,
        weather_match=weather_match,
    )
    verified_score = min(100, verified_score + photo_evidence_score)

    update = {
        "address": address,
        "weather": weather,
        "weather_match": weather_match,
        "verified_score": verified_score,
    }

    # Runs here, inside the background task, so inference (1.5-9 s measured)
    # never touches the request path. The re-broadcast below carries any
    # upgrade to connected volunteers without a refresh.
    try:
        await _maybe_upgrade_urgency(db, alert_id, update)
    except Exception as exc:  # noqa: BLE001 — an optional extra must not break enrichment
        log.info("LLM upgrade skipped for alert %s: %s", alert_id, exc)

    try:
        # Only touch alerts still carrying the placeholder. A resolve or a
        # witness confirmation may have landed while we were waiting, and
        # blindly overwriting verified_score would discard it.
        await db.alerts.update_one(
            {"_id": alert_id, "address": None},
            {"$set": update},
        )
        doc = await db.alerts.find_one(
            {"_id": alert_id},
            {"photos": 0, "photo_checks": 0, "flagged_by": 0, "witnessed_by": 0},
        )
    except Exception as exc:  # noqa: BLE001
        log.info("enrichment could not persist for alert %s: %s", alert_id, exc)
        return

    if not doc:
        return

    # Re-broadcast so open feeds fill in without a refresh. Imported lazily to
    # avoid a circular import: routes/alerts imports this module, and the
    # serializer lives there.
    from ..routes.alerts import _serialize  # noqa: PLC0415

    try:
        await manager.broadcast_nearby(_serialize(doc, include_photos=False))
    except Exception as exc:  # noqa: BLE001
        log.info("enrichment broadcast failed for alert %s: %s", alert_id, exc)
