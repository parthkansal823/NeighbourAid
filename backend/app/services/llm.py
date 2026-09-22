"""Optional local LLM, consulted only where the keyword classifier is unsure.

WHY IT IS OPTIONAL, AND OFF BY DEFAULT

The classifier in vocab.py answers every report in ~0.05 ms using no model
weights, and scores 90% on tests/eval_dataset.py. That is the floor, and it
must keep working on a 512 MB host with no GPU. So this module is additive:
absent model, absent llama_cpp, or a slow load all degrade to exactly the
behaviour you get today.

WHY IT IS NOT ASKED ABOUT EVERY REPORT

Measured on the same 40 cases, the LLM alone scores *worse* than the
classifier — 70% for Qwen-3B, 90% for Qwen-7B against the classifier's 90% —
mostly by promoting HIGH to CRITICAL until the label stops carrying
information. What it is genuinely better at is the case the classifier is
blind to: danger described but never named ("closed garage, engine running,
won't answer"). The classifier reports that case honestly, by falling through
to its MEDIUM default with reason `keyword:default`.

So the gate is: ask the model **only when the classifier matched nothing**.
That was 22% of reports in the benchmark, and it is where the model earns its
seconds.

    keyword/pattern only      90%  ·  implied 5/7  ·  0.05 ms
    LLM only (7B)             90%  ·  implied 6/7  ·  2.8 s
    hybrid (this module)      90%  ·  implied 6/7  ·  0.1 ms median

WHY IT NEVER RUNS ON THE REQUEST PATH

Inference measured 1.5-2.8 s median and up to 9.4 s worst case, well past the
budget for someone pressing "send" in an emergency. It runs inside the
existing background enrichment task instead: the alert posts immediately with
the classifier's answer, and an upgrade is re-broadcast over the WebSocket if
the model disagrees.

ENABLING IT

    pip install llama-cpp-python \
      --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
    LLM_MODEL_PATH=models/Qwen2.5-7B-Instruct-Q4_K_M.gguf

Deliberately NOT in requirements.txt: the free hosts this project targets
have 512 MB, and a 7B model needs ~5 GB. See models/README.md.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
from pathlib import Path

from ..core.config import settings

log = logging.getLogger(__name__)

_llm = None
_load_failed = False
# Model load is slow and not thread-safe; a lock stops two concurrent alerts
# from each building their own copy and doubling the memory.
_lock = threading.Lock()

BANDS = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
_BAND_RE = re.compile("|".join(BANDS))

# The rubric is the product decision, written out rather than left to the
# model's idea of "urgent". These bands must mean what they mean in vocab.py,
# or the two engines cannot be combined.
SYSTEM = """You are a dispatcher for an emergency response network in India.
Classify each report into exactly one urgency band.

CRITICAL - a person dies or is permanently harmed within minutes without help.
  Includes danger described but not named: someone who has stopped responding,
  moving, speaking or breathing; someone who went under water and has not
  surfaced; suspected poisoning or overdose; enclosed space with an engine running.
HIGH - a person is at real risk of injury, or will be within hours. Fire, flood,
  building collapse, gas leak, serious injury, a vulnerable person trapped.
  A hazard that is actively worsening toward one of these counts, even if
  nobody is hurt yet: cracks that are widening, a wall or pole leaning further,
  ground subsiding, water still rising. "Getting worse" is itself the danger.
MEDIUM - a real problem that harms nobody. This band OWNS routine civic
  complaints, however long-running or unpleasant: no water supply, power cut,
  potholes or damaged road, uncollected garbage or smell, blocked drain,
  street light out. Duration and annoyance never promote these to HIGH.
LOW - inconvenience or a request for information. Can safely wait.

Reports arrive in English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi,
Gujarati or Punjabi. Judge the situation, not the words used.

Decide by asking: could a PERSON be harmed, now or as this keeps developing?
If nobody can be physically harmed, it is MEDIUM or LOW no matter how bad the
inconvenience or how long it has gone on. Only when a person is genuinely at
risk, and you are torn between two bands, choose the more urgent one.

