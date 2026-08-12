"""Multi-aspect crisis triage.

Claude classifies each report across three aspects at once — urgency,
vulnerability signal, and time-sensitivity — plus the language it was
written in and the phrases that drove the call ("explainability"), so a
volunteer can see WHY an alert outranked another rather than just its label.

The response is constrained by a schema (structured outputs), so the shape
is guaranteed: there is no JSON to parse, nothing to repair, and no retry
loop for malformed output.

Underneath sits a keyword heuristic covering English, Hindi (Devanagari and
romanised) and common Indian crisis idioms. It is the fallback for every way
the model call can fail — no API key, network down, timeout, rate limit, or
a safety refusal on a report describing violence or self-harm. Nothing here
raises: an alert must never fail to post because triage was unavailable, and
a slower-but-working classification always beats an error page.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Literal, Optional

import anthropic
from pydantic import BaseModel, Field

from ..core.config import settings
# Heuristic vocabulary lives in vocab.py: it is data, and long enough that
# inlining it here buried the logic. Covers all eight languages the UI ships
# in — see that module for why matching uses stems, not inflected forms.
from .vocab import (
    CRITICAL_TERMS as _CRITICAL_TERMS,
    HIGH_TERMS as _HIGH_TERMS,
    IMMEDIATE_TERMS as _IMMEDIATE_TERMS,
    LATER_TERMS as _LATER_TERMS,
    LOW_TERMS as _LOW_TERMS,
    VULNERABLE as _VULNERABLE,
    detect_language,
)

__all__ = [
    "triage",
    "classify_urgency",
    "detect_language",
    "ai_status",
    "close_client",
]

log = logging.getLogger(__name__)

# Set NA_DISABLE_AI_MODEL=1 to force the heuristic path. Tests rely on this
# so classification stays deterministic and offline.
_DISABLE = os.getenv("NA_DISABLE_AI_MODEL", "").lower() in ("1", "true", "yes")
_client: "anthropic.AsyncAnthropic | None" = None

# Two different reasons the client can be absent, deliberately kept apart.
#
# `_client_disabled` is a config fact — no API key, or the kill switch is on.
# It cannot change while the process runs, so latching it is correct and
# saves re-checking on every alert.
#
# `_client_retry_after` covers the transient case: construction blew up for
# some reason that may not recur. Latching *that* permanently was a real
# failure mode — one hiccup during startup and the deploy served heuristic
# triage until someone noticed and restarted it, which on a long-lived host
# could be weeks. Now it backs off and heals itself.
_client_disabled = False
_client_retry_after = 0.0
_CLIENT_RETRY_BACKOFF_SECONDS = 60.0


# --------------------------------------------------------------------------
# Classifier bootstrap
# --------------------------------------------------------------------------

def _get_client():
    """Return a shared AsyncAnthropic client, or None to use the heuristic.

    Built once and reused: the client owns an HTTP connection pool, so
    constructing one per alert would open a fresh TLS connection on the
    hottest path in the app.
    """
    global _client, _client_disabled, _client_retry_after
    if _client is not None:
        return _client
    if _client_disabled:
        return None
    if _DISABLE or not settings.ANTHROPIC_API_KEY:
        # Permanent for this process: neither of these changes at runtime.
        _client_disabled = True
        if not _DISABLE:
            log.warning(
                "ANTHROPIC_API_KEY not set — triage is running on the keyword "
                "heuristic. Urgency will be less accurate on unusual phrasing. "
                "Set the key to enable Claude."
            )
        return None
    # Transient failure: wait out the backoff, then try again.
    if time.monotonic() < _client_retry_after:
        return None
    try:
        _client = anthropic.AsyncAnthropic(
            api_key=settings.ANTHROPIC_API_KEY,
            # Short, explicit timeout: alert creation awaits this, and a
            # reporter must not watch a spinner because triage is slow. The
            # SDK default is 10 minutes, which is wrong for this path.
            timeout=settings.AI_TIMEOUT_SECONDS,
            # One retry, not the default two — a second retry would blow the
            # latency budget before it ever helped.
            max_retries=1,
        )
    except Exception as exc:  # noqa: BLE001 — never break alert creation
        _client_retry_after = time.monotonic() + _CLIENT_RETRY_BACKOFF_SECONDS
        log.warning(
            "Could not build Anthropic client, using heuristic for the next %ss: %s",
            int(_CLIENT_RETRY_BACKOFF_SECONDS),
            exc,
        )
    return _client


def ai_status() -> str:
    """Which triage engine is live, for the readiness probe.

    Constructs the client if it hasn't been built yet, which also means the
    uptime ping doubles as a warm-up: the TLS handshake and connection pool
    are already in place when the first real alert arrives. No API call is
    made, so this stays free no matter how often it is polled.
    """
    if _DISABLE:
        return "disabled"
    if not settings.ANTHROPIC_API_KEY:
        return "heuristic"
    return "claude" if _get_client() is not None else "heuristic-degraded"


async def close_client() -> None:
    """Release the shared client's connection pool (called from lifespan)."""
    global _client, _client_disabled, _client_retry_after
    if _client is not None:
        await _client.close()
    _client = None
    _client_disabled = False
    _client_retry_after = 0.0


