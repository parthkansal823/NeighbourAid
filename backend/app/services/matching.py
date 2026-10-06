"""Connecting an alert to the resources that would actually help it.

Both halves already existed and never met. Someone pins an oxygen cylinder
eight hundred metres from a flat; someone else reports that a person in
that flat cannot breathe; the app shows the alert on one screen and the
cylinder on another and leaves the join to whoever happens to have both
open. That is not a data problem — the data is there — it is a missing
line between two tables.

The mapping is deliberately narrow. A `shelter` is not useful for a gas
leak the way it is for a flood, and listing every resource for every alert
would turn a useful three-line panel into a directory nobody reads in an
emergency. Where a category genuinely has no matching resource kind, it
gets an empty tuple and no panel renders — better than padding it out with
something plausible.

Ordering is by distance, and the radius is tighter than the dispatch
radius: a volunteer can be paged from twelve kilometres away because they
will drive, but a shelter twelve kilometres from a flood is not a shelter
anyone is walking to.
"""

from __future__ import annotations

from typing import Any

__all__ = ["CATEGORY_RESOURCE_KINDS", "MATCH_RADIUS_M", "kinds_for", "nearby_resources"]

# How far a resource is still worth surfacing. Three kilometres: far enough
# to cross a neighbourhood, close enough that it is somewhere you could
# actually send someone on foot in the next hour.
MATCH_RADIUS_M = 3000

# At most this many, because the panel sits on an alert card that already
# has a lot on it, and a fourth entry is one nobody reads.
MATCH_LIMIT = 3

# Alert category to the resource kinds that help with it. Anything absent
# is deliberate, not an oversight — see the module docstring.
CATEGORY_RESOURCE_KINDS: dict[str, tuple[str, ...]] = {
    # Blood and oxygen are the two that actually change an outcome in the
    # first hour; a medical camp is where you take someone who can be moved.
    "medical": ("oxygen", "blood", "medical_camp"),
    # Somewhere to put people, and water because a fire means the water is
    # often off afterwards.
    "fire": ("shelter", "medical_camp", "water"),
    "flood": ("shelter", "food", "water", "medical_camp"),
    "structure": ("shelter", "medical_camp"),
    # An accident needs blood and a camp; a shelter is not the problem.
    "accident": ("blood", "medical_camp", "oxygen"),
    # Evacuate first, treat second. No water here — a gas leak is not
    # something you put out with a bucket.
    "gas": ("shelter", "medical_camp"),
    "water": ("water",),
    # Deliberately empty: nothing in the resource list helps find a missing
    # person, stop violence, catch an animal, or restore power. Padding
    # these out with a plausible-looking shelter would be noise on a card
    # someone is reading in a hurry.
    "missing": (),
    "violence": (),
    "animal": (),
    "power": (),
    "other": (),
}


def kinds_for(category: str) -> tuple[str, ...]:
    return CATEGORY_RESOURCE_KINDS.get(category, ())


async def nearby_resources(db, category: str, coordinates: list[float]) -> list[dict[str, Any]]:
    """Resources that would help this alert, nearest first.

    Returns [] rather than raising for a category with no mapping, so the
    caller can always render the result without a branch. Never raises at
    all: this decorates an alert, and a decoration must not be able to take
    the alert down with it.
    """
    kinds = kinds_for(category)
    if not kinds:
        return []

    lng, lat = coordinates[0], coordinates[1]
    try:
        cursor = db.resources.find(
            {
                "kind": {"$in": list(kinds)},
                "location": {
                    "$nearSphere": {
                        "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                        "$maxDistance": MATCH_RADIUS_M,
                    }
                },
            },
            # Only what the panel renders. The contact is the point — a
            # shelter you cannot phone is an address, not a resource.
            {"name": 1, "kind": 1, "contact": 1, "location": 1, "capacity": 1},
        ).limit(MATCH_LIMIT)
        found = await cursor.to_list(MATCH_LIMIT)
    except Exception:  # noqa: BLE001 - decoration must never break the alert
        return []

    out = []
    for doc in found:
        out.append(
            {
                "id": str(doc["_id"]),
                "name": doc.get("name") or "",
                "kind": doc.get("kind") or "other",
                "contact": doc.get("contact") or None,
                "capacity": doc.get("capacity"),
                "coordinates": (doc.get("location") or {}).get("coordinates"),
            }
        )
    return out
