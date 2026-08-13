"""Address and weather are fetched AFTER the alert posts.

They used to be awaited inline, putting 500-1500 ms of third-party latency
between someone pressing "send" and volunteers being told anything. The
coordinates dispatch a volunteer and are already in hand; the address only
makes the card readable. These tests pin that ordering so it cannot quietly
move back onto the hot path.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.enrich import enrich_alert


@pytest.mark.asyncio
async def test_enrichment_persists_and_rebroadcasts(monkeypatch):
    from app.services import enrich

    monkeypatch.setattr(enrich, "reverse_geocode",
                        AsyncMock(return_value="Sector 22, Chandigarh, 160022"))
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value={"code": 0}))
    monkeypatch.setattr(enrich, "supports_category", lambda *_: False)
    broadcast = AsyncMock()
    monkeypatch.setattr(enrich.manager, "broadcast_nearby", broadcast)

    db = MagicMock()
    db.alerts.update_one = AsyncMock()
    # _serialize needs reporter_id; everything else it defaults.
    db.alerts.find_one = AsyncMock(return_value={
        "_id": "507f1f77bcf86cd799439011",
        "reporter_id": "507f1f77bcf86cd799439012",
        "category": "medical",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        "address": "Sector 22, Chandigarh, 160022",
    })

    await enrich_alert(db, "507f1f77bcf86cd799439011", 30.7333, 76.7794,
                       "medical", witnesses=1, corroborating_count=0,
                       photo_evidence_score=0)

    db.alerts.update_one.assert_awaited_once()
    written = db.alerts.update_one.await_args.args[1]["$set"]
    assert written["address"] == "Sector 22, Chandigarh, 160022"
    # Re-broadcast is what makes the card fill in without a refresh.
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_only_updates_alerts_still_missing_an_address(monkeypatch):
    """A resolve or a witness confirmation can land while we are waiting, and
    blindly overwriting verified_score would discard it."""
    from app.services import enrich

    monkeypatch.setattr(enrich, "reverse_geocode", AsyncMock(return_value="X"))
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value=None))
    monkeypatch.setattr(enrich, "supports_category", lambda *_: False)
    monkeypatch.setattr(enrich.manager, "broadcast_nearby", AsyncMock())

    db = MagicMock()
    db.alerts.update_one = AsyncMock()
    db.alerts.find_one = AsyncMock(return_value=None)

    await enrich_alert(db, "abc", 1.0, 1.0, "medical",
                       witnesses=1, corroborating_count=0, photo_evidence_score=0)

    query = db.alerts.update_one.await_args.args[0]
    assert query["address"] is None, "must only fill in alerts that lack an address"


@pytest.mark.asyncio
async def test_a_failing_geocoder_never_raises(monkeypatch):
    """A background task that raises is a log line nobody reads. An alert
    with no address is a working alert."""
    from app.services import enrich

    monkeypatch.setattr(enrich, "reverse_geocode",
                        AsyncMock(side_effect=RuntimeError("nominatim down")))
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value=None))
    db = MagicMock()
    db.alerts.update_one = AsyncMock()

    await enrich_alert(db, "abc", 1.0, 1.0, "medical",
                       witnesses=1, corroborating_count=0, photo_evidence_score=0)

    db.alerts.update_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_alert_creation_does_not_await_the_geocoder(client, monkeypatch):
    """The point of the whole change: posting an alert must not call the
    geocoder on the request path, however slow it is."""
    import app.services.enrich as enrich
    from app.routes import alerts as alerts_route

    called = {"geocode": False}

    async def _should_not_run(*_a, **_k):
        called["geocode"] = True
        return "nope"

    monkeypatch.setattr(enrich, "reverse_geocode", _should_not_run)
    # Neutralise the background task so the test asserts on the request path
    # only and does not leave a pending task behind.
    monkeypatch.setattr(alerts_route, "enrich_alert", AsyncMock())

    c, db = client
    db.alerts.find = MagicMock(return_value=_EmptyCursor())
    resp = await c.post("/api/alerts/anonymous", json={
        "category": "medical",
        "description": "Ek aadmi behosh hai, saans nahi aa rahi",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    })
    assert resp.status_code == 201
    assert called["geocode"] is False, "geocoder was awaited during alert creation"
    assert resp.json()["address"] is None


class _EmptyCursor:
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    def sort(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self
