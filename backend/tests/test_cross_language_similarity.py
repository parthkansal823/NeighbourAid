"""Cross-language duplicate detection.

`similarity()` used to be character 4-gram overlap alone. Inside one language
that works well; across scripts it scores exactly 0.000, because "Fire near
Gate 3" and "गेट 3 के पास आग लगी है" share no 4-gram at all.

That mattered because `filter_corroborating` narrows candidates with this
score. In a city where one fire gets reported in Hindi, English and Punjabi,
the three reports never corroborated each other — verified_score stayed flat
and volunteers saw three unrelated alerts instead of one confirmed emergency.
In an app shipping eight languages, the reports most likely to be about the
same incident were the ones guaranteed never to match.

These tests pin both directions. The false-positive half matters as much as
the true-positive half: a concept map that matches too loosely inflates a
score volunteers use to decide what to believe.
"""

from app.services.ai import concepts_in, is_duplicate, similarity
from app.services.verification import CORROBORATE_SIMILARITY_MIN, filter_corroborating

# One fire at one gate, as three different people would report it.
FIRE_EN = "Fire near Gate 3 of the building"
FIRE_HINGLISH = "aag gate 3 ke paas building mein"
FIRE_HI = "गेट 3 के पास आग लगी है"

MEDICAL_EN = "Man collapsed near the market, not breathing"
MEDICAL_HI = "बाजार के पास आदमी बेहोश, सांस नहीं"

# Deliberately unrelated to any of the above.
MISSING_EN = "Child lost at the vegetable market"
POWER_EN = "Power cut in our lane since morning"


class TestSameIncidentAcrossScripts:
    def test_english_and_hinglish_fire_corroborate(self):
        assert similarity(FIRE_EN, FIRE_HINGLISH) >= CORROBORATE_SIMILARITY_MIN

    def test_english_and_devanagari_fire_corroborate(self):
        # The case that scored 0.000 before: no shared characters at all.
        assert similarity(FIRE_EN, FIRE_HI) >= CORROBORATE_SIMILARITY_MIN

    def test_english_and_devanagari_medical_corroborate(self):
        assert similarity(MEDICAL_EN, MEDICAL_HI) >= CORROBORATE_SIMILARITY_MIN

    def test_symmetric(self):
        assert similarity(FIRE_EN, FIRE_HI) == similarity(FIRE_HI, FIRE_EN)


class TestDifferentIncidentsStayApart:
    """The half that keeps the feature honest. A false corroboration is worse
    than a missed one: it raises a confidence score that a volunteer reads as
    'several people have confirmed this'."""

    def test_fire_does_not_corroborate_a_missing_child(self):
        assert similarity(FIRE_EN, MISSING_EN) < CORROBORATE_SIMILARITY_MIN

    def test_medical_does_not_corroborate_a_power_cut(self):
        assert similarity(MEDICAL_EN, POWER_EN) < CORROBORATE_SIMILARITY_MIN

    def test_across_scripts_too(self):
        assert similarity(FIRE_HI, "बाजार में बच्चा खो गया") < CORROBORATE_SIMILARITY_MIN

    def test_filter_corroborating_still_drops_unrelated(self):
        # The regression this whole filter exists for, re-checked through the
        # new scoring path rather than through similarity() directly.
        kept = filter_corroborating(
            MEDICAL_EN,
            [{"description": MISSING_EN}, {"description": POWER_EN}],
        )
        assert kept == []

    def test_filter_corroborating_keeps_the_same_fire_in_another_language(self):
        kept = filter_corroborating(
            FIRE_EN, [{"description": FIRE_HI}, {"description": POWER_EN}]
        )
        assert len(kept) == 1
        assert kept[0]["description"] == FIRE_HI


class TestConceptExtraction:
    def test_recognises_the_same_concept_in_several_scripts(self):
        for text in (FIRE_EN, FIRE_HINGLISH, FIRE_HI):
            assert "fire" in concepts_in(text), text

    def test_returns_empty_for_text_naming_no_known_incident(self):
        assert concepts_in("just checking in, all quiet here") == frozenset()

    def test_empty_concepts_do_not_manufacture_a_match(self):
        # Two reports that name no concept must fall back to the character
        # score, not score 1.0 for sharing an empty set.
        assert similarity("all quiet here", "nothing to report") < CORROBORATE_SIMILARITY_MIN


class TestExistingBehaviourPreserved:
    """max() of the two signals can only raise a score, so anything that
    matched before must still match."""

    def test_same_language_rewording_still_matches(self):
        assert similarity(FIRE_EN, "There is a fire near gate 3 in the building") >= (
            CORROBORATE_SIMILARITY_MIN
        )

    def test_empty_input_is_zero(self):
        assert similarity("", FIRE_EN) == 0.0
        assert similarity(FIRE_EN, "") == 0.0

    def test_identical_text_is_one(self):
        assert similarity(FIRE_EN, FIRE_EN) == 1.0

    def test_is_duplicate_still_requires_a_high_bar(self):
        # is_duplicate uses 0.55, well above the corroboration threshold, so
        # a shared concept alone must not be enough to call two reports the
        # same submission.
        assert not is_duplicate(FIRE_EN, "Fire at the school on the other side of town")
