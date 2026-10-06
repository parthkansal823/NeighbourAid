"""Reverse-geocode endpoint used by the report form.

Exists so a reporter sees a readable address before submitting rather than
raw coordinates. The behaviour worth protecting is the degradation: a slow or
unhelpful geocoder must return `address: null` with a 200, never an error,
because a missing address must not stop someone reporting an emergency.
"""

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_returns_address_for_valid_coordinates(client, monkeypatch):
    from app.routes import geo

    monkeypatch.setattr(geo, "reverse_geocode",
                        AsyncMock(return_value="Sector 22, Chandigarh"))
    c, _ = client
    resp = await c.get("/api/geo/reverse", params={"lat": 30.7333, "lng": 76.7794})
    assert resp.status_code == 200
    assert resp.json()["address"] == "Sector 22, Chandigarh"


@pytest.mark.asyncio
async def test_geocoder_failure_is_not_an_error(client, monkeypatch):
    """The whole point: no address is a degraded result, not a failure."""
    from app.routes import geo

    monkeypatch.setattr(geo, "reverse_geocode", AsyncMock(return_value=None))
    c, _ = client
    resp = await c.get("/api/geo/reverse", params={"lat": 30.7333, "lng": 76.7794})
    assert resp.status_code == 200
    assert resp.json()["address"] is None


@pytest.mark.asyncio
async def test_needs_no_authentication(client, monkeypatch):
    """Anonymous reporting is a supported flow, so requiring a token here
    would leave exactly those users looking at raw coordinates."""
    from app.routes import geo

    monkeypatch.setattr(geo, "reverse_geocode", AsyncMock(return_value="X"))
    c, _ = client
    resp = await c.get("/api/geo/reverse", params={"lat": 1.0, "lng": 1.0})
    assert resp.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "lat,lng",
    [(91, 0), (-91, 0), (0, 181), (0, -181)],
)
async def test_rejects_impossible_coordinates(client, lat, lng):
    c, _ = client
    resp = await c.get("/api/geo/reverse", params={"lat": lat, "lng": lng})
    assert resp.status_code == 422
