"""How long until a volunteer can actually be there.

Dispatch used one number: straight-line kilometres, with a 5 km cutoff. Two
things were wrong with that.

A 5 km radius on foot is a 93-minute walk. That volunteer is not a
responder, they are a bystander who will read about it later. Meanwhile
`has_vehicle` was collected at registration, stored, and sent to the client
— and never once consulted when deciding who to page. Someone with a car
got the same 5 km as someone walking, despite covering that distance in a
quarter of the time.

So the radius now depends on how the volunteer travels, and the feed is
ordered by minutes-to-arrive rather than by kilometres.

The deliberate choice here is that the walking radius does not shrink.
Cutting it to whatever distance is reachable in fifteen minutes would be
defensible on paper and would remove most of the volunteer pool — in a
crisis, a neighbour forty minutes away on foot is still worth having. What
changes is who appears at the top of the list, and that someone with a
vehicle is finally allowed to cover the ground they can cover.

No routing API. OSRM's public server is rate-limited and not for production,
and self-hosting it needs gigabytes of map data on a box with 512 MB. A
detour factor plus a mode speed is a worse model that is honest about being
one, and it is right about the thing that matters: ordering.
"""

from __future__ import annotations

__all__ = [
    "DETOUR_FACTOR",
    "MAX_DISPATCH_RADIUS_KM",
    "SPEED_KMH",
    "eta_minutes",
    "radius_km_for",
]

# Straight line to road distance. Indian urban street grids, one-ways and
# the occasional unbridged nallah put this near 1.4; it is 1.2 on a planned
# grid and worse than 1.6 in an old city centre. One number, stated, beats
# a per-city table nobody will maintain.
DETOUR_FACTOR = 1.4

# Effective door-to-door speed, not vehicle capability. 18 km/h for a car or
# scooter is city traffic plus parking plus the walk from where you parked;
# quoting 40 would produce ETAs nobody could meet, and a volunteer who is
# consistently late stops being trusted.
SPEED_KMH = {
    False: 4.5,   # on foot
    True: 18.0,   # any vehicle
}

# Base radii. Walking is unchanged from the old flat 5 km — see the module
# docstring for why this is not tightened. Vehicle is what `has_vehicle` was
# always supposed to buy.
FOOT_RADIUS_KM = 5.0
VEHICLE_RADIUS_KM = 12.0

# A rare skill is worth waiting longer for: a swimmer for a drowning, a
# nurse for a cardiac arrest. These extend the radius rather than replacing
# it, so a skill match never makes someone's radius smaller.
FOOT_SKILL_RADIUS_KM = 15.0
VEHICLE_SKILL_RADIUS_KM = 25.0

# The widest any volunteer can qualify for. Callers that pre-filter with a
# database query must reach at least this far, or the per-volunteer check
# never sees the rows it would have kept. Derived rather than written down
# twice: raising a radius above must not need a second edit here.
MAX_DISPATCH_RADIUS_KM = max(
    FOOT_RADIUS_KM, VEHICLE_RADIUS_KM, FOOT_SKILL_RADIUS_KM, VEHICLE_SKILL_RADIUS_KM
)


def eta_minutes(distance_km: float, has_vehicle: bool = False) -> int:
    """Minutes to arrive, rounded up. Never zero.

    Rounded up because a volunteer shown "0 min" has been promised something
    impossible; the floor of one minute is the time to find your shoes.
    """
    speed = SPEED_KMH[bool(has_vehicle)]
    minutes = (distance_km * DETOUR_FACTOR) / speed * 60
    return max(1, int(minutes + 0.5))


def radius_km_for(has_vehicle: bool = False, skill_match: bool = False) -> float:
    """The distance at which this volunteer is still worth paging."""
    if has_vehicle:
        return VEHICLE_SKILL_RADIUS_KM if skill_match else VEHICLE_RADIUS_KM
    return FOOT_SKILL_RADIUS_KM if skill_match else FOOT_RADIUS_KM
