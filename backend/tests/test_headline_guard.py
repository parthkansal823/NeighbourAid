"""The faithfulness guard on LLM-written headlines.

The model is asked for a scannable one-liner and usually gives a good one:

    "hello hello can you hear me yes so there is my neighbour uncle he fell
     down in the bathroom and he is not getting up and we cannot open the
     door it is locked from inside"
        -> "Uncle Fell, Door Locked"

The prompt also tells it to invent nothing and to answer in the report's own
language. A 1B model does not reliably obey either instruction, and both
failures happened on real input during development:

  * A transformer throwing sparks and making a loud noise came back as
    "Transformer Sparks Fire in Local Area". There is no fire in that report.
    On a dispatch card that word changes what a volunteer brings and who they
    call on the way.
  * A Devanagari report came back with an English headline, leaving the
    reporter unable to read their own alert.

So the model proposes and a cheap deterministic check disposes. These tests
pin the check, not the model — they run with no model loaded, because the
guard is pure and must keep working whatever weights are configured.
"""

from app.services.llm import _is_faithful


SPARKS_HI = "गली के कोने वाले ट्रांसफार्मर से तेज आवाज आ रही है और चिंगारी निकल रही है"
SPARKS_EN = "The transformer at the corner is making a loud noise and throwing sparks"
FLOOD_EN = (
    "water is coming up near the temple steps and it keeps rising and people "
    "are worried it might come into the houses"
)


class TestRejectsInventedDetail:
    def test_rejects_a_fire_that_the_report_never_mentioned(self):
        # The exact regression: sparks and noise became "Fire".
        assert not _is_faithful(SPARKS_EN, "Transformer Sparks Fire in Local Area")

    def test_rejects_an_invented_medical_emergency(self):
        assert not _is_faithful(FLOOD_EN, "Man unconscious near temple steps")

    def test_rejects_escalation_to_collapse(self):
        assert not _is_faithful(FLOOD_EN, "Building collapse near the temple")


class TestAcceptsFaithfulHeadlines:
    def test_accepts_a_headline_that_only_compresses(self):
        assert _is_faithful(FLOOD_EN, "Water rising near temple steps, may enter houses")

    def test_accepts_when_the_headline_names_no_concept_at_all(self):
        # Naming fewer concepts than the report is fine — that is summarising.
        assert _is_faithful(FLOOD_EN, "Situation worsening near the temple")

    def test_accepts_a_concept_the_report_does_name(self):
        assert _is_faithful(SPARKS_EN, "Transformer throwing sparks at the corner")


class TestRejectsLanguageDrift:
    def test_rejects_an_english_headline_for_a_devanagari_report(self):
        # The reporter must be able to read their own alert.
        assert not _is_faithful(SPARKS_HI, "Transformer throwing sparks at the corner")

    def test_accepts_a_devanagari_headline_for_a_devanagari_report(self):
        assert _is_faithful(SPARKS_HI, "ट्रांसफार्मर से चिंगारी निकल रही है")

    def test_accepts_english_for_an_english_report(self):
        assert _is_faithful(SPARKS_EN, "Transformer throwing sparks at the corner")


class TestGuardIsIndependentOfTheModel:
    def test_runs_with_no_model_configured(self):
        # Imported and exercised above with LLM_MODEL_PATH unset; if the guard
        # ever grows a dependency on a loaded model this fails loudly rather
        # than silently letting every headline through.
        from app.services import llm

        assert not llm.is_enabled()
        assert _is_faithful(SPARKS_EN, "Transformer throwing sparks at the corner")
