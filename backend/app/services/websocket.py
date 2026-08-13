import json
import math
from typing import Dict, List, Optional, Tuple
from fastapi import WebSocket


# Map category → preferred skill tags. Volunteers tagged with any listed
# skill get the alert even if they're outside the normal radius (up to the
# extended radius). Keeps useful helpers aware of alerts that match them.
CATEGORY_PREFERRED_SKILLS: Dict[str, List[str]] = {
    "medical": ["medical", "cpr", "elderly_care", "child_care"],
    "fire": ["medical", "driver"],
    "flood": ["swim", "driver"],
    "accident": ["medical", "cpr", "driver"],
    "missing": ["driver"],
    # No "security" skill exists, and sending untrained volunteers toward
    # violence would be worse than sending nobody. Medical covers the
    # aftermath; the rest is a police matter, which the emergency dialer
    # surfaces separately.
    "violence": ["medical"],
    "animal": [],
    "gas": ["driver"],
    "power": ["electrician"],
    "water": [],
    "structure": ["medical", "driver"],
    "other": [],
}

# "Skill match" extends the broadcast radius so a swimmer 10 km away still
# gets the flood alert, but someone 50 km away doesn't get spammed.
DEFAULT_RADIUS_KM = 5.0
SKILL_RADIUS_KM = 15.0


class ConnectionManager:
    def __init__(self):
        # volunteer_id -> (websocket, [lng, lat], skills, has_vehicle)
        self._active: Dict[
            str, Tuple[WebSocket, List[float], List[str], bool]
        ] = {}

    def register(
        self,
        volunteer_id: str,
        ws: WebSocket,
        coordinates: List[float],
        skills: Optional[List[str]] = None,
        has_vehicle: bool = False,
    ):
        self._active[volunteer_id] = (
            ws,
            coordinates,
            list(skills or []),
            bool(has_vehicle),
        )

    def disconnect(self, volunteer_id: str):
        self._active.pop(volunteer_id, None)

    def count(self) -> int:
        return len(self._active)

    def coords_for(self, volunteer_id: str) -> Optional[List[float]]:
        """Last-known [lng, lat] for a connected volunteer, or None when
        they're offline. Used by the live-tracking endpoint so a reporter
        can see "is my volunteer on the way?" without polling them
        directly."""
        entry = self._active.get(volunteer_id)
        if entry is None:
            return None
        return list(entry[1])

    async def broadcast_nearby(
        self,
        alert_dict: dict,
        radius_km: float = DEFAULT_RADIUS_KM,
    ):
        """Broadcast an alert to volunteers within `radius_km`, plus volunteers
        whose skills match the alert category within SKILL_RADIUS_KM.
        Adds an `is_skill_match` flag so the client can render a stronger
        notification when the alert is a near-perfect fit."""
        a_lng, a_lat = alert_dict["location"]["coordinates"]
        category = alert_dict.get("category", "other")
        preferred = set(CATEGORY_PREFERRED_SKILLS.get(category, []))

        for vid, (ws, coords, skills, has_vehicle) in list(self._active.items()):
            v_lng, v_lat = coords
            distance = _haversine(a_lat, a_lng, v_lat, v_lng)
            skill_match = bool(preferred.intersection(set(skills)))
            effective_radius = SKILL_RADIUS_KM if skill_match else radius_km
            if distance > effective_radius:
                continue
            try:
                payload = dict(alert_dict)
                payload["is_skill_match"] = skill_match
                payload["your_distance_km"] = round(distance, 2)
                payload["your_has_vehicle"] = has_vehicle
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:
                self.disconnect(vid)


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


manager = ConnectionManager()
