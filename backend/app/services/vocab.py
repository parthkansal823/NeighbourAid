"""Multilingual crisis vocabulary for the heuristic triage fallback.

Split out of ai.py because it is data, not logic, and because it is the part
a non-programmer can usefully review — a Tamil speaker should be able to
correct the Tamil list without reading any Python around it.

WHY THIS EXISTS AT ALL

The heuristic is the fallback under Claude, but it is also what runs on every
alert when no API key is configured — which is the default free deployment.
It used to hold English and romanised-Hindi terms only. The app ships a UI in
eight languages, so a report typed in the language the user just selected
matched nothing and fell through to MEDIUM. "व्यक्ति बेहोश है, सांस नहीं आ रही"
— unconscious, not breathing — ranked below a power cut.

ORGANISED BY CONCEPT, NOT BY LANGUAGE

Grouping by meaning keeps the translations honest: it is obvious at a glance
that every language has a word for "drowning", and obvious when one is
missing. Grouping by language instead lets whole concepts quietly disappear
from one list.

MATCHING NOTES

  * Terms are matched as plain substrings against lowercased text. Indic
    scripts are caseless, so .lower() is a no-op there and costs nothing.
  * Prefer word STEMS over inflected forms. Indic languages agglutinate
    heavily — "डूब" catches डूबना/डूब गया/डूब रहा, where "डूब गया" catches
    only one. The trade is occasional over-matching, which is the right way
    to be wrong here: a false CRITICAL wastes a volunteer's trip, a false
    MEDIUM can cost someone their life.
  * Keep entries at two characters or more. Single Indic characters appear
    inside unrelated words constantly.
"""

from __future__ import annotations

import re

# --------------------------------------------------------------------------
# CRITICAL — immediate threat to life. Err toward including a term here.
# --------------------------------------------------------------------------

CRITICAL_TERMS: tuple[str, ...] = (
    # --- English ---
    "unconscious", "not breathing", "cant breathe", "can't breathe",
    "cardiac", "heart attack", "bleeding heavily", "stabbed", "gunshot",
    "shot", "drowning", "drowned", "choking", "seizure", "convulsion",
    "stroke", "dying", "dead", "suicidal", "suicide", "electrocuted",
    "severe burns", "no pulse",
    # --- Hindi / Urdu, romanised ---
    "behosh", "behoshi", "saans nahi", "sans nahi", "dil ka daura",
    "khoon bah", "khoon beh", "doob", "dooba", "marne wala", "mar raha",
    "khudkushi", "atmahatya", "chaku mara", "goli lagi", "current laga",
    # --- Hindi / Marathi (Devanagari) ---
    "बेहोश", "बेशुद्ध", "सांस नहीं", "साँस नहीं", "श्वास येत नाही",
    "दिल का दौरा", "हृदयविकाराचा झटका", "हार्ट अटैक", "खून बह", "रक्तस्त्राव",
    "डूब", "बुडत", "बुडाल", "दम घुट", "मर रहा", "मरत आहे", "मृत",
    "आत्महत्या", "गोली", "चाकू", "करंट", "दौरा पड़",
    # --- Bengali ---
    "অজ্ঞান", "শ্বাস নিচ্ছে না", "শ্বাস বন্ধ", "নিঃশ্বাস", "হৃদরোগ",
    "হার্ট অ্যাটাক", "রক্তক্ষরণ", "রক্ত পড়", "ডুবে", "ডুবছে",
    "মারা যাচ্ছে", "মৃত", "আত্মহত্যা", "গুলি", "ছুরি", "খিঁচুনি",
    # --- Tamil ---
    "மயக்கம்", "மயக்கமட", "மூச்சு விடவில்லை", "மூச்சு நிற்க", "மூச்சுத் திணற",
    "மாரடைப்பு", "இரத்தப்போக்கு", "ரத்தம் வழி", "மூழ்கு", "மூழ்கி",
    "இறந்த", "இறக்கும்", "தற்கொலை", "துப்பாக்கி", "கத்தி", "வலிப்பு",
    # --- Telugu ---
    "స్పృహ కోల్పోయ", "స్పృహ లేదు", "ఊపిరి ఆడటం లేదు", "శ్వాస ఆగి",
    "గుండెపోటు", "రక్తస్రావం", "రక్తం కారు", "మునిగి", "మునిగిపోయ",
    "చనిపోతున్న", "మృతి", "ఆత్మహత్య", "తుపాకీ", "కత్తి", "మూర్ఛ",
    # --- Gujarati ---
    "બેભાન", "શ્વાસ નથી", "શ્વાસ બંધ", "હૃદયરોગનો હુમલો", "હાર્ટ એટેક",
    "લોહી વહે", "રક્તસ્રાવ", "ડૂબ", "ડૂબી", "મરી રહ્યો", "મૃત",
    "આત્મહત્યા", "ગોળી", "છરી", "આંચકી",
    # --- Punjabi (Gurmukhi) ---
    "ਬੇਹੋਸ਼", "ਸਾਹ ਨਹੀਂ", "ਸਾਹ ਬੰਦ", "ਦਿਲ ਦਾ ਦੌਰਾ", "ਖੂਨ ਵਗ",
    "ਡੁੱਬ", "ਡੁੱਬਿਆ", "ਮਰ ਰਿਹਾ", "ਮ੍ਰਿਤ", "ਆਤਮਹੱਤਿਆ", "ਗੋਲੀ", "ਚਾਕੂ",
)

