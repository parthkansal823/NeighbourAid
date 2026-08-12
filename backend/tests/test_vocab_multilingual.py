"""The heuristic must work in every language the UI offers.

This is not a nice-to-have. The heuristic is what runs when no API key is
configured, which is the default free deployment — so for most installs it
IS the triage engine, not a fallback.

It previously held English and romanised-Hindi terms only. A report typed in
Devanagari, Bengali, Tamil, Telugu, Gujarati or Gurmukhi matched nothing and
fell through to MEDIUM. "व्यक्ति बेहोश है, सांस नहीं आ रही" — unconscious,
not breathing — ranked below a power cut, so volunteers saw it below alerts
that were genuinely less urgent. These tests exist so that cannot come back.
"""

import pytest

from app.services import ai
from app.services import vocab

# Same report, nine ways. Every one describes a person who is unconscious and
# not breathing, so every one must reach CRITICAL — anything else means a
# language is unrepresented in the vocabulary.
UNCONSCIOUS_NOT_BREATHING = [
    ("en", "A man collapsed and is unconscious, not breathing"),
    ("hi-Latn", "Ek aadmi behosh ho gaya hai, saans nahi aa rahi"),
    ("hi", "एक आदमी बेहोश हो गया है, सांस नहीं आ रही"),
    ("mr", "एक माणूस बेशुद्ध झाला आहे, श्वास येत नाही"),
    ("bn", "একজন লোক অজ্ঞান হয়ে গেছে, শ্বাস নিচ্ছে না"),
    ("ta", "ஒருவர் மயக்கமடைந்துள்ளார், மூச்சு விடவில்லை"),
    ("te", "ఒక వ్యక్తి స్పృహ కోల్పోయాడు, ఊపిరి ఆడటం లేదు"),
    ("gu", "એક માણસ બેભાન થઈ ગયો છે, શ્વાસ નથી આવતો"),
    ("pa", "ਇੱਕ ਆਦਮੀ ਬੇਹੋਸ਼ ਹੋ ਗਿਆ ਹੈ, ਸਾਹ ਨਹੀਂ ਆ ਰਿਹਾ"),
]

BUILDING_FIRE_TRAPPED = [
    ("hi", "इमारत में आग लगी है, लोग फंसे हैं"),
    ("bn", "বাড়িতে আগুন লেগেছে, মানুষ আটকে আছে"),
    ("ta", "கட்டிடத்தில் தீப்பிடித்துள்ளது, மக்கள் சிக்கியுள்ளனர்"),
    ("te", "భవనంలో మంటలు, ప్రజలు చిక్కుకున్నారు"),
    ("gu", "ઇમારતમાં આગ લાગી છે, લોકો ફસાયા છે"),
    ("pa", "ਇਮਾਰਤ ਵਿੱਚ ਅੱਗ ਲੱਗੀ ਹੈ, ਲੋਕ ਫਸੇ ਹਨ"),
]


@pytest.mark.parametrize("lang,text", UNCONSCIOUS_NOT_BREATHING, ids=lambda v: v)
def test_life_threatening_report_is_critical_in_every_language(lang, text):
    urgency, reason, triggers, _confidence = ai._heuristic_urgency(text)
    assert urgency == "CRITICAL", f"{lang} fell through to {urgency} ({reason})"
    assert triggers, f"{lang} matched nothing — no term to show the volunteer"