# --------------------------------------------------------------------------
# Heuristic helpers
# --------------------------------------------------------------------------

def _heuristic_urgency(text: str) -> tuple[str, str, list[str], float]:
    """Returns (urgency, reason, triggers, heuristic_confidence)."""
    low = text.lower()
    hits = [w for w in _CRITICAL_TERMS if w in low]
    if hits:
        return "CRITICAL", "keyword:critical", hits[:3], 0.8
    hits = [w for w in _HIGH_TERMS if w in low]
    if hits:
        return "HIGH", "keyword:high", hits[:3], 0.7
    hits = [w for w in _LOW_TERMS if w in low]
    if hits:
        return "LOW", "keyword:low", hits[:3], 0.6
    return "MEDIUM", "keyword:default", [], 0.4


def _heuristic_vulnerability(text: str) -> Optional[str]:
    low = text.lower()
    for tag, vocab in _VULNERABLE.items():
        if any(w in low for w in vocab):
            return tag
    return None


def _heuristic_time(text: str) -> str:
    low = text.lower()
    if any(w in low for w in _IMMEDIATE_TERMS):
        return "immediate"
    if any(w in low for w in _LATER_TERMS):
        return "days"
    return "hours"


# --------------------------------------------------------------------------
# Public triage API
# --------------------------------------------------------------------------

URGENCY_WEIGHT = {"CRITICAL": 100, "HIGH": 70, "MEDIUM": 40, "LOW": 20}
TIME_BONUS = {"immediate": 20, "hours": 0, "days": -10}


@dataclass
class Triage:
    urgency: str
    urgency_confidence: float
    urgency_reason: str
    vulnerability: Optional[str]
    time_sensitivity: str
    language: str
    triggers: list[str]
    priority_score: int  # composite — used for volunteer dispatch ordering


def _compute_priority(urgency: str, vulnerability: Optional[str],
                      time_sensitivity: str, confidence: float) -> int:
    """Composite priority score 0–130. Higher = dispatch first."""
    base = URGENCY_WEIGHT.get(urgency, 40) * max(0.5, confidence)
    if vulnerability:
        base += 15
    base += TIME_BONUS.get(time_sensitivity, 0)
    return max(0, min(130, int(base)))


def _heuristic_triage(text: str) -> Triage:
    urgency, reason, triggers, confidence = _heuristic_urgency(text)
    vuln = _heuristic_vulnerability(text)
    time_s = _heuristic_time(text)
    return Triage(
        urgency=urgency,
        urgency_confidence=confidence,
        urgency_reason=reason,
        vulnerability=vuln,
        time_sensitivity=time_s,
        language=detect_language(text),
        triggers=triggers,
        priority_score=_compute_priority(urgency, vuln, time_s, confidence),
    )


class _ClaudeTriage(BaseModel):
    """Schema Claude's response is constrained to.

    Structured outputs guarantee the shape, so there is no JSON parsing or
    retry loop to write — an invalid response can't come back. Field
    descriptions are the actual instructions the model classifies against;
    keep them concrete, because they do more work here than the prompt does.
    """

    urgency: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"] = Field(
        description=(
            "CRITICAL: life is in immediate danger (not breathing, severe "
            "bleeding, drowning, cardiac arrest, active violence). "
            "HIGH: serious harm likely within the hour (fire, flood entering a "
            "home, trapped person, fracture, someone vulnerable alone). "
            "MEDIUM: real need, no immediate danger to life. "
            "LOW: informational, or help wanted at some later time."
        )
    )
    urgency_confidence: float = Field(
        ge=0.0, le=1.0, description="How certain you are of the urgency label."
    )
    urgency_reason: str = Field(
        max_length=140,
        description=(
            "One short clause a volunteer reads to understand the ranking, "
            "e.g. 'unconscious, not breathing'. No preamble."
        ),
    )
    vulnerability: Literal["child", "elderly", "pregnant", "disabled", "none"] = Field(
        description="The most at-risk person mentioned, or 'none' if unstated."
    )
    time_sensitivity: Literal["immediate", "hours", "days"] = Field(
        description="How soon help must arrive to change the outcome."
    )
    language: str = Field(
        max_length=10,
        description=(
            "BCP-47 tag for the language the report is written in: 'en', 'hi' "
            "(Devanagari), 'hi-Latn' (romanised Hindi/Hinglish), 'pa', 'bn', "
            "'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'ur', 'or', 'as'."
        ),
    )
    triggers: list[str] = Field(
        max_length=4,
        description=(
            "Up to 4 short phrases quoted from the report that drove the "
            "urgency call. These are shown to volunteers as the explanation, "
            "so quote the reporter's own words rather than paraphrasing."
        ),
    )