# --------------------------------------------------------------------------
# HIGH — serious, needs a fast response, not necessarily life-threatening
# this minute.
# --------------------------------------------------------------------------

HIGH_TERMS: tuple[str, ...] = (
    # --- English ---
    "fire", "flood", "trapped", "collapse", "earthquake", "fracture",
    "accident", "injury", "injured", "urgent", "help immediately",
    "ambulance", "rescue", "elderly alone", "pregnant in pain", "landslide",
    "gas leak", "building fell",
    # --- Hindi / Urdu, romanised ---
    "aag", "baadh", "phansa", "phanse", "bhukamp", "durghatna", "ghayal",
    "zaroori", "jaroori", "madad", "bachao", "ambulance chahiye",
    "gas leak", "imarat gir",
    # --- Hindi / Marathi (Devanagari) ---
    "आग", "आगीत", "बाढ़", "पूर", "फंस", "अडक", "भूकंप", "दुर्घटना", "अपघात",
    "घायल", "जखमी", "ज़रूरी", "जरूरी", "तातडी", "मदद", "मदत", "बचाओ", "वाचवा",
    "एम्बुलेंस", "रुग्णवाहिका", "इमारत गिर", "कोसळ", "भूस्खलन", "गैस लीक",
    "गर्भवती", "फ्रैक्चर", "हड्डी टूट",
    # --- Bengali ---
    "আগুন", "বন্যা", "আটকে", "ধস", "ভূমিকম্প", "দুর্ঘটনা", "আহত",
    "জরুরি", "সাহায্য", "উদ্ধার", "অ্যাম্বুলেন্স", "বাড়ি ভেঙে",
    "গ্যাস লিক", "গর্ভবতী", "হাড় ভেঙে",
    # --- Tamil ---
    "தீ விபத்து", "தீப்பிடி", "வெள்ளம்", "சிக்கி", "இடிந்து", "நிலநடுக்கம்",
    "விபத்து", "காயம்", "காயமட", "அவசர", "உதவி", "மீட்பு", "ஆம்புலன்ஸ்",
    "நிலச்சரிவு", "எரிவாயு", "கர்ப்பிணி", "எலும்பு முறி",
    # --- Telugu ---
    "మంటలు", "అగ్ని ప్రమాదం", "వరద", "చిక్కుకు", "కూలి", "భూకంపం",
    "ప్రమాదం", "గాయ", "అత్యవసర", "సహాయం", "రక్షించ", "అంబులెన్స్",
    "కొండచరియ", "గ్యాస్ లీక్", "గర్భిణి", "ఎముక విరిగి",
    # --- Gujarati ---
    "આગ", "પૂર", "ફસા", "ધરાશાયી", "ધરતીકંપ", "અકસ્માત", "ઘાયલ",
    "તાત્કાલિક", "મદદ", "બચાવ", "એમ્બ્યુલન્સ", "ભૂસ્ખલન", "ગેસ લીક",
    "ગર્ભવતી", "હાડકું તૂટ",
    # --- Punjabi (Gurmukhi) ---
    "ਅੱਗ", "ਹੜ੍ਹ", "ਫਸ", "ਢਹਿ", "ਭੂਚਾਲ", "ਹਾਦਸਾ", "ਜ਼ਖਮੀ", "ਜ਼ਰੂਰੀ",
    "ਮਦਦ", "ਬਚਾਓ", "ਐਂਬੂਲੈਂਸ", "ਗੈਸ ਲੀਕ", "ਗਰਭਵਤੀ", "ਹੱਡੀ ਟੁੱਟ",
)

