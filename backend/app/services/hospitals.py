"""Nearby hospitals and clinics, from OpenStreetMap via Overpass.

WHY THIS EXISTS

On a medical alert the app already offers the numbers to call — 108 for an
ambulance, 102, 112 — but not where to go. Those are different questions. A
volunteer who has reached someone and put them in a car needs the nearest
place that can admit them, and "nearest" during a crisis is a question about
2 km, not about the city.

WHY OVERPASS

Same constraints as the rest of this app: no API key, no paid tier, no
account. Overpass serves OSM data, which in Indian cities has good coverage
of `amenity=hospital` and `amenity=clinic`. Google Places would be better
data and would also put a billable key in a repo that deliberately has none.

WHAT IT PROMISES

Nothing, on failure. An empty list, never an exception. This is decoration on
top of a phone number that already works: if Overpass is slow or down, the
alert card still shows 108 and the volunteer still calls it. An emergency
feature that can break the page it sits on is worse than one that is absent.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

log = logging.getLogger(__name__)

# Overpass mirrors. Tried in order — the main instance is frequently busy,
# and falling back costs nothing since a failure here is already survivable.
_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

# Overpass asks for an identifying User-Agent and will throttle anonymous
# floods. Same courtesy the geocoder extends to Nominatim.
_UA = "NeighbourAid/1.0 (community crisis response; +https://github.com/parthkansal823/NeighbourAid)"

# 3 km. Wide enough to find something in a small town, tight enough that the
# list stays a decision rather than a directory.
SEARCH_RADIUS_M = 3000

# Most people who need this are near each other — a crowd around one
# incident, all opening the same card. Hospitals do not move, so a coarse
# cache turns that burst into one upstream call.
#
# Keys round coordinates to 3 decimals (~110 m), which is far finer than the
# 3 km search, so the cached answer is always the right neighbourhood.
_CACHE: dict[tuple[float, float], tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 6 * 60 * 60
_CACHE_MAX = 256


def _cache_key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, 3), round(lng, 3))


def _query(lat: float, lng: float) -> str:
    # `out center` gives one coordinate per match whether it was mapped as a
    # node or as a building outline — without it, every hospital mapped as a
    # way comes back with no usable position.
    return f"""
[out:json][timeout:12];
(
  node["amenity"~"^(hospital|clinic)$"](around:{SEARCH_RADIUS_M},{lat},{lng});
  way["amenity"~"^(hospital|clinic)$"](around:{SEARCH_RADIUS_M},{lat},{lng});
);
out center 30;
""".strip()


# Veterinary places tagged as hospitals.
#
# A live Overpass query for Chandigarh returned "Government Pet Hospital" as
# the third-nearest result for a medical emergency. OSM contributors tag
# animal hospitals as `amenity=hospital` often enough that the amenity tag
# alone cannot be trusted, and sending someone having a heart attack to a
# veterinary clinic is not a cosmetic ranking error.
#
# Checked against the name as well as the tags, because the tag is exactly
# what is unreliable here. The false-positive risk — a human hospital with
# "animal" in its name — is worth accepting in this direction.
_VET_TAGS = ("veterinary", "animal_boarding")
_VET_WORDS = ("pet ", " pet", "veterinar", "animal hospital", "animal clinic", "pashu")


def _is_veterinary(tags: dict, name: str) -> bool:
    if tags.get("amenity") in _VET_TAGS or tags.get("healthcare") in _VET_TAGS:
        return True
    low = f" {name.lower()} "
    return any(word in low for word in _VET_WORDS)


def _parse(payload: dict, lat: float, lng: float) -> list[dict]:
    # Reusing the existing kilometre haversine rather than adding a third
    # copy: there are already two in the tree (services/websocket.py and
    # routes/alerts.py, the latter in metres). Imported here rather than at
    # module scope only to keep this optional service off the import path of
    # anything that does not ask for it.
    from .websocket import _haversine  # noqa: PLC0415

    out: list[dict] = []
    for el in payload.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            # An unnamed point cannot be navigated to or read aloud, so it is
            # noise on a card someone is scanning under pressure.
            continue
        if _is_veterinary(tags, name):
            continue
        centre = el.get("center") or el
        h_lat, h_lng = centre.get("lat"), centre.get("lon")
        if h_lat is None or h_lng is None:
            continue
        out.append(
            {
                "name": name,
                "kind": tags.get("amenity"),
                "lat": h_lat,
                "lng": h_lng,
                "phone": tags.get("phone") or tags.get("contact:phone"),
                "emergency": tags.get("emergency") == "yes",
                "distance_km": round(_haversine(lat, lng, h_lat, h_lng), 2),
            }
        )

    # Nearest first, but a place with an emergency department outranks a
    # closer clinic that cannot admit anyone — which is the actual decision
    # being made when this list is read.
    out.sort(key=lambda h: (not h["emergency"], h["distance_km"]))
    return out[:10]


async def nearby_hospitals(
    lat: float, lng: float, timeout: float = 25.0
) -> list[dict]:
    """Hospitals and clinics within SEARCH_RADIUS_M, nearest first.

    Returns [] on any failure. Cached for six hours per ~110 m cell.
    """
    key = _cache_key(lat, lng)
    hit = _CACHE.get(key)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL_SECONDS:
        return hit[1]

    body = _query(lat, lng)
    for url in _ENDPOINTS:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    url, content=body, headers={"User-Agent": _UA}
                )
                resp.raise_for_status()
                found = _parse(resp.json(), lat, lng)
        except (httpx.HTTPError, ValueError, asyncio.TimeoutError) as exc:
            log.info("Overpass %s failed: %s", url, exc)
            continue
        except Exception as exc:  # noqa: BLE001 — must never break the caller
            log.info("Overpass %s unexpected failure: %s", url, exc)
            continue

        # Cache even an empty result: a genuinely hospital-free 3 km is a
        # fact about the area, and re-asking Overpass on every card open
        # would be the same wasted round trip repeated.
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.clear()
        _CACHE[key] = (time.monotonic(), found)
        return found

    return []
