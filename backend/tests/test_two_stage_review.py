"""Two-stage local-model admission is conservative and server-authoritative."""

import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.services import review


class AlertStore:
    def __init__(self, *, urgency="MEDIUM", status="pending_first_review", visibility="held"):
        self.doc = {
            "_id": ObjectId(),
            "description": "Water pipe has burst across the lane; traffic is blocked.",
            "urgency": urgency,
            "status": "open",
            "review_status": status,
            "review_visibility": visibility,
            "first_review_status": "pending",
            "second_review_status": "not_started",
            "location": {"type": "Point", "coordinates": [76.78, 30.73]},
        }
        self.writes = []

    async def find_one(self, query, *_args, **_kwargs):
        if query.get("_id") != self.doc["_id"]:
            return None
        return copy.deepcopy(self.doc)

    async def update_one(self, query, update):
        self.writes.append((copy.deepcopy(query), copy.deepcopy(update)))
        matched = all(self.doc.get(key) == value for key, value in query.items())
        if matched:
            self.doc.update(update["$set"])
        return SimpleNamespace(matched_count=int(matched))


@pytest.fixture
def runtime(monkeypatch):
    store = AlertStore()
    monkeypatch.setattr(review, "_broadcast_public", AsyncMock())
    monkeypatch.setattr(review, "_broadcast_restriction", AsyncMock())
    return SimpleNamespace(alerts=store)


def test_initial_fields_only_gate_when_the_first_server_model_is_available(monkeypatch):
    monkeypatch.setattr(review, "first_review_enabled", lambda: False)
    assert review.initial_review_fields("MEDIUM") == {}

    monkeypatch.setattr(review, "first_review_enabled", lambda: True)
    assert review.initial_review_fields("MEDIUM") == {
        "review_status": "pending_first_review",
        "review_visibility": "held",
        "first_review_status": "pending",
        "second_review_status": "not_started",
    }
    assert review.initial_review_fields("CRITICAL")["review_visibility"] == "public"


async def test_first_approval_publishes_then_second_model_marks_reviewed(runtime, monkeypatch):
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="APPROVE"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: True)
    monkeypatch.setattr(review, "verify", AsyncMock(return_value="REVIEWED"))

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "reviewed"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["first_review_status"] == "approved"
    assert runtime.alerts.doc["second_review_status"] == "reviewed"
    assert review._broadcast_public.await_count == 2
    assert review._broadcast_public.await_args_list[0].kwargs == {"created": True}
    review._broadcast_restriction.assert_not_awaited()


async def test_second_model_can_restrict_only_non_emergencies(runtime, monkeypatch):
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="APPROVE"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: True)
    monkeypatch.setattr(review, "verify", AsyncMock(return_value="RESTRICT"))

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "restricted"
    assert runtime.alerts.doc["review_visibility"] == "restricted"
    review._broadcast_restriction.assert_awaited_once()


async def test_second_model_never_hides_a_critical_alert(runtime, monkeypatch):
    runtime.alerts.doc.update(
        urgency="CRITICAL",
        review_status="provisional",
        review_visibility="public",
    )
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="APPROVE"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: True)
    monkeypatch.setattr(review, "verify", AsyncMock(return_value="RESTRICT"))

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "needs_review"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["second_review_status"] == "restricted_emergency_override"
    review._broadcast_restriction.assert_not_awaited()


async def test_first_pass_doubt_gets_a_stronger_rescue_review(runtime, monkeypatch):
    """A small model false-negative cannot permanently bury a civic report."""
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="NEEDS_REVIEW"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: True)
    monkeypatch.setattr(review, "verify", AsyncMock(return_value="REVIEWED"))

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "reviewed"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["first_review_status"] == "needs_review"
    assert runtime.alerts.doc["second_review_status"] == "reviewed"
    review._broadcast_public.assert_awaited_once()
    assert review._broadcast_public.await_args.kwargs == {"created": True}


async def test_held_report_fails_open_when_the_second_model_is_unavailable(runtime, monkeypatch):
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="NEEDS_REVIEW"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: True)
    monkeypatch.setattr(review, "verify", AsyncMock(return_value=None))

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "unreviewed"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["second_review_status"] == "unavailable"
    review._broadcast_public.assert_awaited_once()


async def test_first_pass_doubt_is_visible_when_no_stronger_model_is_configured(runtime, monkeypatch):
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value="NEEDS_REVIEW"))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: False)

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "needs_review"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["second_review_status"] == "not_configured"
    review._broadcast_public.assert_awaited_once()


async def test_missing_or_timed_out_first_model_fails_open(runtime, monkeypatch):
    monkeypatch.setattr(review, "first_review", AsyncMock(return_value=None))
    monkeypatch.setattr(review, "verifier_is_enabled", lambda: False)

    await review.run_two_stage_review(runtime, runtime.alerts.doc["_id"])

    assert runtime.alerts.doc["review_status"] == "unreviewed"
    assert runtime.alerts.doc["review_visibility"] == "public"
    assert runtime.alerts.doc["first_review_status"] == "unavailable"
    review._broadcast_public.assert_awaited_once()


async def test_transition_does_not_claim_a_compare_and_set_race(runtime):
    stale = copy.deepcopy(runtime.alerts.doc)
    runtime.alerts.doc["review_status"] = "reviewed"

    updated = await review._store_transition(
        runtime,
        stale,
        {"review_status": "approved", "review_visibility": "public"},
    )

    assert updated is None
    assert runtime.alerts.doc["review_status"] == "reviewed"
