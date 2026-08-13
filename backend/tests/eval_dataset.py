"""Labelled evaluation set for urgency triage.

WHY THIS EXISTS

Until now the classifier's accuracy was nobody's guess but everybody's
assumption. "It works" was based on a handful of examples that were written
*after* looking at the vocabulary — which measures nothing, because the
vocabulary was built to match them.

This file is the opposite: reports written to describe realistic incidents,
labelled with the urgency a dispatcher would assign, and deliberately
including cases the keyword approach is expected to FAIL. A test set that
only contains cases you already pass tells you nothing about the next report
a real user types.

HOW LABELS WERE ASSIGNED

  CRITICAL - someone dies or is permanently harmed within minutes without help
  HIGH     - serious harm, or will become critical within hours
  MEDIUM   - real problem, no injury risk, hours-to-a-day response
  LOW      - inconvenience or a request for information; can wait

The label is what a human dispatcher would pick reading only this text.
Where a case is genuinely arguable it is marked `arguable=True` and excluded
from the headline accuracy figure, so the number is not padded by coin flips.

HOW TO USE

    python -m tests.eval_triage        # from backend/

Do not "fix" a failure by adding its exact words to vocab.py. That is
memorising the test, and it makes the score go up while the classifier gets
no better on anything else. Add the underlying *concept* in every language,
or accept the miss and record it as a known limit.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Case:
    text: str
    urgency: str
    lang: str
    # Why this case is here — kept so a future reader knows what a
    # regression on it would actually mean.
    note: str = ""
    # True when a competent dispatcher could reasonably pick a neighbouring
    # band. Excluded from headline accuracy.
    arguable: bool = False
    # True when the danger is implied rather than stated — the class of case
    # keyword matching is structurally unable to catch.
    implied: bool = False
    vulnerability: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)


CASES: tuple[Case, ...] = (
    # ---------------- CRITICAL, explicitly stated ----------------
    Case("A man collapsed on the road and is unconscious, not breathing",
         "CRITICAL", "en", note="textbook cardiac/respiratory arrest"),
    Case("Ek aadmi behosh ho gaya hai, saans nahi aa rahi, jaldi madad karo",
         "CRITICAL", "hi-Latn", note="same, romanised Hindi"),
    Case("एक आदमी बेहोश हो गया है, सांस नहीं आ रही",
         "CRITICAL", "hi", note="same, Devanagari"),
    Case("একজন লোক অজ্ঞান হয়ে গেছে, শ্বাস নিচ্ছে না",
         "CRITICAL", "bn"),
    Case("ஒருவர் மயக்கமடைந்துள்ளார், மூச்சு விடவில்லை",
         "CRITICAL", "ta"),
    Case("ఒక వ్యక్తి స్పృహ కోల్పోయాడు, ఊపిరి ఆడటం లేదు",
         "CRITICAL", "te"),
    Case("एक माणूस बेशुद्ध झाला आहे, श्वास येत नाही",
         "CRITICAL", "mr"),
    Case("એક માણસ બેભાન થઈ ગયો છે, શ્વાસ નથી આવતો",
         "CRITICAL", "gu"),
    Case("ਇੱਕ ਆਦਮੀ ਬੇਹੋਸ਼ ਹੋ ਗਿਆ ਹੈ, ਸਾਹ ਨਹੀਂ ਆ ਰਿਹਾ",
         "CRITICAL", "pa"),
    Case("Child fell into the canal and has gone under, cannot swim",
         "CRITICAL", "en", vulnerability="child"),
    Case("मेरी माँ को दिल का दौरा पड़ा है, वो जवाब नहीं दे रही",
         "CRITICAL", "hi", vulnerability="elderly"),
    Case("ரத்தம் நிற்காமல் வழிகிறது, மயக்கம் வருகிறது",
         "CRITICAL", "ta", note="heavy bleeding + fainting"),

    # ---------------- CRITICAL, danger implied not stated -------------
    Case("He has been in the closed garage with the car running for 20 minutes and won't answer",
         "CRITICAL", "en", implied=True,
         note="carbon monoxide — no keyword names the danger"),
    Case("She took the whole bottle of her tablets after we argued and is very sleepy now",
         "CRITICAL", "en", implied=True, note="overdose, no explicit term"),
    Case("बच्चा नाले में गिर गया और अब दिख नहीं रहा",
         "CRITICAL", "hi", implied=True, vulnerability="child",
         note="child submerged; 'drowning' never written"),
    Case("Baba ko subah se hilna dulna band hai, aankh khuli hai par bol nahi rahe",
         "CRITICAL", "hi-Latn", implied=True, vulnerability="elderly",
         note="likely stroke, described only by symptoms"),
    Case("बिजली के तार पर गिरे आदमी को छूने पर झटका लगा, अब वो हिल नहीं रहा",
         "CRITICAL", "hi", implied=True, note="electrocution described indirectly"),

    # ---------------- HIGH ----------------
    Case("Fire in the building, people are still trapped on the second floor",
         "HIGH", "en"),
    Case("इमारत में आग लगी है, लोग फंसे हैं", "HIGH", "hi"),
    Case("বাড়িতে আগুন লেগেছে, একটি শিশু আটকে আছে", "HIGH", "bn",
         vulnerability="child"),
    Case("கட்டிடத்தில் தீப்பிடித்துள்ளது, மக்கள் சிக்கியுள்ளனர்", "HIGH", "ta"),
    Case("భవనంలో మంటలు, ప్రజలు చిక్కుకున్నారు", "HIGH", "te"),
    Case("ਇਮਾਰਤ ਵਿੱਚ ਅੱਗ ਲੱਗੀ ਹੈ, ਲੋਕ ਫਸੇ ਹਨ", "HIGH", "pa"),
    Case("Flood water has entered the ground floor, an elderly woman lives alone there",
         "HIGH", "en", vulnerability="elderly"),
    Case("Road accident near the flyover, two people are injured and bleeding",
         "HIGH", "en"),
    Case("गर्भवती महिला को तेज़ दर्द हो रहा है, अस्पताल दूर है",
         "HIGH", "hi", vulnerability="pregnant"),
    Case("Gas cylinder is leaking in the kitchen, whole floor smells",
         "HIGH", "en"),

    # ---------------- HIGH, implied ----------------
    Case("The water in the river has risen to the temple steps in one hour and is still coming up",
         "HIGH", "en", implied=True, note="flash flood inferred from rate of rise"),
    Case("Cracks appeared in our wall after the digging next door and they are getting wider",
         "HIGH", "en", implied=True, note="structural collapse risk"),

    # ---------------- MEDIUM ----------------
    Case("Power has been out in the whole sector since morning",
         "MEDIUM", "en"),
    Case("पूरे सेक्टर में सुबह से बिजली नहीं है", "MEDIUM", "hi"),
    Case("No drinking water supply in our lane for two days",
         "MEDIUM", "en"),
    Case("रास्त्यावर मोठा खड्डा पडला आहे, वाहनांना अडचण होते",
         "MEDIUM", "mr"),
    Case("Street light has been broken for a week, the lane is completely dark at night",
         "MEDIUM", "en", arguable=True, note="safety-adjacent; HIGH is defensible"),
    Case("Garbage has not been collected for four days and it is starting to smell",
         "MEDIUM", "en"),

    # ---------------- LOW ----------------
    Case("Stray dog has a minor injury on its leg, can wait until tomorrow",
         "LOW", "en", note="'injury' is a HIGH keyword; the qualifiers say LOW"),
    Case("रखडता कुत्रा, किरकोळ जखम, उद्या बघितले तरी चालेल", "LOW", "mr"),
    Case("I just want to know which hospital is nearest to sector 22",
         "LOW", "en", note="information request, no incident"),
    Case("मुझे बस यह जानकारी चाहिए कि पास का अस्पताल कौन सा है",
         "LOW", "hi"),
    Case("Can someone tell me next week's blood donation camp timing",
         "LOW", "en"),
    Case("তথ্য দরকার - কাছের হাসপাতাল কোথায়", "LOW", "bn"),
)


def by_language() -> dict[str, list[Case]]:
    out: dict[str, list[Case]] = {}
    for c in CASES:
        out.setdefault(c.lang, []).append(c)
    return out


def scored() -> tuple[Case, ...]:
    """Cases that count toward headline accuracy."""
    return tuple(c for c in CASES if not c.arguable)
