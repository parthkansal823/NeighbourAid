"""Adversarial regressions: retrieval/attachments must not manufacture truth."""
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId
import pytest

from app.services import verification as v, vision


@pytest.mark.parametrize("a,b", [
    ("Fire in the market", "Fire near the school"),
    ("Fire near Gate 3 of the building", "Fire near Gate 4 of the building"),
    ("गेट ३ के पास आग लगी है", "Fire near Gate 4"),
    ("", "Fire near Gate 3"),
    ("Fire near the market", "बाजार के पास आग लगी है"),
])
def test_uncertain_or_conflicting_locations_do_not_hide_a_report(a, b):
    assert not v.same_incident(a, b)


def test_numbered_location_matches_across_scripts():
    assert v.same_incident("Fire near Gate 3", "गेट ३ के पास आग लगी है")


def test_one_author_cannot_supply_several_independent_reports():
    own, other = ObjectId(), ObjectId()
    text = "Fire near Gate 3"
    candidates = [
        {"reporter_id": own, "description": text},
        {"reporter_id": other, "description": text},
        {"reporter_id": other, "description": text},
        {"reporter_id": ObjectId(), "description": text, "is_anonymous": True},
    ]
    assert v.filter_corroborating(text, candidates, reporter_id=str(own)) == [candidates[1]]


@pytest.mark.parametrize("is_drill,expected", [(False, {"$ne": True}), (True, True)])
async def test_practice_and_real_incidents_never_corroborate(is_drill, expected):
    class Cursor:
        def __aiter__(self):
            return self
        async def __anext__(self):
            raise StopAsyncIteration
    db = MagicMock()
    db.alerts.find.return_value = Cursor()
    await v.find_corroborating_alerts(db, "fire", [76.7, 30.7], is_drill=is_drill)
    assert db.alerts.find.call_args.args[0]["is_drill"] == expected


def test_score_retains_photo_and_anonymity_penalties_after_a_witness():
    doc = dict(witnesses=4, photo_evidence_score=12, is_anonymous=True, photo_verdict="no")
    assert v.score_for_alert(doc) == 14  # 32 + 12 - 10 - 20
    doc["via"] = "whatsapp"
    assert v.score_for_alert(doc) == 19
    assert v.score_for_alert(dict(witnesses=99, photo_evidence_score=1000, weather_match=True,
                                 corroborating_ids=list(range(99)))) == 100
    assert v.compute_verified_score(-5, -3, False) == 0
    saturated = dict(witnesses=99, corroborating_ids=[1] * 99, photo_evidence_score=30,
                     weather_match=True, photo_verdict="no", is_anonymous=True)
    assert v.score_for_alert(saturated) == 70
    assert v.score_ceiling(saturated) == 70


async def test_concurrent_ai_penalty_is_reread_not_overwritten():
    doc = dict(_id=ObjectId(), witnesses=4, photo_evidence_score=12, verified_score=44)
    latest = {**doc, "photo_verdict": "no", "verified_score": 24}
    db = MagicMock()
    db.alerts.find_one_and_update = AsyncMock(side_effect=[None, latest])
    db.alerts.find_one = AsyncMock(return_value=latest)
    result = await v.refresh_score(db, doc)
    calls = db.alerts.find_one_and_update.call_args_list
    assert calls[0].args[0]["photo_verdict"] is None
    assert calls[1].args[0]["photo_verdict"] == "no"
    assert calls[1].args[1]["$set"]["verified_score"] == 24
    assert result == latest


def test_public_explanation_is_not_a_probability_or_a_user_list():
    out = v.evidence_summary(dict(witnesses=1, witnessed_by=["private-id"], photo_evidence_score=12))
    assert out["independent_witnesses"] == 0
    assert out["fact_checked"] is False
    assert "private-id" not in str(out)
    assert out["photo_review"] == "not_checked"


@pytest.mark.parametrize("verdicts,expected,penalty", [
    (["no", "yes"], "unclear", 0),
    (["no", "unclear"], "unclear", 0),
    (["yes", "yes"], "yes", 0),
    (["no", "no"], "no", vision.CONTRADICTION_PENALTY),
])
async def test_photo_order_does_not_turn_a_mixed_scene_into_a_penalty(monkeypatch, verdicts, expected, penalty):
    monkeypatch.setattr(vision, "is_enabled", lambda: True)
    check = AsyncMock(side_effect=verdicts)
    monkeypatch.setattr(vision, "check_photo", check)
    out = await vision.review_photos(["photo1", "photo2"], "fire")
    assert out["verdict"] == expected
    assert out["penalty"] == penalty
    assert check.await_count == 2
