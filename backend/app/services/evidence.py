"""Conservative, model-independent checks; never a semantic verifier."""
from __future__ import annotations

import re
import unicodedata
from collections import Counter

# Explicit negatives across supported scripts + common Hinglish spelling.
# These are guard cues, not a complete language parser. A rejected suggestion
# leaves the reporter's own headline unchanged.
_NEGATION = re.compile(
    r"(?<!\w)(?:no|not|never|without|cannot|can't|couldn't|isn't|aren't|wasn't|"
    r"won't|don't|doesn't|didn't|nahi|nahin|nhi|nehi|nahī|"
    r"नहीं|नही|नहि|मत|नाही|नको|না|নেই|নয়|নয়|"
    r"ਨਹੀਂ|ਨਹੀ|ਨਾ|નથી|નહીં|નહિ|இல்லை|இல்லாமல்|"
    r"లేదు|కాదు|వద్దు|ಇಲ್ಲ|ಅಲ್ಲ|ഇല്ല|അല്ല|ନାହିଁ|ନୁହେଁ)(?!\w)",
    re.IGNORECASE,
)
_UNCERTAIN = re.compile(
    r"(?<!\w)(?:maybe|perhaps|possibly|might|could|unclear|unsure|uncertain|"
    r"cannot tell|can't tell|unable to tell|not sure)(?!\w)", re.IGNORECASE,
)


def normalise(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().replace("’", "'").split())


def has_negation(text: str) -> bool:
    return bool(_NEGATION.search(normalise(text)))


def uncertain_caption(text: str) -> bool:
    return has_negation(text) or bool(_UNCERTAIN.search(normalise(text)))


def preserves_details(source: str, suggestion: str) -> bool:
    """Reject invented numeric values and unsafe paraphrases of negation.

    Digit spelling is normalised (e.g. ३ == 3); number roles, spelled-out
    counts, names and all semantic drift are NOT proved by this check.
    With a negated report we accept only an extractive span that retains
    every negation cue; otherwise the literal fallback is safer.
    """
    original, proposed = normalise(source), normalise(suggestion)

    def numbers(text):
        canonical = "".join(str(unicodedata.decimal(c)) if c.isdecimal() else c for c in text)
        return Counter(re.findall(r"\d+(?:[.:/-]\d+)*", canonical))

    if numbers(proposed) - numbers(original):
        return False
    source_negations = _NEGATION.findall(original)
    suggestion_negations = _NEGATION.findall(proposed)
    if source_negations or suggestion_negations:
        # Same words in a different clause are not proof of the same meaning.
        return proposed in original and Counter(source_negations) == Counter(suggestion_negations)
    return True
