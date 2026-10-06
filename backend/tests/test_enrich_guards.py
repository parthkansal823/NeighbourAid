"""Background enrichment — the three model-driven changes it can make.

After an alert is broadcast, enrichment runs and may do three things the
volunteer will see: raise the urgency, rewrite the headline, and take back
photo credit. Each one is guarded, and the guards are the part worth testing
because each is one-directional by design:

  * urgency may be RAISED, never lowered
  * a headline is replaced only where truncation lost information, and only
    if it says nothing the report did not
  * photo evidence may be SUBTRACTED, never added

Those directions are not stylistic. The model is the weaker judge in every
one of these, so each guard points the failure at the recoverable side.

None of this needs weights. `llm_enabled()` and `vision_enabled()` are false
with no model configured, which is the state CI runs in, so the tests drive
the helpers directly with the enable check patched.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from bson import ObjectId

import app.services.enrich as enrich


@pytest.fixture
def db():
    d = MagicMock()
    d.alerts.find_one = AsyncMock(return_value=None)
    d.alerts.update_one = AsyncMock()
    return d


class TestUrgencyUpgrade:
    """`_maybe_upgrade_urgency` — asked only where the classifier admitted it
    was guessing, and allowed only to move the answer up."""

    async def test_skipped_entirely_with_no_model(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "llm_enabled", lambda: False)
        update = {}
        await enrich._maybe_upgrade_urgency(db, ObjectId(), update)
        assert update == {}
        db.alerts.find_one.assert_not_awaited()

    async def test_only_consults_the_model_on_a_classifier_guess(
        self, db, monkeypatch
    ):
        # `keyword:default` is the classifier saying so explicitly: no
        # pattern, no keyword in any of eight languages. Anywhere else it has
        # a real answer and the model is the weaker of the two.
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        called = False

        async def _classify(_text):
            nonlocal called
            called = True
            return "CRITICAL"

        monkeypatch.setattr(enrich, "llm_classify", _classify)
        db.alerts.find_one = AsyncMock(
            return_value={
                "description": "fire near gate 3",
                "urgency": "HIGH",
                "urgency_reason": "keyword:high",
            }
        )
        update = {}
        await enrich._maybe_upgrade_urgency(db, ObjectId(), update)
        assert not called
        assert update == {}

    async def test_raises_urgency_on_implied_danger(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        monkeypatch.setattr(enrich, "llm_classify", AsyncMock(return_value="HIGH"))
        db.alerts.find_one = AsyncMock(
            return_value={
                "description": "water is rising near the temple steps",
                "urgency": "MEDIUM",
                "urgency_reason": "keyword:default",
            }
        )
        update = {}
        await enrich._maybe_upgrade_urgency(db, ObjectId(), update)
        assert update["urgency"] == "HIGH"
        assert update["urgency_reason"] == "llm:implied"

    @pytest.mark.parametrize("band", ["LOW", "MEDIUM"])
    async def test_never_lowers_an_urgency(self, db, monkeypatch, band):
        """The guard that matters most.

        Measured alone the model scores worse than the classifier overall,
        largely by moving things around confidently. Letting it downgrade
        would risk burying a real emergency on the strength of the engine we
        know is weaker at this.
        """
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        monkeypatch.setattr(enrich, "llm_classify", AsyncMock(return_value=band))
        db.alerts.find_one = AsyncMock(
            return_value={
                "description": "something happened",
                "urgency": "MEDIUM",
                "urgency_reason": "keyword:default",
            }
        )
        update = {}
        await enrich._maybe_upgrade_urgency(db, ObjectId(), update)
        assert "urgency" not in update

    async def test_a_model_that_cannot_answer_changes_nothing(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        monkeypatch.setattr(enrich, "llm_classify", AsyncMock(return_value=None))
        db.alerts.find_one = AsyncMock(
            return_value={
                "description": "x",
                "urgency": "MEDIUM",
                "urgency_reason": "keyword:default",
            }
        )
        update = {}
        await enrich._maybe_upgrade_urgency(db, ObjectId(), update)
        assert update == {}


class TestHeadlineImprovement:
    async def test_skipped_with_no_model(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "llm_enabled", lambda: False)
        update = {}
        await enrich._maybe_improve_headline(db, ObjectId(), update)
        assert update == {}

    async def test_only_rewrites_a_headline_that_was_truncated(
        self, db, monkeypatch
    ):
        # A description that already fits IS its own headline. Asking a model
        # to shorten it can only lose detail or invent some.
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        called = False

        async def _summarise(_text):
            nonlocal called
            called = True
            return "rewritten"

        monkeypatch.setattr(enrich, "llm_summarise", _summarise)
        db.alerts.find_one = AsyncMock(
            return_value={"description": "Short report", "headline": "Short report"}
        )
        update = {}
        await enrich._maybe_improve_headline(db, ObjectId(), update)
        assert not called
        assert update == {}

    async def test_rewrites_when_the_headline_ends_in_an_ellipsis(
        self, db, monkeypatch
    ):
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        monkeypatch.setattr(
            enrich, "llm_summarise", AsyncMock(return_value="Uncle Fell, Door Locked")
        )
        db.alerts.find_one = AsyncMock(
            return_value={
                "description": "hello hello can you hear me yes so there is my "
                "neighbour uncle he fell down in the bathroom",
                "headline": "hello hello can you hear me yes so there is my…",
            }
        )
        update = {}
        await enrich._maybe_improve_headline(db, ObjectId(), update)
        assert update["headline"] == "Uncle Fell, Door Locked"
        assert update["headline_source"] == "llm"

    async def test_a_rejected_headline_leaves_the_original(self, db, monkeypatch):
        # llm.summarise returns None when its faithfulness guard rejects the
        # answer — an invented concept, or the wrong script.
        monkeypatch.setattr(enrich, "llm_enabled", lambda: True)
        monkeypatch.setattr(enrich, "llm_summarise", AsyncMock(return_value=None))
        db.alerts.find_one = AsyncMock(
            return_value={"description": "x" * 200, "headline": "x" * 88 + "…"}
        )
        update = {}
        await enrich._maybe_improve_headline(db, ObjectId(), update)
        assert "headline" not in update


class TestPhotoPenalty:
    async def test_skipped_with_no_vision_model(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "vision_enabled", lambda: False)
        update = {}
        out = await enrich._maybe_penalise_photo(db, ObjectId(), "fire", update, 70)
        assert out == 70
        assert update == {}

    async def test_no_photos_means_nothing_to_check(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "vision_enabled", lambda: True)
        db.alerts.find_one = AsyncMock(return_value={"photos": []})
        update = {}
        assert await enrich._maybe_penalise_photo(db, ObjectId(), "fire", update, 70) == 70
        assert update == {}

    async def test_a_confirmation_earns_nothing(self, db, monkeypatch):
        """Deliberately one-directional.

        A false 'yes' would hand an attacker exactly what they wanted — a
        model vouching for a fake photo — and the score would then carry
        false authority. A false 'no' only costs an honest reporter part of
        a bonus they got for attaching any image at all.
        """
        monkeypatch.setattr(enrich, "vision_enabled", lambda: True)
        monkeypatch.setattr(
            enrich,
            "vision_review",
            AsyncMock(return_value={"verdict": "yes", "penalty": 0, "finding": ""}),
        )
        db.alerts.find_one = AsyncMock(return_value={"photos": ["data:image/jpeg;base64,x"]})
        update = {}
        assert await enrich._maybe_penalise_photo(db, ObjectId(), "fire", update, 70) == 70
        assert "verified_score" not in update

    async def test_a_contradiction_subtracts(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "vision_enabled", lambda: True)
        monkeypatch.setattr(
            enrich,
            "vision_review",
            AsyncMock(
                return_value={
                    "verdict": "no",
                    "penalty": 20,
                    "finding": "Attached photo does not appear to show the reported incident.",
                }
            ),
        )
        db.alerts.find_one = AsyncMock(return_value={"photos": ["data:image/jpeg;base64,x"]})
        update = {}
        out = await enrich._maybe_penalise_photo(db, ObjectId(), "fire", update, 70)
        assert out == 50
        assert update["verified_score"] == 50
        assert update["photo_verdict"] == "no"

    async def test_the_score_never_goes_negative(self, db, monkeypatch):
        monkeypatch.setattr(enrich, "vision_enabled", lambda: True)
        monkeypatch.setattr(
            enrich,
            "vision_review",
            AsyncMock(return_value={"verdict": "no", "penalty": 20, "finding": "x"}),
        )
        db.alerts.find_one = AsyncMock(return_value={"photos": ["data:image/jpeg;base64,x"]})
        update = {}
        out = await enrich._maybe_penalise_photo(db, ObjectId(), "fire", update, 5)
        assert out == 0
        assert update["verified_score"] == 0
