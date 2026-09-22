"""Photo-evidence verdicts.

`services/photo.py` awards up to 30 points of verified_score for an attached
image, based only on its dimensions and that it decodes. Nothing checked what
the photo was *of*, so a picture of a cat scored exactly like a picture of a
fire — on the one number volunteers read as "several signals agree".

The vision model closes that, but not by being asked to judge. Asked directly
("does this photo show fire? answer yes or no") a 500M model answered "no" to
every image tried, including ones it could caption correctly when simply asked
to. So the model captions — which is what a model that size is good at — and
`verdict_for` decides from the caption.

That split is the reason this file needs no weights: the decision is pure, and
these tests run in CI with no model configured at all.
"""

import pytest

from app.services.vision import (
    CONTRADICTION_PENALTY,
    NO,
    UNCLEAR,
    YES,
    is_enabled,
    review_photos,
    verdict_for,
)


class TestConfirmsAMatchingPhoto:
    @pytest.mark.parametrize(
        "caption,category",
        [
            ("A large fire with flames and smoke coming from a building", "fire"),
            ("Water covering the road, a flood in the street", "flood"),
            ("A car crash with two damaged vehicles", "accident"),
            ("A collapsed wall with rubble and cracks", "structure"),
            ("A dog standing near a gate", "animal"),
        ],
    )
    def test_caption_matching_the_claim_is_yes(self, caption, category):
        assert verdict_for(caption, category) == YES

    def test_works_on_a_caption_in_another_script(self):
        # The concept map is the multilingual one the corroboration path uses,
        # so a caption in Hindi resolves the same way.
        assert verdict_for("एक कुत्ता गली में घायल पड़ा है", "animal") == YES


class TestContradictsAMismatchedPhoto:
    def test_a_cat_photo_on_a_fire_report_is_no(self):
        # The case the whole feature exists for.
        assert verdict_for("A cat sitting on a sofa in a living room", "fire") == NO

    def test_a_fire_photo_on_an_animal_report_is_no(self):
        assert verdict_for("A large fire with flames", "animal") == NO


class TestRefusesToGuess:
    """An unhelpful caption is a fact about the model, not evidence against
    the reporter. Every one of these must be UNCLEAR, never NO — NO is the
    only verdict that costs someone points."""

    @pytest.mark.parametrize(
        "caption",
        [
            "",
            "The image is green in color",
            "A triangle with three different colours on a black background",
            "I cannot tell what this shows",
        ],
    )
    def test_uninformative_captions_are_unclear(self, caption):
        assert verdict_for(caption, "fire") == UNCLEAR

    def test_unknown_category_is_unclear(self):
        assert verdict_for("A large fire with flames", "no_such_category") == UNCLEAR

    def test_violence_is_never_judged(self):
        # Deliberately absent from the category map: asking a small model to
        # rule on whether a photo depicts violence invites both confident
        # nonsense and a class of false accusation this app should not
        # automate. Even a caption that would match must come back UNCLEAR.
        assert verdict_for("Two people fighting in the street", "violence") == UNCLEAR


class TestReviewPhotos:
    async def test_no_photos_costs_nothing(self):
        out = await review_photos([], "fire")
        assert out["penalty"] == 0
        assert out["verdict"] == UNCLEAR

    async def test_disabled_model_costs_nothing(self):
        # No LLM_VISION_MODEL_PATH is configured in the test environment, so
        # this is also a guard that the feature is genuinely opt-in: a
        # deployment without the weights must score photos exactly as before.
        assert not is_enabled()
        out = await review_photos(["data:image/jpeg;base64,AAAA"], "fire")
        assert out["penalty"] == 0

    def test_the_penalty_cannot_erase_a_whole_alert(self):
        # A photo check is one small model looking at one frame. A genuine
        # photo taken in smoke, at night or from far away is a plausible
        # "no", so the penalty stays smaller than the bonus photo.py grants.
        assert 0 < CONTRADICTION_PENALTY < 30
