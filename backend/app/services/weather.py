"""Current weather via Open-Meteo (free, no key, global coverage incl. India)."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

_OPEN_METEO = "https://api.open-meteo.com/v1/forecast"


async def current_weather(lat: float, lng: float, timeout: float = 2.0) -> Optional[dict]:
    """Fetch current temperature / precipitation / wind at (lat,lng).
    Returns {"temperature_c": ..., "precipitation_mm": ..., "wind_kph": ..., "code": ...}
    or None on failure. Never raises.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                _OPEN_METEO,
                params={
                    "latitude": lat,
                    "longitude": lng,
                    "current": "temperature_2m,precipitation,wind_speed_10m,weather_code",
                    "timezone": "auto",
                },
            )
            if r.status_code == 200:
                cur = r.json().get("current", {})
                return {
                    "temperature_c": cur.get("temperature_2m"),
                    "precipitation_mm": cur.get("precipitation"),
                    "wind_kph": cur.get("wind_speed_10m"),
                    "code": cur.get("weather_code"),
                }
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        log.info("current_weather skipped: %s", exc)
    return None


def supports_category(category: str, weather: dict | None) -> bool:
    """Does the live weather independently corroborate this alert category?"""
    if not weather:
        return False
    precip = weather.get("precipitation_mm") or 0
    wind = weather.get("wind_kph") or 0
    code = weather.get("code") or 0

    if category == "flood":
        # heavy rain (> 4 mm/hr) or flood-indicating WMO codes (95–99 = thunderstorm, 65/67 = heavy rain)
        return precip >= 4 or code in {65, 67, 82, 95, 96, 99}
    if category == "fire":
        # dry + strong wind escalates fire risk (rough heuristic)
        return precip == 0 and wind >= 25
    if category == "power":
        # high wind commonly triggers outages
        return wind >= 35 or code in {95, 96, 99}
    return False