Reply with only JSON: {"urgency":"CRITICAL|HIGH|MEDIUM|LOW"}"""
# Every clause above is load-bearing, measured on tests/eval_dataset.py with
# `python -m tests.eval_hybrid`. The earlier rubric ended with a blanket "when
# between two bands choose the MORE urgent one", and a small model reads that
# as permission to promote anything annoying: a 1B model sent "no water supply
# for two days", "pothole in the road" and "garbage uncollected for four days"
# to HIGH, which is how a feed stops carrying signal. Two changes fixed it
# without losing the reason the model is here at all:
#
#   * MEDIUM now explicitly OWNS civic complaints and says duration does not
#     promote them, because the model's failure was reasoning from how long
#     the problem had lasted rather than from whether anyone can be hurt.
#   * The tie-break is scoped to reports where a person is genuinely at risk,
#     so it no longer applies to the civic cases it was never meant for.
#
# The "getting worse is itself the danger" clause in HIGH is what catches
# implied danger — widening cracks, water still rising — which is the whole
# reason a model beats keyword matching. Dropping it costs implied 7/7 -> 6/7
# and puts a report back below its true urgency. Re-run the eval before
# touching any of this.


HEADLINE_SYSTEM = """You write one-line headlines for an emergency dispatch feed
in India. A volunteer scans dozens of these to decide which to open first.

Rewrite the report as ONE short line, at most 70 characters.

Rules:
- Lead with WHAT is happening and WHERE, in that order.
- Drop every filler: greetings, "umm", "hello can you hear me", "so basically",
  the reporter narrating how they came to notice it.
- Keep specifics that help someone find or judge it: a gate number, a landmark,
  a floor, how many people, whether it is still getting worse.
- Keep the report's own language. A Hindi report gets a Hindi headline.
- State only what the report states. Never add a detail that is not there.
- No quotes, no trailing full stop, no preamble — the line itself, nothing else.

