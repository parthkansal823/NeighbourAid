"""Health endpoints.

These back two pieces of deploy infrastructure that fail silently when
wrong, so they get real tests rather than a smoke check:

  * render.yaml points its platform health check at /health
  * ops/keepalive pings /health every 10 minutes to stop the free-tier
    instance idling out

The split between them is the thing worth protecting. /health must stay
dependency-free — if it ever starts failing on a database blip, the
platform recycles healthy containers and a transient Atlas wobble becomes
an outage. /health/ready is where dependency checking belongs.
"""

import pytest
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_health_is_ok(client):
    c, _ = client
    resp = await c.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_health_does_not_touch_the_database(client):
    """The whole point of the liveness/readiness split.

    A regression here — someone "helpfully" making /health verify Mongo —
    turns every database hiccup into a container restart loop.
    """
    c, db = client
    await c.get("/health")
    db.command.assert_not_called()


@pytest.mark.asyncio
async def test_health_stays_up_when_the_database_is_down(client):
    c, db = client
    db.command = AsyncMock(side_effect=RuntimeError("connection refused"))
    resp = await c.get("/health")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_readiness_reports_ok_and_pings_the_database(client):
    c, db = client
    resp = await c.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    db.command.assert_awaited_once_with("ping")


@pytest.mark.asyncio
async def test_readiness_returns_503_when_the_database_is_unreachable(client):
    c, db = client
    db.command = AsyncMock(side_effect=RuntimeError("connection refused"))
    resp = await c.get("/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["database"] == "unreachable"
