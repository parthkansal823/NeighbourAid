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

CRITICAL - someone dies or is permanently harmed within minutes without help.
  Includes danger that is described but not named: a person who has stopped
  responding, moving, speaking or breathing; someone who went under water and
  has not surfaced; suspected poisoning or overdose; enclosed space with an
  engine running.
HIGH - serious harm, or will become critical within hours. Fire, flood,
  collapse, gas leak, serious injury, a vulnerable person trapped.
MEDIUM - a real problem but nobody is at risk of injury. Power cut, water
  supply, damaged road, uncollected refuse.
LOW - inconvenience or a request for information. Can safely wait.

Reports arrive in English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi,
Gujarati or Punjabi. Judge the situation, not the words used.

When a report is between two bands, choose the MORE urgent one: under-ranking
a real emergency costs someone help, over-ranking only costs a volunteer a
wasted trip.

Reply with only JSON: {"urgency":"CRITICAL|HIGH|MEDIUM|LOW"}"""


def is_enabled() -> bool:
    """Configured and the file exists. Checked before any import cost."""
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
