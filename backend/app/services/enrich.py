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
from .llm import (
    classify as llm_classify,
    is_enabled as llm_enabled,
    summarise as llm_summarise,
)
from .verification import compute_verified_score, score_ceiling
from .vision import (
    CONTRADICTION_PENALTY,
    NO,
    is_enabled as vision_enabled,
    review_photos as vision_review,
)
from .weather import current_weather, supports_category
from .websocket import manager

log = logging.getLogger(__name__)

# Lower index = more urgent. Used to ensure the LLM can only raise an urgency.
_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

# Generous compared with the 2 s this used to get inline, because nothing is
# waiting on it any more. The reporter has their confirmation and volunteers
# have the alert; this only decides how soon the card gains a street name.
ENRICH_TIMEOUT_SECONDS = 8.0

# Compare the values used for enrichment before writing anything. Address
# alone is not a version guard: witnesses and user edits can change while it
# is still None. A conflicting batch is discarded, never blindly retried.
_SNAPSHOT_FIELDS = (
    "address", "weather", "weather_match", "verified_score", "witnesses",
    "description", "headline", "headline_source", "urgency", "urgency_reason",
    "urgency_confidence", "photos", "photo_verdict", "photo_findings",
    "category", "location", "status",
    "is_anonymous", "via",
)


