"""Optional lookup/AI failures and compare-and-set persistence, without Mongo."""

import asyncio
import copy
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.services import enrich


class AlertStore:
    def __init__(self):
        self.doc = {
            "_id": ObjectId(), "reporter_id": ObjectId(),
            "category": "medical", "description": "Door locked, someone inside won't answer " * 4,
            "headline": "Door locked…", "urgency": "MEDIUM",
            "urgency_reason": "keyword:default", "status": "open",
            "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            "address": None, "weather": None, "weather_match": False,
            "verified_score": 68, "witnesses": 6,
            "photos": ["data:image/jpeg;base64,PRIVATE_PHOTO"],
        }
        self.writes = []

    async def find_one(self, *_args):
        return copy.deepcopy(self.doc)

    async def update_one(self, query, update):
        self.writes.append((copy.deepcopy(query), copy.deepcopy(update)))
        if all(self.doc.get(key) == value for key, value in query.items()):
            self.doc.update(update["$set"])
            return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


@pytest.fixture
def runtime(monkeypatch):
    store = AlertStore()
    monkeypatch.setattr(enrich, "reverse_geocode", AsyncMock(return_value=None))
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value=None))
    monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
    monkeypatch.setattr(enrich, "vision_enabled", lambda: True)
    monkeypatch.setattr(enrich, "llm_classify", AsyncMock(return_value="HIGH"))
    monkeypatch.setattr(enrich, "llm_summarise", AsyncMock(return_value="Door locked, no response"))
    monkeypatch.setattr(enrich, "vision_review", AsyncMock(return_value={
        "verdict": "no", "penalty": 20, "finding": "Photo does not match",
    }))
    monkeypatch.setattr(enrich.manager, "broadcast_nearby", AsyncMock())
    return SimpleNamespace(alerts=store)


async def run(db):
    # These stale insert-time counts MUST NOT replace a newer verification score.
    await enrich.enrich_alert(db, db.alerts.doc["_id"], 30.7, 76.7, "medical",
                              witnesses=1, corroborating_count=0, photo_evidence_score=0)


@pytest.mark.parametrize("failing", ["reverse_geocode", "current_weather"])
async def test_lookup_exception_does_not_skip_other_ai_agents(runtime, monkeypatch, failing):
    monkeypatch.setattr(enrich, failing, AsyncMock(side_effect=RuntimeError("provider down")))
    await run(runtime)
    enrich.llm_classify.assert_awaited_once()
    enrich.llm_summarise.assert_awaited_once()
    enrich.vision_review.assert_awaited_once()
    assert runtime.alerts.doc["urgency"] == "HIGH"
    assert runtime.alerts.doc["headline"] == "Door locked, no response"
    assert runtime.alerts.doc["verified_score"] == 48
    assert runtime.alerts.doc["address"] is None


async def test_geocode_timeout_keeps_weather_and_ai_results(runtime, monkeypatch):
    cancelled = asyncio.Event()

    async def slow(*_args, **_kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    weather = {"code": 0, "wind_kph": 0}
    monkeypatch.setattr(enrich, "ENRICH_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(enrich, "reverse_geocode", slow)
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value=weather))
    await run(runtime)
    assert cancelled.is_set()
    assert runtime.alerts.doc["weather"] == weather
    assert runtime.alerts.doc["urgency"] == "HIGH"
    assert runtime.alerts.doc["verified_score"] == 48


async def test_failed_lookups_preserve_existing_address_weather_and_score(runtime, monkeypatch):
    runtime.alerts.doc.update(address="User supplied landmark", weather={"code": 95},
                              weather_match=True, verified_score=81)
    monkeypatch.setattr(enrich, "vision_enabled", lambda: False)
    await run(runtime)
    assert runtime.alerts.doc["address"] == "User supplied landmark"
    assert runtime.alerts.doc["weather"] == {"code": 95}
    assert runtime.alerts.doc["weather_match"] is True
    assert runtime.alerts.doc["verified_score"] == 81
    assert runtime.alerts.doc["urgency"] == "HIGH"


async def test_failed_weather_does_not_undo_witness_or_anonymous_adjustment(runtime, monkeypatch):
    monkeypatch.setattr(enrich, "vision_enabled", lambda: False)
    monkeypatch.setattr(enrich, "reverse_geocode", AsyncMock(return_value="Sector 7"))
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(side_effect=RuntimeError("down")))
    await run(runtime)
    assert runtime.alerts.doc["address"] == "Sector 7"
    assert runtime.alerts.doc["verified_score"] == 68


