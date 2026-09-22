"""Reverse geocoding for the report form.

The backend already reverse-geocodes every alert on creation, but that
happens after submit. The reporter needs to see the address BEFORE sending,
so they can tell "Junction 27, Sector 22" from a GPS fix that landed on the
wrong side of the city — coordinates alone are unreadable to a human.

Proxied through the API rather than called from the browser for three
reasons: Nominatim's usage policy requires an identifying User-Agent, which a
browser cannot set on a cross-origin request; the browser would be blocked by
CORS anyway; and routing it here means one shared timeout and rate limit
instead of one per user.
"""

from fastapi import APIRouter, HTTPException, Query, Request

from ..services.geocode import reverse_geocode
from ..services.hospitals import SEARCH_RADIUS_M, nearby_hospitals
from ..services.ratelimit import write_limiter

router = APIRouter(prefix="/api/geo", tags=["geo"])


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.get("/reverse")
async def reverse(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    """Coordinates -> a rough human-readable address.

    Unauthenticated on purpose: the report form is reachable without an
    account (anonymous reporting), so requiring a token here would leave
    exactly those users staring at raw coordinates. Rate-limited per IP
    instead, sharing the general write limiter.

    Returns `address: null` rather than an error when the geocoder is slow or
    unhelpful. A missing address must never block a report — the coordinates
    are what actually dispatch a volunteer, and they are already in hand.
    """
    if not write_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests")

    # Longer than the 2s default used during alert creation, on purpose.
    # There the timeout is a latency budget — the reporter is waiting for the
    # alert to post, so a slow geocoder must be abandoned. Here nothing is
    # blocked but a line of text on a form the user is still filling in, and
    # measured Nominatim round trips run 500-1500 ms, close enough to 2s that
    # the default was dropping addresses it could have fetched.
    address = await reverse_geocode(lat, lng, timeout=6.0)
    return {"address": address}


@router.get("/hospitals")
async def hospitals(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    """Nearby hospitals and clinics, nearest first, emergency departments up.

    Answers the question the emergency numbers do not. A medical alert
    already offers 108 for an ambulance; a volunteer who has reached the
    person and is putting them in a car needs somewhere to drive to.

    Unauthenticated for the same reason as /reverse: the report form and the
    public alert page both work without an account, and this is most useful
    to whoever got there first. Rate-limited per IP instead.

    Returns `hospitals: []` rather than an error when the upstream is slow or
    down. It sits on top of a phone number that already works, so it must
    never be the thing that breaks the card.
    """
    if not write_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests")

    # 25s, not the 8s this first had. A cold Overpass query for Chandigarh
    # measured 13s, so the shorter budget meant a first-time lookup in an
    # area always returned an empty list — and then cached nothing, so the
    # next request was equally cold. Nothing is blocked while this runs: the
    # client fetches it alongside the card, which has already rendered with
    # the emergency numbers on it.
    found = await nearby_hospitals(lat, lng, timeout=25.0)
    return {"hospitals": found, "radius_km": SEARCH_RADIUS_M / 1000}
