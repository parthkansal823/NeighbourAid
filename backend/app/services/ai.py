"""Multi-aspect crisis triage.

Classifies each report across three aspects — urgency, vulnerability signal,
and time-sensitivity — plus the language it was written in and the phrases
that drove the call ("explainability"), so a volunteer can see WHY an alert
outranked another rather than just its label.

Entirely local: keyword matching over the multilingual vocabulary in
vocab.py, covering all eleven languages the app ships in. No API key, no
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
# inlining it here buried the logic. Covers all eleven languages the UI ships
# in - see that module for why matching uses stems, not inflected forms.
from .vocab import (
    CONCEPTS as _CONCEPTS,
    CRITICAL_PATTERN_RES as _CRITICAL_PATTERNS,
    CRITICAL_TERMS as _CRITICAL_TERMS,
    HIGH_TERMS as _HIGH_TERMS,
    IMMEDIATE_TERMS as _IMMEDIATE_TERMS,
    INFO_REQUEST_RES as _INFO_REQUEST_RES,
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

# Concepts whose HIGH ranking a reporter's own qualifier cannot talk down.
# The common thread is that they get worse on their own: an injury that is
# minor now is still minor in an hour, a fire is not. Names must exist in
# vocab.CONCEPTS — the assertion below fails the import rather than letting
# a typo silently disable the exemption.
SPREADING_HAZARDS = frozenset({"fire", "gas_leak", "flood", "collapse", "trapped"})
assert SPREADING_HAZARDS <= set(_CONCEPTS), (
    f"unknown concept(s): {SPREADING_HAZARDS - set(_CONCEPTS)}"
)


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

    # Someone asking a question with no incident behind it. Placed after both
    # CRITICAL checks and before HIGH: a question that also states an
    # emergency ("where is the nearest hospital, my father is unconscious")
    # has already returned CRITICAL above, so this can only ever catch a
    # report that carries no urgent signal at all. Without it, "which
    # hospital is nearest to sector 22" matched nothing and landed on the
    # MEDIUM default, sitting in the volunteer feed above real LOW reports.
    info_hits = [m.group(0).strip() for r in _INFO_REQUEST_RES
                 if (m := r.search(text))]
    if info_hits:
        return "LOW", "pattern:info-request", info_hits[:3], 0.6

    hits = [w for w in _HIGH_TERMS if w in low]
    if hits:
        # De-escalation. A HIGH keyword used to end the matter, so "stray dog
        # has a minor injury on its leg, can wait until tomorrow" scored HIGH
        # on `injury` alone — even though `stray` and `tomorrow` are both in
        # LOW_TERMS and the reporter said outright that it can wait.
        #
        # When the text carries explicit de-escalating qualifiers, they are
        # better evidence than a bare keyword: the reporter is describing
        # their own situation. Deliberately limited to HIGH — CRITICAL has
        # already returned above and is never downgraded, because "not
        # breathing, come tomorrow" must stay CRITICAL no matter what the
        # reporter believes about the timeline.
        #
        # SPREADING_HAZARDS is the same exemption one level down. A reporter
        # can be right that their own injury is minor; they cannot be right
        # that a fire is. "मामूली आग लगी है" (there is a minor fire) was
        # scoring LOW on `मामूली`, below genuine LOW reports in the feed,
        # and a small fire is the one you still want a volunteer at.
        #
        # Drawn from CONCEPTS rather than a second keyword list so it covers
        # every language the app ships in, and so adding a language to
        # CONCEPTS cannot leave this behind.
        low_hits = [w for w in _LOW_TERMS if w in low]
        if low_hits and not (concepts_in(text) & SPREADING_HAZARDS):
            return (
                "LOW",
                "keyword:high-deescalated",
                (hits[:1] + low_hits[:2]),
                0.55,
            )
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


def _char_similarity(a: str, b: str) -> float:
    """Jaccard overlap of character 4-grams — 0.0 to 1.0."""
    ga, gb = _ngrams(a), _ngrams(b)
    union = len(ga | gb)
    return round(len(ga & gb) / union, 3) if union else 0.0


def concepts_in(text: str) -> frozenset[str]:
    """Which incident concepts this report mentions, in any of the 11 languages.

    The cross-language half of `similarity`. See vocab.CONCEPTS for why the
    terms are grouped by meaning rather than by urgency.
    """
    low = text.lower()
    return frozenset(
        name for name, terms in _CONCEPTS.items() if any(t in low for t in terms)
    )


def _concept_similarity(a: str, b: str) -> float:
    """Jaccard overlap of the concepts two reports mention."""
    ca, cb = concepts_in(a), concepts_in(b)
    if not ca or not cb:
        # One of them names no concept we know. Say nothing rather than
        # guessing — returning 0 lets the character score decide alone.
        return 0.0
    return round(len(ca & cb) / len(ca | cb), 3)


def similarity(a: str, b: str) -> float:
    """How likely two reports describe the same incident — 0.0 to 1.0.

    The stronger of two signals:

      * character 4-gram overlap, which is precise within one language and
        catches rewordings of the same sentence;
      * shared incident concepts, which is the only one that survives a
        change of script.

    The second was added because the first scores exactly 0.000 across
    scripts. "Fire near Gate 3 of the building" and "गेट 3 के पास आग लगी है"
    are one fire and share no 4-gram, so `filter_corroborating` treated them
    as unrelated — in an app shipping eleven languages, the reports most likely
    to corroborate each other were the ones guaranteed never to match.

    max() rather than a blend, deliberately: it can only ever raise a score,
    so nothing that corroborated before stops corroborating now. The risk it
    does carry is a false positive from two different incidents sharing a
    concept — "fire in the market" and "fire near the school" both score 1.0
    on concepts alone. That is survivable here only because every caller
    already filters on category, radius and time window first; the score is
    the last narrowing step, never the first. Do not reuse it standalone.
    """
    if not a or not b:
        return 0.0
    return max(_char_similarity(a, b), _concept_similarity(a, b))


def is_duplicate(a: str, b: str, threshold: float = 0.55) -> bool:
    """Are these two reports the same SUBMISSION — near-identical text?

    Character overlap only, deliberately not `similarity()`. The two answer
    different questions and must not share an implementation:

      * `similarity` asks "same incident?", so it counts shared concepts —
        that is what lets one fire reported in three languages corroborate
        itself.
      * `is_duplicate` asks "same text?", which is a question about wording.

    Wiring the concept score in here made "Fire near Gate 3 of the building"
    and "Fire at the school on the other side of town" duplicates of each
    other: both name exactly one concept, fire, so they scored 1.0. Two
    separate fires across town are not one submission, and collapsing them
    would hide a real emergency rather than tidy a feed.
    """
    return _char_similarity(a, b) >= threshold