_TRIAGE_SYSTEM = (
    "You are the triage step in a hyperlocal emergency dispatch system in "
    "India. A neighbour has reported an incident in free text; nearby "
    "volunteers are ranked and notified based on what you return.\n\n"
    "Reports arrive in English, Hindi (Devanagari or romanised), and other "
    "Indian languages, often mixed together, from someone under stress — "
    "expect typos, fragments, and no punctuation. Classify what is actually "
    "described. Do not soften a life-threatening report because it is written "
    "calmly, and do not escalate an ordinary request because it is written in "
    "capitals or with many exclamation marks.\n\n"
    "Both directions of error are costly: over-escalation pulls volunteers "
    "away from someone who is genuinely dying, and under-escalation means "
    "nobody arrives in time. When a report is ambiguous, weigh the plausible "
    "readings by how bad it would be to get each one wrong."
)


def _to_triage(parsed: _ClaudeTriage) -> Triage:
    """Map Claude's response onto the app's existing Triage shape."""
    vuln = None if parsed.vulnerability == "none" else parsed.vulnerability
    return Triage(
        urgency=parsed.urgency,
        urgency_confidence=round(parsed.urgency_confidence, 3),
        urgency_reason=parsed.urgency_reason.strip(),
        vulnerability=vuln,
        time_sensitivity=parsed.time_sensitivity,
        language=parsed.language,
        triggers=[t.strip() for t in parsed.triggers if t.strip()][:4],
        priority_score=_compute_priority(
            parsed.urgency, vuln, parsed.time_sensitivity, parsed.urgency_confidence
        ),
    )


async def triage(text: str) -> Triage:
    """Classify a crisis report.

    Claude does the classification; the keyword heuristic below it is the
    fallback for every way that can fail — no key configured, network down,
    timeout, rate limit, or a safety refusal. Crisis reports describe
    violence, self-harm and injury, so refusals are a realistic outcome
    rather than a theoretical one, and an alert must never fail to post
    because triage was unavailable. Every failure degrades to a usable
    result instead of raising.
    """
    client = _get_client()
    if client is None:
        return _heuristic_triage(text)

    try:
        response = await client.messages.parse(
            model=settings.AI_MODEL,
            max_tokens=1024,
            system=_TRIAGE_SYSTEM,
            # Thinking stays on (the Opus 5 default) at low effort: this is a
            # short classification on a latency-critical path, and low effort
            # is both faster and cheaper than disabling thinking outright.
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": text}],
            output_format=_ClaudeTriage,
        )
    except anthropic.APIStatusError as exc:
        log.warning("Claude triage HTTP %s, using heuristic: %s", exc.status_code, exc)
        return _heuristic_triage(text)
    except (anthropic.APIConnectionError, anthropic.APITimeoutError) as exc:
        log.warning("Claude triage unreachable, using heuristic: %s", exc)
        return _heuristic_triage(text)

    # A safety classifier can decline the request; `content` is then empty or
    # partial, so this has to be checked before reading the parsed output.
    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None)
        log.info("Claude declined to triage (%s), using heuristic", category)
        return _heuristic_triage(text)

    if response.parsed_output is None:
        log.warning("Claude returned no parsed triage output, using heuristic")
        return _heuristic_triage(text)

    return _to_triage(response.parsed_output)


# --------------------------------------------------------------------------
# Headline summarisation
# --------------------------------------------------------------------------

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def generate_headline(text: str, max_len: int = 90) -> str:
    """Produce a short one-liner headline from a free-text description.

    Strategy:
    1. Prefer the first full sentence if it's reasonably short.
    2. Otherwise truncate at the nearest word boundary within `max_len`.
    No model dependency — fast, deterministic, works offline.
    """
    cleaned = text.strip().replace("\n", " ").replace("  ", " ")
    if not cleaned:
        return ""
    first_sentence = _SENTENCE_SPLIT.split(cleaned, maxsplit=1)[0]
    if len(first_sentence) <= max_len:
        return first_sentence
    cut = cleaned[:max_len].rsplit(" ", 1)[0]
    return f"{cut}…"


# --------------------------------------------------------------------------
# Lightweight semantic similarity (character 4-gram Jaccard)
# --------------------------------------------------------------------------
#
# Not as rich as sentence embeddings, but free, dependency-free, and robust
# to typos / reordering / minor Hinglish variations — which is what we need
# to fuse duplicate reports of the same incident described differently by
# different people ("fire near Gate 3" ≈ "aag gate 3 ke paas").


def _ngrams(text: str, n: int = 4) -> set[str]:
    low = re.sub(r"\s+", " ", text.lower())
    if len(low) < n:
        return {low}
    return {low[i : i + n] for i in range(len(low) - n + 1)}


def similarity(a: str, b: str) -> float:
    """Jaccard similarity of char 4-grams — 0.0 to 1.0."""
    if not a or not b:
        return 0.0
    ga, gb = _ngrams(a), _ngrams(b)
    inter = len(ga & gb)
    union = len(ga | gb)
    return round(inter / union, 3) if union else 0.0


def is_duplicate(a: str, b: str, threshold: float = 0.55) -> bool:
    return similarity(a, b) >= threshold


# --------------------------------------------------------------------------
# Back-compat shim for older callers & tests
# --------------------------------------------------------------------------

async def classify_urgency(text: str) -> tuple[str, str]:
    t = await triage(text)
    return t.urgency, t.urgency_reason