@pytest.mark.parametrize("changed", [
    {"verified_score": 91, "witnesses": 9},
    {"address": "New user landmark"},
    {"urgency": "CRITICAL", "urgency_reason": "human"},
    {"description": "Updated report", "headline": "Human revised headline"},
    {"photos": [], "category": "fire"},
    {"status": "resolved"},
    {"weather": {"code": 95}, "weather_match": True},
    {"location": {"type": "Point", "coordinates": [77.0, 31.0]}},
])
async def test_concurrent_user_updates_are_not_overwritten(runtime, monkeypatch, changed):
    async def change_during_lookup(*_args, **_kwargs):
        runtime.alerts.doc.update(copy.deepcopy(changed))
        return "Stale lookup address"

    monkeypatch.setattr(enrich, "reverse_geocode", change_during_lookup)
    await run(runtime)
    for key, value in changed.items():
        assert runtime.alerts.doc[key] == value
    assert runtime.alerts.doc.get("headline_source") != "llm", "reject stale AI batch"


@pytest.mark.parametrize("failing", ["llm_classify", "llm_summarise", "vision_review"])
async def test_optional_ai_failure_is_isolated_and_logs_no_content(runtime, monkeypatch, caplog, failing):
    private = "PRIVATE_REPORT_HEADLINE_PHOTO"
    monkeypatch.setattr(enrich, failing, AsyncMock(side_effect=RuntimeError(private)))
    monkeypatch.setattr(enrich, "reverse_geocode", AsyncMock(return_value="Sector 7"))
    with caplog.at_level(logging.INFO):
        await run(runtime)
    assert runtime.alerts.doc["address"] == "Sector 7"
    assert private not in caplog.text
    for name in ("llm_classify", "llm_summarise", "vision_review"):
        getattr(enrich, name).assert_awaited_once()


async def test_headline_success_logs_no_headline(runtime, caplog):
    with caplog.at_level(logging.INFO):
        await run(runtime)
    assert "Door locked, no response" not in caplog.text


@pytest.mark.parametrize("penalty", [-20, True, "20", 1000])
async def test_invalid_photo_penalty_never_increases_or_erases_score(runtime, monkeypatch, penalty):
    monkeypatch.setattr(enrich, "vision_review", AsyncMock(return_value={
        "verdict": "no", "penalty": penalty, "finding": "x",
    }))
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 68


async def test_confirmed_photo_cannot_subtract_even_with_malformed_penalty(runtime, monkeypatch):
    monkeypatch.setattr(enrich, "vision_review", AsyncMock(return_value={
        "verdict": "yes", "penalty": 20, "finding": "x",
    }))
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 68


async def test_partial_photo_review_cannot_leave_a_partial_penalty(runtime, monkeypatch):
    monkeypatch.setattr(enrich, "vision_review", AsyncMock(return_value={
        "verdict": "no", "penalty": 20,
    }))
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 68
    assert "photo_verdict" not in runtime.alerts.doc


async def test_existing_photo_penalty_is_not_applied_twice(runtime):
    runtime.alerts.doc.update(verified_score=48, photo_verdict="no")
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 48
    enrich.vision_review.assert_not_awaited()


async def test_resolved_alert_is_not_enriched(runtime):
    runtime.alerts.doc["status"] = "resolved"
    await run(runtime)
    assert runtime.alerts.writes == []
    enrich.llm_classify.assert_not_awaited()


@pytest.mark.parametrize("component", ["read", "write", "broadcast"])
async def test_persistence_or_broadcast_failure_logs_no_input(runtime, monkeypatch, caplog, component):
    private = "PRIVATE_DB_OR_BROADCAST_INPUT"
    if component == "read":
        monkeypatch.setattr(runtime.alerts, "find_one", AsyncMock(side_effect=RuntimeError(private)))
    elif component == "write":
        monkeypatch.setattr(runtime.alerts, "update_one", AsyncMock(side_effect=RuntimeError(private)))
    else:
        monkeypatch.setattr(enrich.manager, "broadcast_nearby", AsyncMock(side_effect=RuntimeError(private)))
    with caplog.at_level(logging.INFO):
        await run(runtime)
    assert private not in caplog.text


async def test_invalid_weather_does_not_block_other_agents(runtime, monkeypatch):
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value={"code": 95}))
    monkeypatch.setattr(enrich, "supports_category", lambda *_: (_ for _ in ()).throw(ValueError("bad weather")))
    await run(runtime)
    assert runtime.alerts.doc["urgency"] == "HIGH"
    assert runtime.alerts.doc["weather"] is None
    assert runtime.alerts.doc["verified_score"] == 48


async def test_weather_bonus_is_added_once_without_recomputing_existing_score(runtime, monkeypatch):
    monkeypatch.setattr(enrich, "vision_enabled", lambda: False)
    monkeypatch.setattr(enrich, "current_weather", AsyncMock(return_value={"code": 95}))
    monkeypatch.setattr(enrich, "supports_category", lambda *_: True)
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 88
    await run(runtime)
    assert runtime.alerts.doc["verified_score"] == 88


async def test_caller_cancellation_is_not_swallowed(runtime, monkeypatch):
    started = asyncio.Event()

    async def block(*_args, **_kwargs):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(enrich, "reverse_geocode", block)
    task = asyncio.create_task(run(runtime))
    await asyncio.wait_for(started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert runtime.alerts.writes == []