@pytest.mark.parametrize("lang,text", BUILDING_FIRE_TRAPPED, ids=lambda v: v)
def test_fire_with_people_trapped_is_at_least_high(lang, text):
    urgency, _reason, _triggers, _confidence = ai._heuristic_urgency(text)
    assert urgency in ("HIGH", "CRITICAL"), f"{lang} gave {urgency}"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("A man collapsed and is unconscious", "en"),
        ("Ek aadmi behosh ho gaya hai, madad chahiye", "hi-Latn"),
        ("एक आदमी बेहोश हो गया है", "hi"),
        # Shares Devanagari with Hindi, so this leans on the marker words.
        ("एक माणूस बेशुद्ध झाला आहे, मला मदत हवी", "mr"),
        ("একজন লোক অজ্ঞান হয়ে গেছে", "bn"),
        ("ஒருவர் மயக்கமடைந்துள்ளார்", "ta"),
        ("ఒక వ్యక్తి స్పృహ కోల్పోయాడు", "te"),
        ("એક માણસ બેભાન થઈ ગયો છે", "gu"),
        ("ਇੱਕ ਆਦਮੀ ਬੇਹੋਸ਼ ਹੋ ਗਿਆ ਹੈ", "pa"),
    ],
)
def test_language_detection(text, expected):
    assert vocab.detect_language(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("बुजुर्ग महिला अकेली है, तुरंत मदद चाहिए", "elderly"),
        ("ஒரு குழந்தை மூழ்கி விட்டது", "child"),
        ("গর্ভবতী মহিলা, এখনই সাহায্য দরকার", "pregnant"),
        ("વિકલાંગ વ્યક્તિ ફસાયેલ છે", "disabled"),
    ],
)
def test_vulnerability_detected_across_scripts(text, expected):
    assert ai._heuristic_vulnerability(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("तुरंत मदद चाहिए", "immediate"),
        ("এখনই সাহায্য দরকার", "immediate"),
        ("உடனே உதவி வேண்டும்", "immediate"),
        ("વીજળી કાલે ઠીક કરવી છે", "days"),
        ("ਕੱਲ੍ਹ ਤੱਕ ਠੀਕ ਕਰ ਦਿਓ", "days"),
    ],
)
def test_time_sensitivity_across_scripts(text, expected):
    assert ai._heuristic_time(text) == expected


def test_low_urgency_still_reads_as_low():
    """The counterweight: broadening the vocabulary must not sweep
    everything up into CRITICAL. A LOW report has to stay LOW, or the
    urgency ranking stops carrying information."""
    urgency, _reason, _triggers, _confidence = ai._heuristic_urgency(
        "रखडता कुत्रा, किरकोळ जखम, उद्या बघितले तरी चालेल"
    )
    assert urgency == "LOW"


def test_every_language_is_represented_in_the_critical_list():
    """Guards against a language being added to the UI but not to vocab.py.

    Checks by Unicode script rather than by counting terms: a script with
    zero CRITICAL entries means speakers of that language cannot trigger the
    highest urgency band at all, however many HIGH terms exist.
    """
    scripts = {
        "Devanagari (hi/mr)": range(0x0900, 0x0980),
        "Bengali (bn)": range(0x0980, 0x0A00),
        "Gurmukhi (pa)": range(0x0A00, 0x0A80),
        "Gujarati (gu)": range(0x0A80, 0x0B00),
        "Tamil (ta)": range(0x0B80, 0x0C00),
        "Telugu (te)": range(0x0C00, 0x0C80),
    }
    for name, code_range in scripts.items():
        present = any(
            any(ord(ch) in code_range for ch in term)
            for term in vocab.CRITICAL_TERMS
        )
        assert present, f"no CRITICAL terms written in {name}"


def test_vocabulary_has_no_single_character_entries():
    """Single Indic characters appear inside unrelated words constantly, so
    one would fire on almost every report and flatten the ranking."""
    for name, terms in (
        ("CRITICAL", vocab.CRITICAL_TERMS),
        ("HIGH", vocab.HIGH_TERMS),
        ("LOW", vocab.LOW_TERMS),
        ("IMMEDIATE", vocab.IMMEDIATE_TERMS),
        ("LATER", vocab.LATER_TERMS),
    ):
        short = [t for t in terms if len(t.strip()) < 2]
        assert short == [], f"{name} has entries too short to be safe: {short}"


def test_vocabulary_has_no_duplicates_within_a_band():
    for name, terms in (
        ("CRITICAL", vocab.CRITICAL_TERMS),
        ("HIGH", vocab.HIGH_TERMS),
        ("LOW", vocab.LOW_TERMS),
    ):
        dupes = {t for t in terms if terms.count(t) > 1}
        assert dupes == set(), f"{name} repeats: {dupes}"


def test_critical_and_low_bands_do_not_overlap():
    """An overlap would make classification depend on which list is checked
    first, which is exactly the kind of bug that hides until it matters."""
    assert set(vocab.CRITICAL_TERMS) & set(vocab.LOW_TERMS) == set()
    assert set(vocab.HIGH_TERMS) & set(vocab.LOW_TERMS) == set()
