"""WebSocket routing and overlapping connection lifecycles.

Controlled sockets exercise the actual handler without a live server.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

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
async def test_old_connection_cleanup_preserves_replacement(manager):
    old_ws, new_ws = FakeWS(), FakeWS()
    manager.register("v1", old_ws, [76.7794, 30.7333])
    manager.register("v1", new_ws, [76.7794, 30.7333])

    manager.disconnect("v1", old_ws)
    await manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333))

    assert manager.count() == 1
    assert len(new_ws.sent) == 1
    manager.disconnect("v1", new_ws)
    assert manager.count() == 0


@pytest.mark.asyncio
async def test_failed_send_on_old_socket_preserves_replacement(manager):
    new_ws = FakeWS()

    class ReplacedDuringSend(FakeWS):
        async def send_text(self, _text):
            manager.register("v1", new_ws, [76.7794, 30.7333])
            raise RuntimeError("old connection failed after reconnection")

    manager.register("v1", ReplacedDuringSend(), [76.7794, 30.7333])
    await manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333))
    await manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333, oid="next"))

    assert manager.count() == 1
    assert [item["id"] for item in new_ws.sent] == ["next"]


@pytest.mark.asyncio
@pytest.mark.parametrize("late_coordinates", [False, True])
async def test_websocket_handler_late_disconnect_preserves_new_connection(
    monkeypatch, manager, late_coordinates,
):
    from bson import ObjectId
    from fastapi import WebSocketDisconnect
    from app import main

    class EndpointWS(FakeWS):
        def __init__(self):
            super().__init__()
            self.registered = asyncio.Event()
            self.messages = asyncio.Queue()
            self.initial_location = True

        async def accept(self):
            pass

        async def receive_text(self):
            if self.initial_location:
                self.initial_location = False
                return json.dumps({"coordinates": [76.7794, 30.7333]})
            self.registered.set()
            message = await self.messages.get()
            self.registered.clear()
            if message is None:
                raise WebSocketDisconnect()
            return json.dumps(message)

    volunteer_id = str(ObjectId())
    db = MagicMock()
    db.users.find_one = AsyncMock(return_value={"skills": []})
    monkeypatch.setattr(main, "get_db", lambda: db)
    monkeypatch.setattr(main, "manager", manager)
    monkeypatch.setattr(main, "decode_token_safe", lambda _token: {
        "sub": volunteer_id, "role": "volunteer",
    })
    old_ws, new_ws = EndpointWS(), EndpointWS()
    old_task = asyncio.create_task(main.volunteer_ws(old_ws, "valid"))
    new_task = None
    try:
        await asyncio.wait_for(old_ws.registered.wait(), timeout=1)
        new_task = asyncio.create_task(main.volunteer_ws(new_ws, "valid"))
        await asyncio.wait_for(new_ws.registered.wait(), timeout=1)

        # The current socket can move. A GPS message still queued on the
        # previous socket must not take ownership back or reset this point.
        current_coordinates = [76.7800, 30.7333]
        new_ws.registered.clear()
        new_ws.messages.put_nowait({"coordinates": current_coordinates})
        await asyncio.wait_for(new_ws.registered.wait(), timeout=1)
        assert manager.coords_for(volunteer_id) == current_coordinates
        if late_coordinates:
            old_ws.registered.clear()
            old_ws.messages.put_nowait({"coordinates": [0, 0]})
            await asyncio.wait_for(old_ws.registered.wait(), timeout=1)
            assert manager.coords_for(volunteer_id) == current_coordinates

        old_ws.messages.put_nowait(None)
        await asyncio.wait_for(old_task, timeout=1)

        await manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333))
        assert manager.count() == 1
        assert len(new_ws.sent) == 1
    finally:
        old_ws.messages.put_nowait(None)
        new_ws.messages.put_nowait(None)
        await asyncio.gather(old_task, *([new_task] if new_task else []))


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


@pytest.mark.asyncio
async def test_hung_socket_does_not_delay_healthy_volunteer_or_lose_push_fallback(monkeypatch, manager):
    from app.services import websocket

    monkeypatch.setattr(websocket, "SOCKET_SEND_TIMEOUT_SECONDS", 0.1)
    fallback = MagicMock()
    monkeypatch.setattr(websocket, "_schedule_push", fallback)
    healthy_sent = asyncio.Event()
    hung_cancelled = asyncio.Event()

    class HungWS(FakeWS):
        async def send_text(self, _text):
            try:
                await asyncio.Event().wait()
            finally:
                hung_cancelled.set()

    class HealthyWS(FakeWS):
        async def send_text(self, text):
            await super().send_text(text)
            healthy_sent.set()

    healthy = HealthyWS()
    manager.register("hung", HungWS(), [76.7794, 30.7333])
    manager.register("healthy", healthy, [76.7794, 30.7333])
    alert = _alert("medical", 76.7794, 30.7333)
    broadcast = asyncio.create_task(manager.broadcast_nearby(alert))
    try:
        await asyncio.wait_for(healthy_sent.wait(), timeout=0.05)
        assert not broadcast.done(), "healthy delivery must not wait for the hung socket timeout"
        await asyncio.wait_for(broadcast, timeout=0.5)
    finally:
        if not broadcast.done():
            broadcast.cancel()
        await asyncio.gather(broadcast, return_exceptions=True)

    assert hung_cancelled.is_set()
    assert manager.count() == 1
    assert manager.coords_for("hung") is None
    assert healthy.sent[0]["id"] == "abc"
    fallback.assert_called_once_with(alert, DEFAULT_RADIUS_KM, {"healthy"})


@pytest.mark.asyncio
async def test_timed_out_old_socket_does_not_unregister_replacement(monkeypatch, manager):
    from app.services import websocket

    monkeypatch.setattr(websocket, "SOCKET_SEND_TIMEOUT_SECONDS", 0.01)
    fallback = MagicMock()
    monkeypatch.setattr(websocket, "_schedule_push", fallback)
    replacement = FakeWS()

    class ReplacedHungWS(FakeWS):
        async def send_text(self, _text):
            manager.register("v1", replacement, [76.7794, 30.7333])
            await asyncio.Event().wait()

    manager.register("v1", ReplacedHungWS(), [76.7794, 30.7333])
    await asyncio.wait_for(manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333)), timeout=0.5)
    assert manager.count() == 1
    assert fallback.call_args.args[2] == set()
    await manager.broadcast_nearby(_alert("medical", 76.7794, 30.7333, oid="next"))
    assert [item["id"] for item in replacement.sent] == ["next"]
    assert fallback.call_args.args[2] == {"v1"}


@pytest.mark.asyncio
async def test_cancelled_broadcast_cleans_up_inflight_send_and_preserves_socket(monkeypatch, manager):
    from app.services import websocket

    fallback = MagicMock()
    monkeypatch.setattr(websocket, "_schedule_push", fallback)
    started, cancelled = asyncio.Event(), asyncio.Event()

    class HungWS(FakeWS):
        async def send_text(self, _text):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

    manager.register("v1", HungWS(), [76.7794, 30.7333])
    alert = _alert("medical", 76.7794, 30.7333)
    broadcast = asyncio.create_task(manager.broadcast_nearby(alert))
    await asyncio.wait_for(started.wait(), timeout=0.5)
    broadcast.cancel()
    with pytest.raises(asyncio.CancelledError):
        await broadcast
    assert cancelled.is_set()
    assert manager.count() == 1, "caller cancellation is not a failed connection"
    fallback.assert_called_once_with(alert, DEFAULT_RADIUS_KM, set())