# --------------------------------------------------------------------------
# LOW — real, but nobody is in danger. Keep this list conservative: a term
# here can pull an urgent report DOWN, so anything ambiguous belongs above.
# --------------------------------------------------------------------------

LOW_TERMS: tuple[str, ...] = (
    # --- English ---
    "stray", "minor issue", "question", "tomorrow", "next week", "later",
    "information", "general inquiry", "not urgent",
    # --- Hindi, romanised ---
    "awara kutta", "mamuli", "jankari", "sawal", "koi jaldi nahi",
    # --- Hindi / Marathi (Devanagari) ---
    "आवारा", "भटक", "मामूली", "किरकोळ", "जानकारी", "माहिती", "सवाल", "प्रश्न",
    "कल", "उद्या", "बाद में", "नंतर", "जल्दी नहीं",
    # --- Bengali ---
    "বেওয়ারিশ", "সামান্য", "তথ্য", "প্রশ্ন", "আগামীকাল", "পরে",
    # --- Tamil ---
    "தெரு நாய்", "சிறிய", "தகவல்", "கேள்வி", "நாளை", "பிறகு",
    # --- Telugu ---
    "వీధి కుక్క", "చిన్న", "సమాచారం", "ప్రశ్న", "రేపు", "తర్వాత",
    # --- Gujarati ---
    "રખડતા", "નાની", "માહિતી", "પ્રશ્ન", "આવતીકાલે", "પછી",
    # --- Punjabi ---
    "ਅਵਾਰਾ", "ਮਾਮੂਲੀ", "ਜਾਣਕਾਰੀ", "ਸਵਾਲ", "ਕੱਲ੍ਹ", "ਬਾਅਦ",
)

# --------------------------------------------------------------------------
# Vulnerability signals — who is affected, which raises priority
# independently of the urgency label.
# --------------------------------------------------------------------------

VULNERABLE: dict[str, tuple[str, ...]] = {
    "child": (
        "child", "baby", "infant", "kid", "toddler", "newborn",
        "bachcha", "bacha", "bacche", "shishu",
        "बच्चा", "बच्चे", "बालक", "मूल", "लहान मूल", "शिशु",
        "শিশু", "বাচ্চা", "ছেলেটি",
        "குழந்தை", "சிறுவன்", "சிறுமி",
        "పిల్ల", "చిన్నారి", "బాలుడు",
        "બાળક", "બાળકી", "શિશુ",
        "ਬੱਚਾ", "ਬੱਚੀ", "ਬੱਚੇ",
    ),
    "elderly": (
        "elderly", "old man", "old woman", "senior citizen", "aged",
        "buzurg", "budha", "budhi", "bujurg",
        "बुजुर्ग", "बूढ़ा", "बूढ़ी", "वृद्ध", "म्हातार",
        "বৃদ্ধ", "বয়স্ক", "বুড়ো",
        "முதியவர்", "வயதான", "மூத்த குடிமக",
        "వృద్ధ", "ముసలి", "పెద్దవయసు",
        "વૃદ્ધ", "બુઝુર્ગ", "ઘરડા",
        "ਬਜ਼ੁਰਗ", "ਬੁੱਢਾ", "ਬਜੁਰਗ",
    ),
    "pregnant": (
        "pregnant", "expecting mother", "in labour", "in labor",
        "garbhvati", "garbhwati",
        "गर्भवती", "गर्भिणी", "प्रसव",
        "গর্ভবতী", "প্রসব",
        "கர்ப்பிணி", "பிரசவ",
        "గర్భిణి", "ప్రసవ",
        "ગર્ભવતી", "પ્રસૂતિ",
        "ਗਰਭਵਤੀ", "ਜਣੇਪਾ",
    ),
    "disabled": (
        "disabled", "handicapped", "wheelchair", "blind", "deaf", "paralysed",
        "divyang", "viklang",
        "दिव्यांग", "विकलांग", "अपंग", "व्हीलचेअर", "अंधा", "बहरा",
        "প্রতিবন্ধী", "হুইলচেয়ার", "অন্ধ",
        "மாற்றுத்திறனாளி", "சக்கர நாற்காலி", "பார்வையற்ற",
        "వికలాంగ", "దివ్యాంగ", "అంధ",
        "વિકલાંગ", "દિવ્યાંગ", "અંધ",
        "ਅਪਾਹਜ", "ਦਿਵਿਆਂਗ", "ਅੰਨ੍ਹਾ",
    ),
}

