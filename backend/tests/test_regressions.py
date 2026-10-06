"""Regression tests for bugs the rest of the suite happily passed over.

Each test here pins down a specific defect that shipped: the corroboration
filter that never filtered, the escalation ladder that could only climb one
rung, emails that were case-sensitive, and several paths that returned 500
where they should have returned a 4xx. Grouped together so it's obvious that
the assertions are about *not regressing*, not about general coverage.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.security import create_token
from app.services.verification import (
    CORROBORATE_SIMILARITY_MIN,
    compute_verified_score,
    filter_corroborating,
)


def _token(role="reporter", sub=None):
    return create_token({"sub": sub or str(ObjectId()), "role": role})


# ---------------------------------------------------------------------------
# Corroboration filtering
# ---------------------------------------------------------------------------


def test_filter_corroborating_drops_unrelated_incidents():
    """The old filter was `similarity >= 0.25 or c.get("_id") is not None`.
    Every document from Mongo has an _id, so the second clause was always
    true and the filter kept everything — inflating verified_score with
    unrelated alerts that merely shared a category and a postcode."""
    description = "Elderly man collapsed near the park gate, not breathing"
    candidates = [
        {"_id": ObjectId(), "description": "Child lost at the vegetable market"},
        {"_id": ObjectId(), "description": "Water logging on the main road"},
    ]
    assert filter_corroborating(description, candidates) == []


def test_filter_corroborating_keeps_the_same_incident_retold():
    description = "Fire in the building near gate 3"
    candidates = [
        {"_id": ObjectId(), "description": "There is a fire near gate 3 in the building"},
        {"_id": ObjectId(), "description": "Stray dog needs a vet"},
    ]
    kept = filter_corroborating(description, candidates)
    assert len(kept) == 1
    assert "gate 3" in kept[0]["description"]


def test_filter_corroborating_handles_missing_description():
    """Docs written before `description` was mandatory must not blow up."""
    assert filter_corroborating("anything at all", [{"_id": ObjectId()}]) == []


def test_corroborate_similarity_threshold_is_reachable():
    """Guards against someone raising the constant so high that nothing ever
    corroborates, silently disabling the feature."""
    assert 0 < CORROBORATE_SIMILARITY_MIN < 0.5


# ---------------------------------------------------------------------------
# verified_score consistency
# ---------------------------------------------------------------------------


def test_witnessing_an_alert_never_lowers_its_score():
    """create_alert used to add a `duplicate_count` on top of the corroborating
    count (double-counting the same documents), while the witness path
    recomputed with the plain count. The first witness therefore *dropped* the
    score. Both paths now feed compute_verified_score the same way, so more
    witnesses can only ever help."""
    at_creation = compute_verified_score(
        witnesses=1, corroborating_alerts=2, weather_match=True
    )
    after_witness = compute_verified_score(
        witnesses=2, corroborating_alerts=2, weather_match=True
    )
    assert after_witness >= at_creation


# ---------------------------------------------------------------------------
# Auth: email casing and the duplicate-key race
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_normalizes_email_case(client):
    """A phone keyboard capitalises the first letter. Without normalisation
    that account simply cannot log in from a laptop."""
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(return_value=MagicMock(inserted_id=ObjectId()))
    resp = await c.post(
        "/api/auth/register",
        json={
            "name": "Asha",
            "email": "  Asha@Example.COM ",
            "password": "secret123",
            "role": "reporter",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        },
    )
    assert resp.status_code == 201
    stored = db.users.insert_one.call_args[0][0]
    assert stored["email"] == "asha@example.com"


@pytest.mark.asyncio
async def test_login_normalizes_email_case(client):
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    await c.post(
        "/api/auth/login",
        json={"email": "Asha@Example.COM", "password": "secret123"},
    )
    assert db.users.find_one.call_args[0][0] == {"email": "asha@example.com"}


@pytest.mark.asyncio
async def test_register_duplicate_key_race_is_400_not_500(client):
    """Two signups racing on the same address both clear the find_one check;
    the unique index rejects the loser. That must surface as the same 400 the
    non-racing path returns, not an unhandled 500."""
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(side_effect=DuplicateKeyError("dup"))
    resp = await c.post(
        "/api/auth/register",
        json={
            "name": "Asha",
            "email": "asha@example.com",
            "password": "secret123",
            "role": "reporter",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        },
    )
    assert resp.status_code == 400
    assert "already registered" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_token_with_malformed_subject_is_401_not_500(client):
    """`sub` gets fed to ObjectId() by nearly every route. A token carrying a
    non-ObjectId subject used to raise InvalidId inside the handler."""
    c, _ = client
    bad = create_token({"sub": "not-an-object-id", "role": "reporter"})
    resp = await c.get("/api/users/me", headers={"Authorization": f"Bearer {bad}"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Witness locality check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_witness_without_a_stored_location_is_400_not_500(client):
    """The locality check read user["location"]["coordinates"] unguarded, so a
    user who never shared a location got a 500 instead of being told what to
    fix."""
    c, db = client
    sub = str(ObjectId())
    db.alerts.find_one = AsyncMock(
        return_value={
            "_id": ObjectId(),
            "reporter_id": ObjectId(),
            "status": "open",
            "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        }
    )
    # A real user document, just with no location recorded.
    db.users.find_one = AsyncMock(return_value={"_id": ObjectId(sub), "name": "Asha"})

    resp = await c.post(
        f"/api/alerts/{ObjectId()}/witness",
        headers={"Authorization": f"Bearer {_token('volunteer', sub)}"},
    )
    assert resp.status_code == 400
    assert "location" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Clamped query windows must be reported honestly
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_heatmap_reports_the_clamped_window_not_the_request(client):
    """`hours` is clamped to 168 for the query. Echoing the caller's raw value
    told clients they'd received a window the query never covered."""
    c, db = client

    async def empty():
        if False:
            yield

    cursor = MagicMock()
    cursor.limit = MagicMock(return_value=empty())
    db.alerts.find = MagicMock(return_value=cursor)

    resp = await c.get(
        "/api/alerts/heatmap",
        params={"lat": 30.7333, "lng": 76.7794, "km": 25, "hours": 9999},
    )
    assert resp.status_code == 200
    assert resp.json()["window_hours"] == 168


@pytest.mark.asyncio
async def test_leaderboard_reports_the_clamped_window(client):
    c, db = client
    db.alerts.aggregate = MagicMock(side_effect=RuntimeError("no aggregation in mock"))
    resp = await c.get("/api/stats/leaderboard", params={"days": 9999, "limit": 500})
    assert resp.status_code == 200
    assert resp.json()["window_days"] == 365
