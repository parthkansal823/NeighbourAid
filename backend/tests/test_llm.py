"""Optional local LLM: gating, direction, and inertness when off.

The whole design rests on this being *additive*. The keyword classifier is
the floor and must keep working on a 512 MB host with no model, no
llama-cpp-python and no GPU. Every test here protects that.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import llm
from app.services.enrich import _maybe_upgrade_urgency


def test_disabled_when_no_model_path_is_set(monkeypatch):
    """The default on every host this project targets."""
    from app.core import config

    monkeypatch.setattr(config.settings, "LLM_MODEL_PATH", "", raising=False)
    assert llm.is_enabled() is False


def test_disabled_when_the_path_points_at_nothing(monkeypatch):
    """A typo in the env var must degrade, not crash on first alert."""
    from app.core import config

    monkeypatch.setattr(config.settings, "LLM_MODEL_PATH", "/no/such/model.gguf",
                        raising=False)
    assert llm.is_enabled() is False


@pytest.mark.asyncio
async def test_classify_returns_none_when_disabled(monkeypatch):
    monkeypatch.setattr(llm, "is_enabled", lambda: False)
    assert await llm.classify("anything") is None


@pytest.mark.asyncio
async def test_not_consulted_when_the_classifier_matched_something(monkeypatch):
    """The gate. Keywords and patterns are more accurate than the model on
    reports they can read, so the model is not asked about them — and the
    seconds it costs are not spent."""
    monkeypatch.setattr("app.services.enrich.llm_enabled", lambda: True)
    called = False

    async def _spy(_text):
        nonlocal called
        called = True
        return "CRITICAL"

    monkeypatch.setattr("app.services.enrich.llm_classify", _spy)
    db = MagicMock()
    db.alerts.find_one = AsyncMock(return_value={
        "description": "unconscious, not breathing",
        "urgency": "CRITICAL",
        "urgency_reason": "keyword:critical",   # classifier was confident
    })
    update = {}
    await _maybe_upgrade_urgency(db, "id", update)
    assert called is False
    assert update == {}


@pytest.mark.asyncio
async def test_consulted_only_on_keyword_default(monkeypatch):
    """`keyword:default` is the classifier saying it matched nothing — the
    implied-danger case the model is measurably better at."""
    monkeypatch.setattr("app.services.enrich.llm_enabled", lambda: True)
    monkeypatch.setattr("app.services.enrich.llm_classify",
                        AsyncMock(return_value="CRITICAL"))
    db = MagicMock()
    db.alerts.find_one = AsyncMock(return_value={
        "description": "closed garage, engine running, he won't answer",
        "urgency": "MEDIUM",
        "urgency_reason": "keyword:default",
    })
    update = {}
    await _maybe_upgrade_urgency(db, "id", update)
    assert update["urgency"] == "CRITICAL"
    assert update["urgency_reason"] == "llm:implied"


@pytest.mark.asyncio
async def test_can_raise_urgency_but_never_lower_it(monkeypatch):
    """One-directional on purpose.

    Measured alone the model scores worse than the classifier overall, mostly
    by moving labels around confidently. Letting it downgrade would risk
    burying a real emergency on the weaker engine's say-so.
    """
    monkeypatch.setattr("app.services.enrich.llm_enabled", lambda: True)
    monkeypatch.setattr("app.services.enrich.llm_classify",
                        AsyncMock(return_value="LOW"))
    db = MagicMock()
    db.alerts.find_one = AsyncMock(return_value={
        "description": "something ambiguous",
        "urgency": "MEDIUM",
        "urgency_reason": "keyword:default",
    })
    update = {}
    await _maybe_upgrade_urgency(db, "id", update)
    assert update == {}, "the model must not be able to downgrade an alert"


@pytest.mark.asyncio
async def test_a_failing_model_leaves_the_alert_untouched(monkeypatch):
    monkeypatch.setattr("app.services.enrich.llm_enabled", lambda: True)
    monkeypatch.setattr("app.services.enrich.llm_classify",
                        AsyncMock(return_value=None))
    db = MagicMock()
    db.alerts.find_one = AsyncMock(return_value={
        "description": "x", "urgency": "MEDIUM", "urgency_reason": "keyword:default",
    })
    update = {}
    await _maybe_upgrade_urgency(db, "id", update)
    assert update == {}


@pytest.mark.asyncio
async def test_does_nothing_at_all_when_disabled(monkeypatch):
    """No model configured must mean no database read either — this runs on
    every alert, and the default deploy has no model."""
    monkeypatch.setattr("app.services.enrich.llm_enabled", lambda: False)
    db = MagicMock()
    db.alerts.find_one = AsyncMock()
    update = {}
    await _maybe_upgrade_urgency(db, "id", update)
    db.alerts.find_one.assert_not_awaited()
    assert update == {}


def test_llama_cpp_is_not_a_shipped_dependency():
    """It must stay out of requirements.txt.

    The free hosts this targets have 512 MB; a 7B model needs ~5 GB. Adding
    it there would break the deploy that actually works, to enable one that
    cannot run.
    """
    import pathlib

    req = pathlib.Path(__file__).resolve().parents[1] / "requirements.txt"
    text = req.read_text(encoding="utf-8").lower()
    for pkg in ("llama-cpp-python", "llama_cpp", "torch", "transformers"):
        assert pkg not in text, f"{pkg} must not be in requirements.txt"