async def _maybe_upgrade_urgency(
    db, alert_id: ObjectId, update: dict, *, snapshot: dict | None = None,
) -> None:
    """Ask the local LLM, but only where the classifier matched nothing.

    `keyword:default` is the classifier saying so explicitly: no pattern, no
    keyword in any of the eleven languages, so MEDIUM is a guess rather than a
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
    doc = snapshot if snapshot is not None else await db.alerts.find_one(
        {"_id": alert_id}, {"description": 1, "urgency": 1, "urgency_reason": 1}
    )
    if not doc or doc.get("urgency_reason") != "keyword:default":
        return

    band = await llm_classify(doc.get("description", ""))
    if band not in _RANK or doc.get("urgency") not in _RANK:
        return
    if _RANK.get(band, 99) >= _RANK.get(doc.get("urgency"), 99):
        return  # same or less urgent — leave the classifier's answer alone

    update["urgency"] = band
    update["urgency_reason"] = "llm:implied"
    update["urgency_confidence"] = 0.7
    log.info("LLM raised alert %s from %s to %s", alert_id, doc.get("urgency"), band)


async def _maybe_improve_headline(
    db, alert_id: ObjectId, update: dict, *, snapshot: dict | None = None,
) -> None:
    """Replace the truncated headline with a written one, where it helps.

    `generate_headline` takes the first sentence or cuts at 90 characters.
    That is right for a typed report, and useless for a voice transcript,
    which is what the app encourages in an emergency — the transcript opens
    with the speaker orienting themselves, so the cut keeps the filler and
    loses the incident:

        "hello hello can you hear me yes so there is my neighbour uncle he…"

    A volunteer scanning a feed gets nothing from that line. The model turns
    the same report into "Uncle Fell, Door Locked".

    Only runs where truncation actually happened: a description that already
    fits is its own headline, and a model can only lose detail or add some.
    The result is rejected outright if it names a concept the report did not
    or answers in another script — see llm._is_faithful, which exists because
    a 1B model produced both failures on real input.
    """
    if not llm_enabled():
        return
    doc = snapshot if snapshot is not None else await db.alerts.find_one(
        {"_id": alert_id}, {"description": 1, "headline": 1}
    )
    if not doc:
        return
    description = doc.get("description", "")
    current = doc.get("headline", "")
    # The synchronous headline only loses information when it had to cut.
    if not current.endswith("…"):
        return

    headline = await llm_summarise(description)
    if not headline or headline == current:
        return

    update["headline"] = headline
    update["headline_source"] = "llm"
    log.info("LLM rewrote headline for alert %s", alert_id)


async def _maybe_penalise_photo(db, alert_id: ObjectId, category: str,
                                update: dict, verified_score: int,
                                *, snapshot: dict | None = None) -> int:
    """Take back photo credit when the photo shows something else.

    services/photo.py can only see that an attached file is a real,
    large-enough image, and awards up to 30 points of verified_score for it.
    Nothing checks what the photo is *of*, so a picture of a cat scores
    exactly like a picture of a fire — on the one number volunteers read as
    "several signals agree, this is real".

    The vision model describes the photo and vision.verdict_for decides,
    using the same CONCEPTS map as cross-language corroboration. Only a clear
    contradiction costs anything: a confirmation earns nothing, and a caption
    that recognises nothing is treated as no evidence either way. See
    services/vision.py for why it can only ever subtract.

    Returns the possibly-reduced score; the caller writes it.
    """
    if not vision_enabled():
        return verified_score
    doc = snapshot if snapshot is not None else await db.alerts.find_one(
        {"_id": alert_id}, {"photos": 1, "photo_verdict": 1}
    )
    if (doc or {}).get("photo_verdict") == NO:
        return verified_score  # a retry must not take the same credit back twice
    photos = (doc or {}).get("photos") or []
    if not photos:
        return verified_score

    review = await vision_review(photos, category)
    if review.get("verdict") in {"yes", "unclear"} and review.get("penalty") == 0:
        update["photo_verdict"] = review["verdict"]
        finding = review.get("finding")
        if isinstance(finding, str) and finding:
            update["photo_findings"] = finding
        return verified_score
    penalty = review.get("penalty")
    if (review.get("verdict") != NO or type(penalty) is not int
            or not 0 < penalty <= CONTRADICTION_PENALTY):
        return verified_score
    finding = review.get("finding")
    if not isinstance(finding, str):
        return verified_score

    reduced = max(0, verified_score - penalty)
    update.update(verified_score=reduced, photo_verdict=NO, photo_findings=finding)
    log.info(
        "Vision reduced verified_score for alert %s: %s -> %s",
        alert_id, verified_score, reduced,
    )
    return reduced


async def _optional_lookup(call):
    """Bound each provider separately; one failure cannot cancel its sibling."""
    try:
        return await asyncio.wait_for(call(), timeout=ENRICH_TIMEOUT_SECONDS)
    except Exception:  # includes timeout, not caller cancellation
        log.info("Optional enrichment lookup unavailable")
        return None


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

    Insert-time counts remain arguments for compatibility; prefer the stored
    score so newer witnesses, anonymity adjustments and prior penalties stay
    intact. Snapshot fields are checked atomically on write.
    """
    try:
        snapshot = await db.alerts.find_one(
            {"_id": alert_id}, {field: 1 for field in _SNAPSHOT_FIELDS}
        )
    except Exception:  # noqa: BLE001
        log.info("enrichment could not read alert %s", alert_id)
        return
    if not snapshot or snapshot.get("status") == "resolved":
        return

    # A delayed task must not look up the old point/category after an edit.
    if snapshot.get("category", category) != category:
        return
    if (snapshot.get("location") or {}).get("coordinates", [lng, lat]) != [lng, lat]:
        return

    address, weather = await asyncio.gather(
        _optional_lookup(lambda: reverse_geocode(lat, lng, timeout=ENRICH_TIMEOUT_SECONDS)),
        _optional_lookup(lambda: current_weather(lat, lng)),
    )

    fallback_score = min(100, compute_verified_score(
        witnesses=witnesses,
        corroborating_alerts=corroborating_count,
        weather_match=bool(snapshot.get("weather_match")),
    ) + photo_evidence_score)
    verified_score = snapshot.get("verified_score", fallback_score)
    update = {}

    if not snapshot.get("address") and isinstance(address, str) and address.strip():
        update["address"] = address
    # None means unavailable, not successful negative evidence. Preserve any
    # existing weather/score; AI agents still run independently below.
    if isinstance(weather, dict) and weather:
        try:
            weather_match = supports_category(category, weather)
            previous_bonus = compute_verified_score(
                witnesses=0, corroborating_alerts=0,
                weather_match=bool(snapshot.get("weather_match")),
            )
            new_bonus = compute_verified_score(
                witnesses=0, corroborating_alerts=0, weather_match=weather_match,
            )
            verified_score = max(0, min(score_ceiling(snapshot), verified_score + new_bonus - previous_bonus))
            update.update(weather=weather, weather_match=weather_match)
            if verified_score != snapshot.get("verified_score", fallback_score):
                update["verified_score"] = verified_score
        except Exception:  # noqa: BLE001 — malformed provider output stays optional
            log.info("Weather scoring skipped for alert %s", alert_id)

    # Runs here, inside the background task, so inference (1.5-9 s measured)
    # never touches the request path. The re-broadcast below carries any
    # upgrade to connected volunteers without a refresh.
    try:
        await _maybe_upgrade_urgency(db, alert_id, update, snapshot=snapshot)
    except Exception:  # noqa: BLE001
        log.info("LLM upgrade skipped for alert %s", alert_id)

    try:
        await _maybe_improve_headline(db, alert_id, update, snapshot=snapshot)
    except Exception:  # noqa: BLE001
        log.info("LLM headline skipped for alert %s", alert_id)

    try:
        verified_score = await _maybe_penalise_photo(
            db, alert_id, category, update, verified_score, snapshot=snapshot,
        )
    except Exception:  # noqa: BLE001
        log.info("Vision photo check skipped for alert %s", alert_id)

    if not update:
        return

    try:
        await db.alerts.update_one(
            {"_id": alert_id, **{field: snapshot.get(field) for field in _SNAPSHOT_FIELDS}},
            {"$set": update},
        )
        doc = await db.alerts.find_one(
            {"_id": alert_id},
            {"photos": 0, "photo_checks": 0, "flagged_by": 0, "witnessed_by": 0},
        )
    except Exception:  # noqa: BLE001
        log.info("enrichment could not persist for alert %s", alert_id)
        return

    if not doc:
        return

    # Re-broadcast so open feeds fill in without a refresh. Imported lazily to
    # avoid a circular import: routes/alerts imports this module, and the
    # serializer lives there.
    from ..routes.alerts import _serialize  # noqa: PLC0415

    try:
        await manager.broadcast_nearby(_serialize(doc, include_photos=False))
    except Exception:  # noqa: BLE001
        log.info("enrichment broadcast failed for alert %s", alert_id)
