"""Local model suggestions must retain evidence; no weights required."""
import pytest
from unittest.mock import MagicMock
import json

from app.services.llm import _is_faithful
from app.services.vision import UNCLEAR, YES, verdict_for
from app.services.ai import triage
from app.services import llm


@pytest.mark.parametrize("source, headline", [
    ("Two people at Gate 3, one injured", "12 people injured at Gate 3"),
    ("३ लोग गेट २ के पास घायल हैं", "५ लोग गेट २ पर घायल"),
    ("No fire; a transformer is throwing sparks", "Fire near the transformer"),
    ("The child is not breathing near Gate 2", "Child breathing near Gate 2"),
    ("कोई आग नहीं है, ट्रांसफार्मर से धुआं है", "ट्रांसफार्मर में आग है"),
    ("Saans nahi aa rahi near gate", "Saans aa rahi near gate"),
    ("Someone is breathing near the temple", "Someone is not breathing near temple"),
])
def test_headline_rejects_invented_numbers_or_changed_negation(source, headline):
    assert not _is_faithful(source, headline)


@pytest.mark.parametrize("source, headline", [
    ("3 people injured near Gate 2; help needed", "3 people injured near Gate 2"),
    ("Child is not breathing near Gate 2 and needs urgent help", "Child is not breathing near Gate 2"),
    ("No fire near Gate 3, only sparks from the transformer", "No fire near Gate 3"),
    ("The transformer is throwing sparks", "Transformer throwing sparks"),
])
def test_headline_accepts_preserved_evidence(source, headline):
    assert _is_faithful(source, headline)


@pytest.mark.parametrize("caption, category", [
    ("There is no fire; a cat is on the sofa", "fire"),
    ("I cannot tell whether this dog is injured", "medical"),
    ("Maybe a fire with smoke", "fire"),
    ("A cat near a transformer", "fire"),
    ("A cylinder near a damaged car after a crash", "gas"),
    ("An injured cat beside a water pipe", "water"),
])
def test_uncertain_or_nonvisual_evidence_never_penalises(caption, category):
    assert verdict_for(caption, category) == UNCLEAR


def test_gas_category_uses_the_gas_leak_concept():
    assert verdict_for("Gas leaking from a cylinder", "gas") == YES


@pytest.mark.parametrize("text", [
    "Which hospital is nearest to sector 22? There is a fire in the house",
    "Which hospital is nearest? A person is injured after an accident",
    "Which hospital is nearest? A gas leak is spreading in the building",
])
def test_information_question_cannot_hide_a_stated_hazard(text):
    assert triage(text).urgency in {"HIGH", "CRITICAL"}


def test_plain_information_question_stays_low():
    assert triage("Which hospital is nearest to sector 22?").urgency == "LOW"


@pytest.mark.parametrize("operation, key", [("_classify_sync", "urgency"), ("_summarise_sync", "headline")])
def test_generation_is_schema_constrained_but_still_validated(monkeypatch, operation, key):
    model = MagicMock()
    model.create_chat_completion.return_value = {"choices": [{"message": {"content": json.dumps({key: "HIGH" if key == "urgency" else "Transformer throwing sparks"})}}]}
    monkeypatch.setattr(llm, "_get_llm", lambda: model)
    getattr(llm, operation)("Transformer throwing sparks")
    schema = model.create_chat_completion.call_args.kwargs["response_format"]["schema"]
    assert schema["required"] == [key]
    assert schema["additionalProperties"] is False
    if key == "urgency":
        assert schema["properties"][key]["enum"] == list(llm.BANDS)
