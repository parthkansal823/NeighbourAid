import pytest
from unittest.mock import AsyncMock
from bson import ObjectId
from app.core.security import create_token
from app.services.verification import compute_verified_score
from app.services import weather as weather_svc
from app.services.ai import triage, detect_language, classify_urgency, generate_headline, similarity, is_duplicate


def _token(role="volunteer"):
    return create_token({"sub": str(ObjectId()), "role": role})


def test_verified_score_caps_at_100():
    assert compute_verified_score(99, 99, True) == 100


def test_verified_score_zero_when_no_signals():
    assert compute_verified_score(0, 0, False) == 0


def test_verified_score_each_source_capped():
    # witnesses alone capped at 40
    assert compute_verified_score(100, 0, False) == 40
    # corroboration alone capped at 40
    assert compute_verified_score(0, 100, False) == 40
    # weather adds exactly 20
    assert compute_verified_score(0, 0, True) == 20


def test_weather_supports_flood_on_heavy_rain():
    assert weather_svc.supports_category("flood", {"precipitation_mm": 8, "wind_kph": 0, "code": 0})
    assert not weather_svc.supports_category("flood", {"precipitation_mm": 0, "wind_kph": 0, "code": 0})


def test_weather_supports_fire_on_dry_wind():
    assert weather_svc.supports_category("fire", {"precipitation_mm": 0, "wind_kph": 30, "code": 0})
    assert not weather_svc.supports_category("fire", {"precipitation_mm": 2, "wind_kph": 30, "code": 0})


def test_weather_supports_returns_false_for_unknown_categories():
    assert not weather_svc.supports_category("medical", {"precipitation_mm": 100, "wind_kph": 100})
    assert not weather_svc.supports_category("flood", None)


# --- AI triage tests (use heuristic fallback via NA_DISABLE_AI_MODEL=1) ---


def test_triage_critical_detects_unconscious():
    t = triage("Man collapsed and is unconscious, not breathing")
    assert t.urgency == "CRITICAL"
    assert "unconscious" in t.triggers
    assert t.priority_score >= 80


def test_triage_detects_child_vulnerability():
    t = triage("A bachcha is trapped inside the flooded building")
    assert t.vulnerability == "child"


def test_triage_detects_elderly_vulnerability():
    t = triage("Elderly man alone and injured after the accident")
    assert t.vulnerability == "elderly"


def test_triage_time_sensitivity_immediate():
    t = triage("Need help immediately, right now")
    assert t.time_sensitivity == "immediate"


def test_triage_time_sensitivity_days():
    t = triage("Can someone come tomorrow to check the power line")
    assert t.time_sensitivity == "days"


def test_detect_language_devanagari():
    assert detect_language("मदद चाहिए जल्दी") == "hi"


def test_detect_language_hinglish():
    assert detect_language("aag lagi hai madad karo") == "hi-Latn"


def test_detect_language_english():
    assert detect_language("fire in the building help") == "en"


def test_backcompat_classify_urgency_signature():
    urgency, reason = classify_urgency("person is bleeding heavily")
    assert urgency == "CRITICAL"
    assert reason  # non-empty


# --- headline + similarity ---


def test_headline_prefers_first_sentence():
    assert generate_headline("Fire in the kitchen. Everyone is safe.") == "Fire in the kitchen."


def test_headline_truncates_long_text():
    long_text = "a very long description " * 20
    h = generate_headline(long_text, max_len=50)
    assert len(h) <= 51  # 50 + ellipsis
    assert h.endswith("…")


def test_headline_empty():
    assert generate_headline("") == ""


def test_similarity_identical_is_one():
    s = "fire near park gate"
    assert similarity(s, s) == 1.0


def test_similarity_disjoint_is_low():
    assert similarity("fire in kitchen", "cat chased mouse") < 0.2


def test_is_duplicate_detects_near_match():
    a = "fire in the building near gate 3"
    b = "there is a fire near gate 3 in the building"
    assert is_duplicate(a, b)


def test_is_duplicate_rejects_unrelated():
    assert not is_duplicate("fire near park", "child lost at market")


@pytest.mark.asyncio
async def test_witness_rejects_own_alert(client):
    c, db = client
    alert_id = ObjectId()
    token = _token("volunteer")
    # The JWT sub becomes the user id; make the alert owned by the same id
    import jwt as jj
    from app.core.config import settings
    sub = jj.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])["sub"]

    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": alert_id,
            "reporter_id": ObjectId(sub),
            "status": "open",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        }
    )
    resp = await c.post(
        f"/api/alerts/{alert_id}/witness",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_witness_rejects_far_user(client):
    c, db = client
    alert_id = ObjectId()
    token = _token("volunteer")
    import jwt as jj
    from app.core.config import settings
    sub = jj.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])["sub"]

    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": alert_id,
            "reporter_id": ObjectId(),  # someone else
            "status": "open",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        }
    )
    db.users.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(sub),
            # >2 km away
            "location": {"type": "Point", "coordinates": [77.2090, 28.6139]},
        }
    )
    resp = await c.post(
        f"/api/alerts/{alert_id}/witness",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_witness_missing_alert(client):
    c, db = client
    db.alerts.find_one = AsyncMock(return_value=None)
    resp = await c.post(
        f"/api/alerts/{ObjectId()}/witness",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404