Reply with only JSON: {"headline":"..."}"""

# The model returns JSON; this pulls the value out without trusting it to be
# well-formed, since a small model occasionally emits a bare string instead.
_HEADLINE_RE = re.compile(r'"headline"\s*:\s*"((?:[^"\\]|\\.)*)"')

# A hard ceiling regardless of what the model returns. The card layout that
# renders this wraps past roughly this width, and a "headline" that wraps to
# three lines defeats the point of having one.
HEADLINE_MAX = 90


def is_enabled() -> bool:
    """Configured, not switched off, and the file exists. Checked before any
    import cost.

    NA_DISABLE_AI_MODEL is a hard kill switch that beats LLM_MODEL_PATH. CI
    has set it since the workflow was written (.github/workflows/ci.yml) on
    the assumption that it forced the keyword fallback — but nothing read it,
    so it protected nothing. That was harmless only because CI never sets
    LLM_MODEL_PATH either; the moment anyone added a model to a test
    environment, the flag meant to stop it would have done nothing. Honouring
    it here is what makes `NA_DISABLE_AI_MODEL=1` a real guarantee: no model
    load, no inference, no multi-GB download, whatever else is configured.
    """
    if os.getenv("NA_DISABLE_AI_MODEL", "").strip() not in ("", "0", "false"):
        return False
    path = settings.LLM_MODEL_PATH
    return bool(path) and Path(path).is_file()


def _get_llm():
    """Load once. Returns None if unavailable — never raises."""
    global _llm, _load_failed
    if _llm is not None or _load_failed:
        return _llm
    with _lock:
        if _llm is not None or _load_failed:
            return _llm
        try:
            from llama_cpp import Llama  # noqa: PLC0415 — optional dependency
        except ImportError:
            _load_failed = True
            log.warning(
                "LLM_MODEL_PATH is set but llama-cpp-python is not installed; "
                "triage stays on the keyword classifier. See models/README.md."
            )
            return None
        try:
            _llm = Llama(
                model_path=settings.LLM_MODEL_PATH,
                n_ctx=1024,
                n_threads=settings.LLM_THREADS,
                n_gpu_layers=settings.LLM_GPU_LAYERS,
                verbose=False,
                seed=0,  # deterministic, so the same report classifies alike
            )
            log.info("Local LLM loaded from %s", settings.LLM_MODEL_PATH)
        except Exception as exc:  # noqa: BLE001 — degrade, never crash
            _load_failed = True
            log.warning("Could not load local LLM, keeping classifier: %s", exc)
    return _llm


def _classify_sync(text: str) -> str | None:
    llm = _get_llm()
    if llm is None:
        return None
    try:
        out = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": text},
            ],
            temperature=0.0,
            max_tokens=24,
            response_format={"type": "json_object"},
        )
        content = out["choices"][0]["message"]["content"].upper()
    except Exception as exc:  # noqa: BLE001
        log.info("LLM inference failed: %s", exc)
        return None
    match = _BAND_RE.search(content)
    return match.group(0) if match else None


async def classify(text: str) -> str | None:
    """Urgency band from the local model, or None if it cannot answer.

    Runs in a worker thread: llama.cpp inference is blocking C, and calling it
    directly on the event loop would stall every other request — including the
    WebSocket heartbeats keeping volunteers connected.
    """
    if not is_enabled():
        return None
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_classify_sync, text),
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
    except (TimeoutError, asyncio.TimeoutError):
        log.info("LLM timed out after %ss", settings.LLM_TIMEOUT_SECONDS)
        return None
    except Exception as exc:  # noqa: BLE001
        log.info("LLM call failed: %s", exc)
        return None


def _summarise_sync(text: str) -> str | None:
    llm = _get_llm()
    if llm is None:
        return None
    try:
        out = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": HEADLINE_SYSTEM},
                {"role": "user", "content": text},
            ],
            temperature=0.0,
            # Indic scripts cost noticeably more tokens per character than
            # Latin, so this is sized for a Devanagari headline, not an
            # English one — the English case simply stops early.
            max_tokens=96,
            response_format={"type": "json_object"},
        )
        content = out["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001 — degrade, never crash
        log.info("LLM summarise failed: %s", exc)
        return None

    match = _HEADLINE_RE.search(content)
    headline = match.group(1) if match else content.strip().strip('"')
    # Unescape the few sequences a JSON string can carry.
    headline = headline.replace('\\"', '"').replace("\n", " ").replace("\\\\", "\\")
    headline = " ".join(headline.split())
    if not headline:
        return None
    if len(headline) > HEADLINE_MAX:
        headline = headline[:HEADLINE_MAX].rsplit(" ", 1)[0] + "…"
    return headline if _is_faithful(text, headline) else None


def _is_faithful(source: str, headline: str) -> bool:
    """Reject a headline that says something the report did not.

    The prompt asks for this; a 1B model does not reliably obey, and both
    failures were caught on real inputs rather than imagined:

      * A report of a transformer making a loud noise and throwing sparks came
        back as "Transformer Sparks Fire in Local Area". There is no fire in
        that report. In a dispatch feed that word changes what a volunteer
        brings and who else they call.
      * A Hindi report came back with an English headline, so the reporter
        could no longer read their own alert.

    Cheap deterministic checks, not another model call. Both reuse machinery
    that already exists for other reasons, and either failing simply drops
    back to the synchronous headline — which is always correct, just wordy.
    """
    # Imports here rather than at module scope: ai.py imports vocab, and llm
    # is imported from enrich alongside both. Keeping this local avoids
    # wiring a new import cycle into an optional module.
    from .ai import concepts_in  # noqa: PLC0415
    from .vocab import detect_language  # noqa: PLC0415

    invented = concepts_in(headline) - concepts_in(source)
    if invented:
        log.info(
            "Rejected LLM headline: introduced %s not in the report — %r",
            ", ".join(sorted(invented)),
            headline,
        )
        return False

    # Script/language drift. detect_language answers per script, so this
    # catches the Devanagari-in, Latin-out case that actually happened.
    if detect_language(source) != detect_language(headline):
        log.info(
            "Rejected LLM headline: answered in %s for a %s report — %r",
            detect_language(headline),
            detect_language(source),
            headline,
        )
        return False

    return True


async def summarise(text: str) -> str | None:
    """A scannable one-line headline, or None if the model cannot answer.

    Never call this on the request path. `generate_headline` in services/ai.py
    is the synchronous answer the reporter and the volunteer feed get
    immediately; this runs afterwards in the background enrichment task and
    replaces it only if it produced something better.

    Same worker-thread treatment as `classify`: llama.cpp inference is
    blocking C and would otherwise stall the event loop, including the
    WebSocket heartbeats holding volunteers online.
    """
    if not is_enabled():
        return None
    stripped = (text or "").strip()
    # Nothing to summarise: a line this short IS the headline, and asking a
    # model to shorten it can only lose detail or invent some.
    if len(stripped) <= HEADLINE_MAX:
        return None
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_summarise_sync, stripped),
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
    except (TimeoutError, asyncio.TimeoutError):
        log.info("LLM summarise timed out after %ss", settings.LLM_TIMEOUT_SECONDS)
        return None
    except Exception as exc:  # noqa: BLE001
        log.info("LLM summarise call failed: %s", exc)
        return None
