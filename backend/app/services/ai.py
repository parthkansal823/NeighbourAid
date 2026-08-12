"""Multi-aspect crisis triage.

Runs three zero-shot classifiers in parallel on `facebook/bart-large-mnli`:
  1. Urgency                        (critical / high / medium / low)
  2. Vulnerability signal           (child / elderly / pregnant / disabled / none)
  3. Time-sensitivity               (immediate / hours / days)

Each aspect comes with a confidence score and the top triggering keywords
("explainability") so volunteers can see WHY the system classified the way
it did, not just the final label.

If the HF model can't load (tight VM, offline dev, test environment), a
richer keyword heuristic fills in — with vocabulary covering English,
Hindi transliterations (Hinglish), and common Indian crisis idioms.

All paths are safe: classification never raises, so an alert submission
never fails because of an AI blip.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

_DISABLE = os.getenv("NA_DISABLE_AI_MODEL", "").lower() in ("1", "true", "yes")
_classifier = None
_load_failed = False


# --------------------------------------------------------------------------
# Zero-shot label sets
# --------------------------------------------------------------------------

URGENCY_LABELS = [
    "critical life-threatening emergency",
    "high urgency",
    "medium urgency",
    "low urgency",
]
URGENCY_MAP = {
    "critical life-threatening emergency": "CRITICAL",
    "high urgency": "HIGH",
    "medium urgency": "MEDIUM",
    "low urgency": "LOW",
}

VULNERABILITY_LABELS = [
    "a child or infant is affected",
    "an elderly person is affected",
    "a pregnant woman is affected",
    "a disabled or seriously injured person is affected",
    "no vulnerable person is mentioned",
]
VULNERABILITY_MAP = {
    "a child or infant is affected": "child",
    "an elderly person is affected": "elderly",
    "a pregnant woman is affected": "pregnant",
    "a disabled or seriously injured person is affected": "disabled",
    "no vulnerable person is mentioned": None,
}

TIME_LABELS = [
    "help is needed within minutes",
    "help is needed within hours",
    "help is needed within a day or later",
]
TIME_MAP = {
    "help is needed within minutes": "immediate",
    "help is needed within hours": "hours",
    "help is needed within a day or later": "days",
}


# --------------------------------------------------------------------------
# Indian-English + Hinglish vocabulary for the heuristic fallback
# --------------------------------------------------------------------------

_CRITICAL_TERMS = (
    "unconscious", "behosh", "cardiac", "heart attack", "not breathing",
    "saans nahi", "bleeding heavily", "khoon bahut", "stabbed", "shot",
    "gunshot", "drowning", "doob", "choking", "seizure", "convulsion",
    "stroke", "dead", "dying", "suicidal", "khudkushi", "marne wala",
)
_HIGH_TERMS = (
    "fire", "aag", "flood", "baadh", "trapped", "phansa", "collapse",
    "earthquake", "bhukamp", "fracture", "accident", "durghatna", "injury",
    "injured", "ghayal", "urgent", "zaroori", "help immediately", "madad",
    "ambulance", "rescue", "elderly alone", "pregnant in pain",
)
_LOW_TERMS = (
    "stray", "minor", "question", "tomorrow", "kal", "next week", "later",
    "information", "general inquiry",
)

_VULNERABLE = {
    "child": ("child", "baby", "infant", "kid", "bachcha", "bacha", "shishu", "minor"),
    "elderly": ("elderly", "old man", "old woman", "senior citizen", "buzurg", "budha", "budhi"),
    "pregnant": ("pregnant", "garbhvati", "expecting mother"),
    "disabled": ("disabled", "handicapped", "divyang", "wheelchair", "blind", "deaf"),
}

_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_HINGLISH_MARKERS = ("hai ", "nahi", "kya ", "madad", "yahan", "mera ", "meri ", "bhai")


def detect_language(text: str) -> str:
    """Very rough — enough to flag Hindi/Hinglish for volunteers who can help."""
    if _DEVANAGARI_RE.search(text):
        return "hi"
    low = f" {text.lower()} "
    if any(m in low for m in _HINGLISH_MARKERS):
        return "hi-Latn"
    return "en"


# --------------------------------------------------------------------------
# Classifier bootstrap
# --------------------------------------------------------------------------

def _get_client():
    """Return a shared AsyncAnthropic client, or None to use the heuristic.

    Built once and reused: the client owns an HTTP connection pool, so
    constructing one per alert would open a fresh TLS connection on the
    hottest path in the app.
    """
    global _client, _client_failed
    if _client is not None or _client_failed:
        return _client
    if _DISABLE or not settings.ANTHROPIC_API_KEY:
        _client_failed = True
        if not _DISABLE:
            log.info(
                "ANTHROPIC_API_KEY not set — triage uses the keyword heuristic. "
                "Set it to enable Claude-based triage."
            )
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
        log.warning("Could not build Anthropic client, using heuristic: %s", exc)
        _client_failed = True
    return _client


async def close_client() -> None:
    """Release the shared client's connection pool (called from lifespan)."""
    global _client, _client_failed
    if _client is not None:
        await _client.close()
    _client = None
    _client_failed = False


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
    if any(w in low for w in ("immediately", "right now", "minute", "abhi", "turant", "jaldi")):
        return "immediate"
    if any(w in low for w in ("tomorrow", "next week", "later", "kal", "agle")):
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

def classify_urgency(text: str) -> tuple[str, str]:
    t = triage(text)
    return t.urgency, t.urgency_reason
