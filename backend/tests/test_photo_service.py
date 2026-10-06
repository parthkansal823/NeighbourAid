"""Unit tests for the photo evidence scorer.

Each test uses Pillow to construct a real image in-memory so we exercise the
full base64 → decode → verify → measure pipeline without depending on disk
fixtures. Keeps the suite fast and deterministic.
"""

from __future__ import annotations

import base64
import io

import pytest

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

from app.services.photo import analyze_photos  # noqa: E402


def _image_data_url(width: int, height: int, color: tuple = (200, 30, 30)) -> str:
    """Build a tiny solid-colour JPEG and return it as a data: URL."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def test_analyze_empty_list_returns_zero_evidence():
    out = analyze_photos([])
    assert out["photo_evidence_score"] == 0
    assert out["photo_confidence"] == 0.0
    assert out["photo_findings"] == ""


def test_analyze_one_valid_photo_bumps_score():
    photo = _image_data_url(640, 480)
    out = analyze_photos([photo])
    assert out["photo_evidence_score"] == 12
    assert out["photo_confidence"] == 1.0
    assert "1 photo" in out["photo_findings"]


def test_analyze_three_distinct_photos_caps_at_30():
    photos = [_image_data_url(640, 480, color) for color in ((200, 30, 30), (30, 200, 30), (30, 30, 200))]
    out = analyze_photos(photos)
    assert out["photo_evidence_score"] == 30
    assert "contents not verified" in out["photo_findings"]


def test_repeating_the_same_attachment_adds_no_extra_evidence():
    photo = _image_data_url(640, 480)
    out = analyze_photos([photo, photo, photo])
    assert out["photo_evidence_score"] == 12
    assert sum(c["is_duplicate"] for c in out["photo_checks"]) == 2
    assert out["photo_confidence"] == 0.33


def test_malformed_attachments_count_in_quality_denominator():
    out = analyze_photos([_image_data_url(640, 480), "invalid"])
    assert out["photo_confidence"] == 0.5


def test_missing_decoder_must_not_award_arbitrary_bytes(monkeypatch):
    from app.services import photo
    monkeypatch.setattr(photo, "Image", None)
    assert analyze_photos([_image_data_url(640, 480)])["photo_evidence_score"] == 0


def test_analyze_rejects_tiny_image_as_invalid_evidence():
    # 32×32 is below the 160px floor — likely a UI icon, not real evidence.
    photo = _image_data_url(32, 32)
    out = analyze_photos([photo])
    assert out["photo_evidence_score"] == 0
    assert "No usable photo" in out["photo_findings"]


def test_analyze_rejects_garbage_data_url():
    out = analyze_photos(["data:image/jpeg;base64,not-real-base64-content"])
    assert out["photo_evidence_score"] == 0


def test_analyze_skips_non_image_data_url():
    # Doesn't start with data:image/ — should be filtered before decode
    out = analyze_photos(["http://example.com/img.png"])
    assert out["photo_evidence_score"] == 0
    assert out["photo_findings"] == "No usable photo evidence (images too small or corrupt)."


def test_analyze_mixed_valid_and_invalid():
    valid = _image_data_url(400, 400)
    invalid = _image_data_url(50, 50)  # too small
    out = analyze_photos([valid, invalid])
    assert out["photo_evidence_score"] == 12
    # 1 valid out of 2 = 0.5 confidence
    assert out["photo_confidence"] == 0.5
