"""Tests for the in-memory WebSocket ConnectionManager.

We can't easily exercise full WS connect/disconnect in unit tests without
running uvicorn — but the routing decisions (does this volunteer get this
alert? does the skill match extend the radius?) are async-callable on the
manager directly.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.services.websocket import (
    CATEGORY_PREFERRED_SKILLS,
    DEFAULT_RADIUS_KM,
    SKILL_RADIUS_KM,
    ConnectionManager,
)


class FakeWS:
    """Tiny stand-in for FastAPI's WebSocket — records sent payloads."""

    def __init__(self):
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send_text(self, text: str) -> None:
        if self.closed:
            raise RuntimeError("WS closed")
        self.sent.append(json.loads(text))


def _alert(category: str, lng: float, lat: float, oid: str = "abc") -> dict:
    return {
        "id": oid,
        "category": category,
        "urgency": "HIGH",
        "location": {"type": "Point", "coordinates": [lng, lat]},
    }


@pytest.fixture
def manager():
    return ConnectionManager()


def test_count_reflects_active_connections(manager):
    assert manager.count() == 0
    manager.register("u1", FakeWS(), [76.7, 30.7])
    manager.register("u2", FakeWS(), [76.8, 30.8])
    assert manager.count() == 2
    manager.disconnect("u1")
    assert manager.count() == 1


@pytest.mark.asyncio
async def test_volunteer_within_default_radius_receives_alert(manager):
    ws = FakeWS()
    # Volunteer at the same coords as the alert
    manager.register("v1", ws, [76.7794, 30.7333])
    alert = _alert("medical", 76.7794, 30.7333)

    await manager.broadcast_nearby(alert)

    assert len(ws.sent) == 1
    payload = ws.sent[0]
    assert payload["id"] == "abc"
    assert payload["your_distance_km"] == pytest.approx(0.0, abs=0.01)
    assert payload["is_skill_match"] is False  # no skills registered


@pytest.mark.asyncio
async def test_volunteer_outside_default_radius_skipped(manager):
    ws = FakeWS()
    # Place volunteer ~50 km away — well outside the 5 km default
    manager.register("v1", ws, [77.5, 30.7])
    alert = _alert("medical", 76.7794, 30.7333)
    await manager.broadcast_nearby(alert)
    assert ws.sent == []


@pytest.mark.asyncio
async def test_skill_match_extends_radius(manager):
    """A medical-tagged volunteer 10 km away (outside default 5 km) should
    still get a medical alert because the skill match bumps the radius."""
    assert "medical" in CATEGORY_PREFERRED_SKILLS["medical"]
    assert DEFAULT_RADIUS_KM < 10 < SKILL_RADIUS_KM

    ws = FakeWS()
    # 10 km east of the alert (longitude offset ≈ 0.1° at latitude 30°)
    manager.register("v1", ws, [76.7794 + 0.105, 30.7333], skills=["medical"])
    alert = _alert("medical", 76.7794, 30.7333)

    await manager.broadcast_nearby(alert)

    assert len(ws.sent) == 1
    assert ws.sent[0]["is_skill_match"] is True


@pytest.mark.asyncio
async def test_unrelated_skill_does_not_extend_radius(manager):
    ws = FakeWS()
    # 10 km away, but volunteer has a swim skill — not preferred for medical
    manager.register("v1", ws, [76.7794 + 0.105, 30.7333], skills=["swim"])
    alert = _alert("medical", 76.7794, 30.7333)

    await manager.broadcast_nearby(alert)

    # Outside default radius and skill doesn't help → no broadcast
    assert ws.sent == []


@pytest.mark.asyncio
async def test_disconnects_after_send_failure(manager):
    ws = FakeWS()
    ws.closed = True  # any send will raise
    manager.register("v1", ws, [76.7794, 30.7333])
    alert = _alert("medical", 76.7794, 30.7333)

    await manager.broadcast_nearby(alert)

    # Manager should have removed the failing connection so it doesn't
    # keep raising on subsequent broadcasts.
    assert manager.count() == 0


@pytest.mark.asyncio
async def test_payload_includes_vehicle_flag(manager):
    ws = FakeWS()
    manager.register("v1", ws, [76.7794, 30.7333], has_vehicle=True)
    alert = _alert("medical", 76.7794, 30.7333)
    await manager.broadcast_nearby(alert)
    assert ws.sent[0]["your_has_vehicle"] is True
