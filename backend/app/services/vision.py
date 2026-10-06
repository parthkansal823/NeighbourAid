"""Optional local vision model, used to check photo evidence against the claim.

WHAT PROBLEM THIS SOLVES

`services/photo.py` scores attached photos, but it can only see that a file is
a real, large-enough image: dimensions, decodability, byte count. It then adds
up to 30 points to `verified_score`.

Nothing checks what the photo is *of*. Attach a picture of your lunch to a
"fire" report and it scores exactly like a picture of a fire. Since
verified_score is what volunteers read as "several signals agree, this is
real", that is the one number in the app most worth lying to, and the easiest
to lie to.

WHAT IT DOES

Asks a small local vision model one narrow question per alert: does this photo
plausibly show a {category} incident? Only three answers are accepted — yes,
no, unclear.

WHY IT CAN ONLY EVER SUBTRACT

A confirmation is never used to raise the score, only a clear contradiction to
lower it. This is the same one-directional rule the urgency upgrade follows,
pointed the other way, and for the same reason: the model is the weaker judge.

  * A false "yes" would hand an attacker the thing they wanted — a model
    vouching for a fake photo is worse than no model, because the score now
    carries false authority.
  * A false "no" costs an honest reporter some of a bonus they only got for
    attaching *any* image. The alert still stands on witnesses, corroborating
    reports and weather.

So the failure this design allows is the recoverable one.

COST AND DEFAULTS

Off unless both LLM_VISION_MODEL_PATH and LLM_VISION_MMPROJ_PATH point at real
files, and never on the request path — it runs inside background enrichment,
after the alert has already reached volunteers. See models/README.md for which
weights and why.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path

from ..core.config import settings

log = logging.getLogger(__name__)

_vlm = None
_load_failed = False
_lock = threading.Lock()

# The three answers we accept. Anything else is treated as "unclear", because
# a model that has gone off-script is not a model to take evidence from.
YES, NO, UNCLEAR = "yes", "no", "unclear"

# How much of the photo bonus a clear contradiction removes. Not all of it:
# the check is one small model looking at one frame, and a genuine photo taken
# in smoke, at night, or from far away is a plausible "no". Enough to cancel
# the incentive to attach a decorative image, not enough to erase a real one.
CONTRADICTION_PENALTY = 20

# What each category should look like, in the model's terms rather than ours.
# "violence" is deliberately absent: asking a 500M model to judge whether a
# photo depicts violence invites both confident nonsense and a class of false
# accusation this app should not automate. Unlisted categories are skipped.
_CATEGORY_LOOKS_LIKE = {
    "fire": "fire, flames, burning, or heavy smoke",
    "flood": "flooding, standing water, or water covering ground or roads",
    "accident": "a vehicle crash, damaged vehicles, or a road accident",
    "structure": "a damaged or collapsed building, cracked walls, or rubble",
    "medical": "an injured or collapsed person, or a medical emergency",
    "animal": "an animal",
    "power": "electrical equipment, power lines, or a transformer",
    "water": "water supply, taps, pipes, or water containers",
    "gas": "a gas cylinder, gas pipes, or a gas installation",
}


def is_enabled() -> bool:
    """Both files present, and not switched off.

    Honours the same NA_DISABLE_AI_MODEL kill switch as the text model, so one
    environment variable turns off every model in the app rather than leaving
    this one running because it was added later.
    """
    if os.getenv("NA_DISABLE_AI_MODEL", "").strip() not in ("", "0", "false"):
        return False
    model, proj = settings.LLM_VISION_MODEL_PATH, settings.LLM_VISION_MMPROJ_PATH
    return bool(model and proj) and Path(model).is_file() and Path(proj).is_file()


def _get_vlm():
    """Load once. Returns None if unavailable — never raises."""
    global _vlm, _load_failed
    if _vlm is not None or _load_failed:
        return _vlm
    with _lock:
        if _vlm is not None or _load_failed:
            return _vlm
        try:
            from llama_cpp import Llama  # noqa: PLC0415 — optional dependency
            from llama_cpp.llama_chat_format import (  # noqa: PLC0415
                MTMDChatHandler,
            )
        except ImportError:
            _load_failed = True
            log.warning(
                "Vision model configured but llama-cpp-python is not installed; "
                "photo evidence keeps its size-only scoring. "
                "See backend/requirements-llm.txt."
            )
            return None
        try:
            handler = MTMDChatHandler(clip_model_path=settings.LLM_VISION_MMPROJ_PATH)
            _vlm = Llama(
                model_path=settings.LLM_VISION_MODEL_PATH,
                chat_handler=handler,
                # Image tokens are the reason this is not the text model's
                # 1024: one encoded frame alone can exceed that.
                n_ctx=4096,
                n_threads=settings.LLM_THREADS,
                n_gpu_layers=settings.LLM_GPU_LAYERS,
                verbose=False,
                seed=0,
            )
            log.info("Vision model loaded from %s", settings.LLM_VISION_MODEL_PATH)
        except Exception as exc:  # noqa: BLE001 — degrade, never crash
            _load_failed = True
            log.warning("Could not load vision model, skipping photo checks: %s", exc)
    return _vlm


def _describe_sync(data_url: str) -> str:
    """Caption the photo. Captioning, not judging — see `verdict_for`."""
    vlm = _get_vlm()
    if vlm is None:
        return ""
    try:
        out = vlm.create_chat_completion(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {
                            "type": "text",
                            "text": (
                                "Describe what is happening in this photo in one "
                                "short sentence. Name the main objects you see."
                            ),
                        },
                    ],
                },
            ],
            temperature=0.0,
            max_tokens=48,
        )
        return (out["choices"][0]["message"]["content"] or "").strip()
    except Exception as exc:  # noqa: BLE001
        log.info("Vision description failed: %s", exc)
        return ""


def verdict_for(description: str, category: str) -> str:
    """Turn a caption into YES / NO / UNCLEAR for a claimed category.

    Deliberately split from the model call, and deliberately not asked of the
    model itself.

    Asking a 500M vision model "does this photo show fire? answer yes or no"
    returned "no" for every image tried, including ones it could describe
    perfectly well when simply asked to. Captioning is what a model this size
    is good at; following a yes/no rubric is not. So the model describes, and
    this decides — which also makes the decision deterministic, testable
    without any weights loaded, and reuses the same multilingual CONCEPTS map
    that cross-language corroboration already depends on.

    NO is returned only when the caption names some incident concept and none
    of them is the claimed one. A caption that names nothing recognisable
    ("the image is green in colour") is UNCLEAR, never NO: an unhelpful
    caption is a fact about the model, not evidence against the reporter.
    """
    from .ai import concepts_in  # noqa: PLC0415 — see module docstring

    if not description or category not in _CATEGORY_LOOKS_LIKE:
        return UNCLEAR
    seen = concepts_in(description)
    if not seen:
        return UNCLEAR
    # The alert categories and the concept keys mostly share names; this maps
    # the few that differ.
    expected = _CATEGORY_CONCEPT.get(category, category)
    return YES if expected in seen else NO


# Alert category -> the CONCEPTS key that would confirm it. Only the names
# that differ need an entry.
_CATEGORY_CONCEPT = {
    "structure": "collapse",
    "missing": "missing_person",
    "water": "flood",
}


async def describe_photo(data_url: str) -> str:
    """Caption one photo, or "" if the model cannot.

    Runs in a worker thread — image encoding plus generation is blocking C,
    and on the event loop it would stall the WebSocket heartbeats that keep
    volunteers connected. Every failure path returns "", which `verdict_for`
    reads as UNCLEAR, so a caller never has to distinguish "the model could
    not tell" from "the model was not there".
    """
    if not is_enabled():
        return ""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_describe_sync, data_url),
            timeout=settings.LLM_VISION_TIMEOUT_SECONDS,
        )
    except (TimeoutError, asyncio.TimeoutError):
        log.info(
            "Vision check timed out after %ss", settings.LLM_VISION_TIMEOUT_SECONDS
        )
        return ""
    except Exception as exc:  # noqa: BLE001
        log.info("Vision check call failed: %s", exc)
        return ""


async def check_photo(data_url: str, category: str) -> str:
    """Describe the photo, then decide. YES, NO or UNCLEAR."""
    return verdict_for(await describe_photo(data_url), category)


async def review_photos(photos: list[str], category: str) -> dict:
    """Review the attached photos and say how much evidence to take back.

    Only the first photo is examined. A second inference doubles the cost for
    a case that barely occurs — someone attaching one honest photo and one
    decorative one — and the penalty is capped anyway, so a second "no" could
    not subtract more.

    Returns {"verdict", "penalty", "finding"}; a zero penalty means leave the
    existing photo score exactly as it is.
    """
    none_taken = {"verdict": UNCLEAR, "penalty": 0, "finding": ""}
    if not photos or not is_enabled():
        return none_taken
    if category not in _CATEGORY_LOOKS_LIKE:
        # No description for this category, so there is no question to ask.
        return none_taken

    verdict = await check_photo(photos[0], category)
    if verdict != NO:
        # Confirmations deliberately earn nothing — see the module docstring.
        return {"verdict": verdict, "penalty": 0, "finding": ""}

    log.info("Vision contradicted the %s claim on an attached photo", category)
    return {
        "verdict": NO,
        "penalty": CONTRADICTION_PENALTY,
        "finding": "Attached photo does not appear to show the reported incident.",
    }
