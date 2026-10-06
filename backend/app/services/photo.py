"""Lightweight server-side photo checks.

Avoids loading a heavy vision model — running on a free Render tier next
to a 1.6 GB HF triage model means every extra MB matters. Instead we do
three cheap, useful things on the base64 blob the client uploaded:

1. Validate it's a real image (not a malicious/empty blob).
2. Measure rough size / dimensions to grade evidence quality.
3. Derive a small "visual evidence" score bump for verification.
"""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any, List

log = logging.getLogger(__name__)

try:
    from PIL import Image  # type: ignore
except ImportError:  # pragma: no cover — optional runtime dep
    Image = None  # type: ignore


_DATA_URL_RE = re.compile(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


def _decode(data_url: str) -> tuple[str, bytes] | None:
    m = _DATA_URL_RE.match(data_url or "")
    if not m:
        return None
    mime, payload = m.group(1), m.group(2)
    try:
        return mime, base64.b64decode(payload, validate=True)
    except (ValueError, base64.binascii.Error):
        return None


def _analyze_one(data_url: str) -> dict[str, Any] | None:
    decoded = _decode(data_url)
    if decoded is None:
        return None
    mime, raw = decoded
    entry = {"mime": mime.lower(), "bytes": len(raw)}

    if Image is None:
        entry.update({"width": None, "height": None, "is_valid": len(raw) > 1000})
        return entry

    try:
        with Image.open(io.BytesIO(raw)) as im:
            im.verify()
        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
            entry["width"] = w
            entry["height"] = h
            entry["is_valid"] = bool(w >= 160 and h >= 160 and len(raw) > 2000)
    except Exception as exc:  # noqa: BLE001
        log.debug("photo.verify failed: %s", exc)
        entry["is_valid"] = False
        entry["width"] = entry["height"] = None
    return entry


def analyze_photos(photos: List[str]) -> dict[str, Any]:
    """Return an analysis bundle ready to store on the alert document."""
    if not photos:
        return {
            "photo_checks": [],
            "photo_evidence_score": 0,
            "photo_confidence": 0.0,
            "photo_findings": "",
        }

    checks: list[dict[str, Any]] = []
    for p in photos:
        info = _analyze_one(p)
        if info is not None:
            checks.append(info)

    valid = [c for c in checks if c.get("is_valid")]
    n_valid = len(valid)
    n_total = len(checks)

    score = min(30, 12 * n_valid)
    if n_valid >= 3:
        score = min(30, score + 4)
    confidence = (n_valid / max(1, n_total)) if n_total else 0.0

    if n_valid == 0:
        findings = "No usable photo evidence (images too small or corrupt)."
    elif n_valid == 1:
        findings = "1 photo attached — visual corroboration."
    else:
        findings = f"{n_valid} photos attached — strong visual corroboration."

    return {
        "photo_checks": checks,
        "photo_evidence_score": score,
        "photo_confidence": round(confidence, 2),
        "photo_findings": findings,
    }
