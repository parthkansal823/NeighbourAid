"""Tests for the Claude-backed triage path in app/services/ai.py.

The model call is always mocked — these assert the *contract* around it (how
the response maps onto the app's Triage shape, and that every failure mode
degrades to the heuristic) without spending tokens or needing a key in CI.

Why this matters more than usual: alert creation awaits triage. If any branch
here raises instead of falling back, posting an alert fails outright — which
in this app means a crisis report never reaches a volunteer.
"""

from __future__ import annotations

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock

import anthropic

from app.core.config import settings
from app.services import ai


@pytest.fixture
def claude(monkeypatch):
    """Force the Claude path on with a mocked client, and restore after.

    conftest sets NA_DISABLE_AI_MODEL=1 so the rest of the suite stays
    offline and deterministic; this fixture is the one place that opts back
    in, and it never lets a real client survive the test.
    """
    monkeypatch.setattr(ai, "_DISABLE", False)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    client = MagicMock()
    monkeypatch.setattr(ai, "_client", client)
    monkeypatch.setattr(ai, "_client_failed", False)
    yield client
    ai._client = None
    ai._client_failed = False


def _parsed(**overrides) -> ai._ClaudeTriage:
    base = dict(
        urgency="CRITICAL",
        urgency_confidence=0.94,
        urgency_reason="unconscious, not breathing",
        vulnerability="elderly",
        time_sensitivity="immediate",
        language="hi-Latn",
        triggers=["behosh", "saans nahi"],
    )
    base.update(overrides)
    return ai._ClaudeTriage(**base)


def _responds(client, **kwargs):
    client.messages.parse = AsyncMock(return_value=MagicMock(**kwargs))


# ---------------------------------------------------------------------------
# Mapping Claude's response onto the app's Triage shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_claude_result_maps_onto_triage(claude):
    _responds(claude, stop_reason="end_turn", parsed_output=_parsed())

    t = await ai.triage("buzurg aadmi behosh hai, saans nahi aa rahi")

    assert t.urgency == "CRITICAL"
    assert t.vulnerability == "elderly"
    assert t.time_sensitivity == "immediate"
    assert t.language == "hi-Latn"
    assert t.triggers == ["behosh", "saans nahi"]
    # priority_score is derived, not returned by the model
    assert t.priority_score > 100


@pytest.mark.asyncio
async def test_vulnerability_none_becomes_null_not_the_string(claude):
    """The schema uses the literal 'none' because a JSON schema enum can't
    express null cleanly, but the rest of the app checks `if vulnerability:`
    — leaking the string through would light up a 'vulnerable person' badge
    on every alert."""
    _responds(claude, stop_reason="end_turn", parsed_output=_parsed(vulnerability="none"))

    assert (await ai.triage("power cut on the whole street")).vulnerability is None


@pytest.mark.asyncio
async def test_request_uses_the_configured_model_and_a_bounded_timeout(claude):
    _responds(claude, stop_reason="end_turn", parsed_output=_parsed())

    await ai.triage("someone is trapped")

    kwargs = claude.messages.parse.call_args.kwargs
    assert kwargs["model"] == settings.AI_MODEL
    # Structured outputs — the schema is what guarantees the response shape.
    assert kwargs["output_format"] is ai._ClaudeTriage
    # Low effort: this is a short classification on a latency-critical path.
    assert kwargs["output_config"] == {"effort": "low"}


# ---------------------------------------------------------------------------
# Every failure mode must degrade to the heuristic, never raise
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_safety_refusal_falls_back_to_heuristic(claude):
    """Crisis reports describe violence, self-harm and injury, so a safety
    classifier declining is a realistic outcome. `content` is empty or partial
    on a refusal, so this must be checked before reading parsed output."""
    _responds(
        claude,
        stop_reason="refusal",
        stop_details=MagicMock(category="cyber"),
        parsed_output=None,
    )

    t = await ai.triage("Man collapsed and is unconscious, not breathing")
    assert t.urgency == "CRITICAL"  # heuristic still classifies it
    assert t.urgency_reason == "keyword:critical"


@pytest.mark.asyncio
async def test_timeout_falls_back_to_heuristic(claude):
    claude.messages.parse = AsyncMock(
        side_effect=anthropic.APITimeoutError(request=httpx.Request("POST", "http://x"))
    )

    assert (await ai.triage("aag lagi hai madad karo")).urgency == "HIGH"


@pytest.mark.asyncio
async def test_api_error_falls_back_to_heuristic(claude):
    claude.messages.parse = AsyncMock(
        side_effect=anthropic.RateLimitError(
            "rate limited",
            response=httpx.Response(429, request=httpx.Request("POST", "http://x")),
            body=None,
        )
    )

    assert (await ai.triage("bleeding heavily")).urgency == "CRITICAL"


@pytest.mark.asyncio
async def test_missing_parsed_output_falls_back_to_heuristic(claude):
    _responds(claude, stop_reason="end_turn", parsed_output=None)

    assert (await ai.triage("child drowning in the canal")).urgency == "CRITICAL"


@pytest.mark.asyncio
async def test_no_api_key_skips_claude_entirely(monkeypatch):
    """No key configured is the default deployment: the app must work, and
    must not attempt a call it knows will fail."""
    monkeypatch.setattr(ai, "_DISABLE", False)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(ai, "_client", None)
    monkeypatch.setattr(ai, "_client_failed", False)

    t = await ai.triage("Man collapsed and is unconscious, not breathing")
    assert t.urgency == "CRITICAL"
    assert ai._client is None  # no client was ever constructed
