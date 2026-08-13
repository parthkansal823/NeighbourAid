"""Multi-aspect crisis triage.

Classifies each report across three aspects — urgency, vulnerability signal,
and time-sensitivity — plus the language it was written in and the phrases
that drove the call ("explainability"), so a volunteer can see WHY an alert
outranked another rather than just its label.

Entirely local: keyword matching over the multilingual vocabulary in
vocab.py, covering all eight languages the app ships in. No API key, no
network call, no per-alert cost, and it answers in well under a millisecond.

The honest limit is that keywords catch *stated* danger, not *implied*
danger. "He is not breathing" classifies correctly; a report where the
severity is only inferable from context will not. That trade buys something
worth having for this app: triage that cannot fail, cannot rate-limit, and
cannot bill anyone. Nothing here raises or blocks — an alert must never fail
to post because triage had a problem.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

# Heuristic vocabulary lives in vocab.py: it is data, and long enough that
# inlining it here buried the logic. Covers all eight languages the UI ships
# in - see that module for why matching uses stems, not inflected forms.
from .vocab import (
    CRITICAL_PATTERN_RES as _CRITICAL_PATTERNS,
    CRITICAL_TERMS as _CRITICAL_TERMS,
    HIGH_TERMS as _HIGH_TERMS,
    IMMEDIATE_TERMS as _IMMEDIATE_TERMS,
    LATER_TERMS as _LATER_TERMS,
    LOW_TERMS as _LOW_TERMS,
    VULNERABLE as _VULNERABLE,
    detect_language,
)

__all__ = [
    "Triage",
    "triage",
    "classify_urgency",
    "detect_language",
    "generate_headline",
    "similarity",
    "is_duplicate",
]

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Aspect classifiers
# --------------------------------------------------------------------------

def _heuristic_urgency(text: str) -> tuple[str, str, list[str], float]:
    """Returns (urgency, reason, triggers, heuristic_confidence)."""
    low = text.lower()

    # Patterns run before plain keywords, because a report that matches one
    # usually contains no urgent keyword at all — that is precisely why the
    # patterns exist. Checking keywords first would let a stray HIGH term
    # ("madad") settle a report whose real signal is "bol nahi rahe".
    pattern_hits = [m.group(0).strip() for r in _CRITICAL_PATTERNS
                    if (m := r.search(text))]
    if pattern_hits:
        # Same confidence as an explicit CRITICAL keyword, deliberately.
        # Confidence feeds priority_score, so discounting it would sort "baba
        # bol nahi rahe" below "unconscious" — two reports of the same
        # emergency, ordered by which layer happened to match. The patterns
        # are narrow enough to earn parity: zero false CRITICALs across the
        # eval set in tests/eval_dataset.py.
        return "CRITICAL", "pattern:vital-signs", pattern_hits[:3], 0.8

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


def triage(text: str) -> Triage:
    """Classify a report. Synchronous, local, and cannot fail."""
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


def classify_urgency(text: str) -> tuple[str, str]:
    t = triage(text)
    return t.urgency, t.urgency_reason


# --------------------------------------------------------------------------
# Headline summarisation
# --------------------------------------------------------------------------

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def generate_headline(text: str, max_len: int = 90) -> str:
    """Produce a short one-liner headline from a free-text description.

    Strategy:
    1. Prefer the first full sentence if it's reasonably short.
    2. Otherwise truncate at the nearest word boundary within `max_len`.
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