# --------------------------------------------------------------------------
# Time sensitivity — how long the reporter can wait. Independent of urgency:
# "my elderly neighbour needs her medicines by tonight" is not CRITICAL, but
# it is not something to look at next week either.
# --------------------------------------------------------------------------

IMMEDIATE_TERMS: tuple[str, ...] = (
    "immediately", "right now", "right away", "this minute", "at once",
    "hurry", "asap", "emergency",
    "abhi", "turant", "jaldi", "foran", "ekdum",
    "अभी", "तुरंत", "तात्काळ", "ताबडतोब", "जल्दी", "लगेच", "आत्ताच",
    "এখনই", "অবিলম্বে", "তাড়াতাড়ি", "জরুরি ভিত্তিতে",
    "உடனே", "இப்போதே", "உடனடியாக", "சீக்கிரம்",
    "వెంటనే", "ఇప్పుడే", "తక్షణమే", "త్వరగా",
    "તાત્કાલિક", "હમણાં", "તરત", "જલ્દી",
    "ਹੁਣੇ", "ਤੁਰੰਤ", "ਛੇਤੀ", "ਫੌਰਨ",
)

LATER_TERMS: tuple[str, ...] = (
    "tomorrow", "next week", "later", "no rush", "whenever", "sometime",
    "kal", "agle", "baad mein",
    "कल", "अगले", "बाद में", "उद्या", "नंतर", "पुढच्या",
    "আগামীকাল", "পরে", "পরের সপ্তাহে",
    "நாளை", "பிறகு", "அடுத்த வாரம்",
    "రేపు", "తర్వాత", "వచ్చే వారం",
    "આવતીકાલે", "પછી", "આવતા અઠવાડિયે",
    "ਕੱਲ੍ਹ", "ਬਾਅਦ", "ਅਗਲੇ ਹਫ਼ਤੇ",
)

# --------------------------------------------------------------------------
# Language detection
# --------------------------------------------------------------------------

# Each Indic script has its own Unicode block, so script alone identifies
# most of these languages outright.
_SCRIPT_RANGES: tuple[tuple[str, str], ...] = (
    ("bn", r"[ঀ-৿]"),   # Bengali
    ("pa", r"[਀-੿]"),   # Gurmukhi
    ("gu", r"[઀-૿]"),   # Gujarati
    ("ta", r"[஀-௿]"),   # Tamil
    ("te", r"[ఀ-౿]"),   # Telugu
)
_SCRIPT_RES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (code, re.compile(pattern)) for code, pattern in _SCRIPT_RANGES
)

# Hindi and Marathi share the Devanagari block, so script cannot separate
# them — these are the highest-frequency function words unique to each.
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_MARATHI_MARKERS = ("आहे", "नाही", "मला", "काय", "झाल", "करत", "येत")

# Romanised Hindi written in Latin script. Deliberately common function
# words rather than crisis vocabulary — those already appear in the term
# lists above, and matching them here would say nothing about language.
_HINGLISH_MARKERS = (
    "hai ", "nahi", "kya ", "madad", "yahan", "mera ", "meri ", "bhai",
    "gaya", "raha", "karo", "jaldi",
)


def detect_language(text: str) -> str:
    """Best-effort language tag for the alert card.

    Rough by design — it decides which flag a volunteer sees, not anything
    that affects routing, so a wrong guess is cosmetic. Script beats markers
    because script is unambiguous where it applies.
    """
    for code, pattern in _SCRIPT_RES:
        if pattern.search(text):
            return code
    if _DEVANAGARI_RE.search(text):
        return "mr" if any(m in text for m in _MARATHI_MARKERS) else "hi"
    low = f" {text.lower()} "
    if any(m in low for m in _HINGLISH_MARKERS):
        return "hi-Latn"
    return "en"
