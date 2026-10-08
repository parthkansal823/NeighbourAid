"""Bounded cache/load sharing without any Overpass requests."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.services import hospitals

LAT, LNG = 30.7333, 76.7794


def hospital(name="Civil Hospital"):
    return {"name": name, "lat": LAT, "lng": LNG, "emergency": True, "distance_km": 0, "kind": "hospital", "phone": None}


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch):
    monkeypatch.setattr(hospitals, "_CACHE", {})
    monkeypatch.setattr(hospitals, "_IN_FLIGHT", {})
    monkeypatch.setattr(hospitals, "_UPSTREAM_SLOTS", asyncio.Semaphore(4))


async def test_concurrent_same_cell_uses_one_upstream_load(monkeypatch):
    fetch = AsyncMock(return_value=([hospital()], True))
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    results = await asyncio.gather(*(hospitals.nearby_hospitals(LAT, LNG) for _ in range(20)))
    assert fetch.await_count == 1
    assert all(result[0]["name"] == "Civil Hospital" for result in results)
    assert len({id(result) for result in results}) == 20
    assert hospitals._IN_FLIGHT == {}


async def test_cached_responses_are_copies_with_each_callers_distance(monkeypatch):
    fetch = AsyncMock(return_value=([hospital()], True))
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    first = await hospitals.nearby_hospitals(LAT, LNG)
    first[0]["name"] = "Mutated"
    first.append(hospital("Extra"))
    second = await hospitals.nearby_hospitals(30.73349, LNG)
    assert fetch.await_count == 1
    assert len(second) == 1 and second[0]["name"] == "Civil Hospital"
    assert first[0]["distance_km"] == 0
    assert second[0]["distance_km"] == 0.02


async def test_lru_evicts_only_oldest_cell_not_every_neighbourhood(monkeypatch):
    monkeypatch.setattr(hospitals, "_CACHE_MAX", 2)
    fetch = AsyncMock(return_value=([hospital()], True))
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    await hospitals.nearby_hospitals(LAT, LNG)
    await hospitals.nearby_hospitals(LAT + 0.01, LNG)
    await hospitals.nearby_hospitals(LAT, LNG)  # Promote the first cell.
    await hospitals.nearby_hospitals(LAT + 0.02, LNG)
    assert len(hospitals._CACHE) == 2
    assert hospitals._cache_key(LAT, LNG) in hospitals._CACHE
    assert hospitals._cache_key(LAT + 0.01, LNG) not in hospitals._CACHE
    assert fetch.await_count == 3


async def test_ttl_expiry_refreshes_and_sweeps_expired_cells(monkeypatch):
    now = 100.0
    monkeypatch.setattr(hospitals.time, "monotonic", lambda: now)
    fetch = AsyncMock(return_value=([hospital()], True))
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    await hospitals.nearby_hospitals(LAT, LNG)
    now += hospitals._CACHE_TTL_SECONDS - 1
    await hospitals.nearby_hospitals(LAT, LNG)
    assert fetch.await_count == 1
    now += 2
    await hospitals.nearby_hospitals(LAT + 0.01, LNG)
    assert hospitals._cache_key(LAT, LNG) not in hospitals._CACHE
    await hospitals.nearby_hospitals(LAT, LNG)
    assert fetch.await_count == 3


async def test_outage_empty_cache_has_short_ttl_but_verified_empty_has_normal_ttl(monkeypatch):
    now = 100.0
    monkeypatch.setattr(hospitals.time, "monotonic", lambda: now)
    fetch = AsyncMock(side_effect=[([], False), ([], True)])
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    assert await hospitals.nearby_hospitals(LAT, LNG) == []
    now += hospitals._FAILURE_TTL_SECONDS - 1
    assert await hospitals.nearby_hospitals(LAT, LNG) == []
    assert fetch.await_count == 1
    now += 2
    assert await hospitals.nearby_hospitals(LAT, LNG) == []
    now += hospitals._FAILURE_TTL_SECONDS + 1
    assert await hospitals.nearby_hospitals(LAT, LNG) == []
    assert fetch.await_count == 2


async def test_cancelling_one_waiter_does_not_cancel_another(monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()

    async def fetch(*_args):
        entered.set()
        await release.wait()
        return [hospital()], True

    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    first = asyncio.create_task(hospitals.nearby_hospitals(LAT, LNG))
    await entered.wait()
    second = asyncio.create_task(hospitals.nearby_hospitals(LAT, LNG))
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert (await second)[0]["name"] == "Civil Hospital"
    assert hospitals._IN_FLIGHT == {}


async def test_in_flight_budget_rejects_unbounded_new_cells(monkeypatch):
    monkeypatch.setattr(hospitals, "_MAX_IN_FLIGHT", 2)
    entered, release = asyncio.Event(), asyncio.Event()
    starts = 0

    async def fetch(*_args):
        nonlocal starts
        starts += 1
        if starts == 2:
            entered.set()
        await release.wait()
        return [hospital()], True

    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    pending = [asyncio.create_task(hospitals.nearby_hospitals(LAT + delta, LNG)) for delta in (0, 0.01)]
    await entered.wait()
    assert await hospitals.nearby_hospitals(LAT + 0.02, LNG) == []
    assert starts == 2 and len(hospitals._IN_FLIGHT) == 2
    release.set()
    await asyncio.gather(*pending)
    assert hospitals._IN_FLIGHT == {}


async def test_parallel_distinct_cell_fetches_are_semaphore_bounded(monkeypatch):
    monkeypatch.setattr(hospitals, "_UPSTREAM_SLOTS", asyncio.Semaphore(2))
    active = peak = 0

    async def fetch(*_args):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.001)
        active -= 1
        return [hospital()], True

    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    await asyncio.gather(*(hospitals.nearby_hospitals(LAT + i / 100, LNG) for i in range(8)))
    assert peak == 2
    assert hospitals._IN_FLIGHT == {}


async def test_timeout_cancels_shared_work_at_its_total_budget_and_cleans_up(monkeypatch):
    cancelled = asyncio.Event()

    async def fetch(*_args):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    assert await hospitals.nearby_hospitals(LAT, LNG, timeout=0.01) == []
    await asyncio.wait_for(cancelled.wait(), timeout=1)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert hospitals._IN_FLIGHT == {}


@pytest.mark.parametrize("lat,lng,timeout", [(float("nan"), LNG, 1), (LAT, float("inf"), 1), (91, LNG, 1), (LAT, 181, 1), (LAT, LNG, 0)])
async def test_invalid_coordinates_and_budgets_never_call_upstream(monkeypatch, lat, lng, timeout):
    fetch = AsyncMock()
    monkeypatch.setattr(hospitals, "_fetch_hospitals", fetch)
    assert await hospitals.nearby_hospitals(lat, lng, timeout) == []
    fetch.assert_not_awaited()
