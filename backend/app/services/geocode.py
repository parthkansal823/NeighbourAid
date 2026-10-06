"""Reverse geocoding via OpenStreetMap Nominatim (free, no key)."""

from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

_NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
_UA = "NeighbourAid/1.0 (contact: parth@neighbouraid.local)"

# Shortest fragment for which "one contains the other" is evidence of
# repetition rather than coincidence. Below this, common letter sequences
# collide constantly.
_MIN_DEDUPE_LEN = 4


def _compact_address(data: dict) -> str | None:
    """Build a label a volunteer can actually navigate to.

    Nominatim's own `display_name` is too long and noisy for a card, but the
    previous compact form went too far the other way: it kept only
    road/suburb/city/state and produced "Kharar, Sahibzada Ajit Singh Nagar"
    — a town and a district. That tells a volunteer which side of the city to
    drive to and nothing else.

    Ordered narrowest-first, because that is the order someone reads an
    address when they are already nearby and looking for the exact spot:

      landmark, house number + road, neighbourhood, town, postcode

    `name` is the biggest win and was being dropped entirely. When the point
    lands on a mapped feature it holds things like "Civil Hospital" or
    "Gurudwara Sahib" — a landmark beats any street name in Indian cities,
    where directions are usually given relative to one.

    The postcode earns its place for the opposite reason: when Nominatim has
    nothing fine-grained (rural, or an unmapped street), it is often the only
    field that narrows the area at all.
    """
    address = data.get("address") or {}

    landmark = data.get("name") or address.get("amenity") or address.get("building")
    road = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or address.get("cycleway")
        or address.get("path")
    )
    house = address.get("house_number")
    street = f"{house} {road}".strip() if house and road else road

    parts = [
        landmark,
        street,
        address.get("suburb")
        or address.get("neighbourhood")
        or address.get("quarter")
        or address.get("hamlet"),
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality"),
        address.get("state_district") or address.get("county") or address.get("state"),
        address.get("postcode"),
    ]

    # Nominatim repeats the same string across fields constantly — a village
    # named the same as its tehsil yields "Kharar, Kharar Tahsil, Kharar".
    # Dedupe case-insensitively but keep the first spelling.
    seen: set[str] = set()
    cleaned: list[str] = []
    for part in parts:
        if not isinstance(part, str):
            continue
        part = part.strip()
        key = part.casefold()
        if not part or key in seen:
            continue
        # Skip a part wholly contained in one already used ("Kharar" after
        # "Kharar Tahsil"), which reads as stuttering rather than detail.
        #
        # Length-guarded, because bare substring matching on short strings
        # silently eats real components: a landmark called "Ar" would swallow
        # "Kharar", and a house number "1" would swallow every part
        # containing a 1. Only compare fragments long enough that overlap
        # means genuine repetition rather than coincidence.
        if len(key) >= _MIN_DEDUPE_LEN and any(
            len(prev) >= _MIN_DEDUPE_LEN and (key in prev or prev in key)
            for prev in seen
        ):
            continue
        seen.add(key)
        cleaned.append(part)

    compact = ", ".join(cleaned)
    if compact:
        return compact
    return data.get("display_name")


async def reverse_geocode(lat: float, lng: float, timeout: float = 2.0) -> str | None:
    """Return a human-readable address or None. Never raises — crisis
    alerts must not fail because a geocoder is slow."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                _NOMINATIM,
                params={
                    "lat": lat,
                    "lon": lng,
                    "format": "json",
                    # 18 = building/street level. 16 stops at neighbourhood,
                    # which is why road names and landmarks were missing from
                    # results that Nominatim actually had data for.
                    "zoom": 18,
                    "addressdetails": 1,
                    "accept-language": "en-IN,en",
                },
                headers={"User-Agent": _UA},
            )
            if r.status_code == 200:
                return _compact_address(r.json())
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        log.info("reverse_geocode skipped: %s", exc)
    return None
