import asyncio
import json
import logging
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from fastapi import WebSocket

from .dispatch import eta_minutes
from .alert_workflow import public_workflow
from .notification_matching import CATEGORY_PREFERRED_SKILLS, matching

__all__ = ["CATEGORY_PREFERRED_SKILLS", "ConnectionManager", "DEFAULT_RADIUS_KM", "SKILL_RADIUS_KM", "manager"]

log = logging.getLogger(__name__)

# asyncio holds only a weak reference to a task, so without this a running
# fan-out can be collected partway through and vanish. Same pattern, and
# same reason, as `_background_tasks` in routes/alerts.py.
_push_tasks: Set[asyncio.Task] = set()


def _schedule_push(alert_dict: dict, radius_km: float, reached_live: Set[str]) -> None:
    """Fan the same alert out to subscribed volunteers who are NOT connected.

    This lives inside `broadcast_nearby` rather than at its eight call sites
    because the eight would drift: the next person to add a ninth broadcast
    would have to remember, and nothing would fail if they forgot — the
    alert would simply never reach anyone with the tab closed.

    Imported lazily and scheduled rather than awaited, for two reasons. The
    lazy import keeps this module free of a database dependency it otherwise
    does not have; `create_task` keeps N HTTPS round trips off the path of
    the reporter who is still waiting for their alert to post.
    """
    from .push import is_enabled  # noqa: PLC0415 - avoids a module-level DB dep

    if not is_enabled():
        return

    async def _run() -> None:
        try:
            from .push import push_nearby  # noqa: PLC0415
            from ..db.client import get_db  # noqa: PLC0415

            sent = await push_nearby(get_db(), alert_dict, radius_km, reached_live)
            if sent:
                log.info("pushed alert to %s offline volunteer(s)", sent)
        except Exception:
            # A failed notification must never surface as a failed alert.
            log.exception("push fan-out failed")

    task = asyncio.create_task(_run())
    _push_tasks.add(task)
    task.add_done_callback(_push_tasks.discard)


# Map category → preferred skill tags. Volunteers tagged with any listed
# skill get the alert even if they're outside the normal radius (up to the
# extended radius). Keeps useful helpers aware of alerts that match them.

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
        self._positions: dict[str, dict] = {}
        self._preferences: dict[str, dict] = {}

    def register(
        self,
        volunteer_id: str,
        ws: WebSocket,
        coordinates: List[float],
        skills: Optional[List[str]] = None,
        has_vehicle: bool = False,
        notification_preferences: Optional[dict] = None,
    ):
        self._active[volunteer_id] = (
            ws,
            coordinates,
            list(skills or []),
            bool(has_vehicle),
        )
        self._positions[volunteer_id] = {
            "coordinates": list(coordinates), "updated_at": datetime.now(timezone.utc),
            "accuracy_m": None,
        }
        self._preferences[volunteer_id] = notification_preferences or {}

    def update_coordinates(
        self, volunteer_id: str, ws: WebSocket, coordinates: List[float],
    ) -> None:
        # Registration grants ownership only at the initial handshake. A
        # delayed GPS message from an older socket cannot reclaim it. This
        # check and write are synchronous so reconnect cannot interleave.
        current = self._active.get(volunteer_id)
        if current is None or current[0] is not ws:
            return
        self._active[volunteer_id] = (ws, coordinates, current[2], current[3])
        self._positions[volunteer_id] = {
            "coordinates": list(coordinates), "updated_at": datetime.now(timezone.utc),
            "accuracy_m": None,
        }

    def disconnect(self, volunteer_id: str, ws: Optional[WebSocket] = None):
        # A reconnect can register its replacement before the previous
        # handler finishes or its pending send fails. Only the socket being
        # cleaned up may remove its registration.
        current = self._active.get(volunteer_id)
        if ws is not None and (current is None or current[0] is not ws):
            return
        self._active.pop(volunteer_id, None)
        self._positions.pop(volunteer_id, None)
        self._preferences.pop(volunteer_id, None)

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

    def position_for(self, volunteer_id: str) -> Optional[dict]:
        """Observed socket position only; never substitutes profile/home data."""
        position = self._positions.get(volunteer_id)
        if volunteer_id not in self._active or not position:
            return None
        return {**position, "coordinates": list(position["coordinates"])}

    def update_preferences(self, volunteer_id: str, notification_preferences: dict):
        if volunteer_id in self._active:
            self._preferences[volunteer_id] = dict(notification_preferences)

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

        reached_live: set[str] = set()
        for vid, (ws, coords, skills, has_vehicle) in list(self._active.items()):
            v_lng, v_lat = coords
            distance = _haversine(a_lat, a_lng, v_lat, v_lng)
            eligible, skill_match, _prefs = matching(
                alert_dict, distance_km=distance, skills=skills, has_vehicle=has_vehicle,
                raw_preferences=self._preferences.get(vid), base_radius=radius_km,
            )
            # How the volunteer travels now decides how far they are worth
            # paging. `has_vehicle` was collected at registration and only
            # ever displayed; someone with a car had the same 5 km as
            # someone walking, despite covering it four times faster.
            #
            # `radius_km` from the caller is still honoured as a floor, so a
            # caller that deliberately widens the broadcast is not narrowed
            # by someone's travel mode.
            if not eligible:
                continue
            try:
                payload = public_workflow(dict(alert_dict))
                payload.pop("_submission_key", None)
                payload.pop("_submission_hash", None)
                payload["is_skill_match"] = skill_match
                payload["your_distance_km"] = round(distance, 2)
                payload["your_has_vehicle"] = has_vehicle
                # The number a volunteer can act on. "5.0 km" tells them
                # nothing about whether they are the right person to go;
                # "23 min" does.
                payload["your_eta_minutes"] = eta_minutes(distance, has_vehicle)
                await ws.send_text(json.dumps(payload, default=str))
                reached_live.add(vid)
            except Exception:
                self.disconnect(vid, ws)

        _schedule_push(alert_dict, radius_km, reached_live)


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
