"""Optional backend-local photo captioning with a conservative verdict.

The model captions a photo without being shown the reporter's category.
`verdict_for` then compares incident concepts in that caption with the claim.
Negated, uncertain, mixed or non-visual contradictions are treated as unclear;
a photo cannot rule out gas, power, water or medical problems.

A supported mismatch can subtract a capped score penalty. A matching caption
never adds points, and neither result proves an incident or authenticates the
photo. Model mistakes remain possible, even after these guards.

Off unless both vision weight paths are configured. Inference runs in
background enrichment with a bounded slot and timeout; failures have no score
effect. See models/README.md for setup and limitations.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from ..core.config import settings
from .inference import InferenceSlot
from .evidence import uncertain_caption

log = logging.getLogger(__name__)

_vlm = None
_load_failed = False
_lock = threading.Lock()
_inference = InferenceSlot()

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
            handler = MTMDChatHandler(
                clip_model_path=settings.LLM_VISION_MMPROJ_PATH, verbose=False,
            )
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
            log.info("Vision model loaded")
        except Exception:  # noqa: BLE001 — exception messages can contain inputs
            _load_failed = True
            log.warning("Could not load vision model; skipping photo checks")
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
        content = out["choices"][0]["message"]["content"]
        return content.strip() if isinstance(content, str) else ""
    except Exception:  # noqa: BLE001
        log.info("Vision description failed; skipping photo check")
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
    # "No fire" must not become YES simply because it contains "fire".
    # An unsure model is not evidence against an honest reporter either.
    if uncertain_caption(description):
        return UNCLEAR
    seen = concepts_in(description)
    if not seen:
        return UNCLEAR
    # The alert categories and the concept keys mostly share names; this maps
    # the few that differ.
    expected = _CATEGORY_CONCEPT.get(category, category)
    if expected in seen:
        return YES
    # A static picture cannot disprove a gas leak, power outage, water-supply
    # issue or medical symptoms. Mixed scenes are also inconclusive.
    if category in {"gas", "power", "water", "medical"} or len(seen) > 1:
        return UNCLEAR
    return NO


# Alert category -> the CONCEPTS key that would confirm it. Only the names
# that differ need an entry.
_CATEGORY_CONCEPT = {
    "structure": "collapse",
    "missing": "missing_person",
    "water": "flood",
    "gas": "gas_leak",
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
    return await _inference.run(
        lambda: _describe_sync(data_url),
        timeout=settings.LLM_VISION_TIMEOUT_SECONDS, fallback="",
    )


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

    log.info("Vision contradicted the claim on an attached photo")
    return {
        "verdict": NO,
        "penalty": CONTRADICTION_PENALTY,
        "finding": "Attached photo does not appear to show the reported incident.",
    }
