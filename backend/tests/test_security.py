"""Tests for the security hardening + reliability layer.

Covers:
  - Security-headers middleware applies on every response
  - Strengthened password rules (length, letter+digit complexity)
  - Per-IP rate limit on login + register + write endpoints
  - python-jose deprecation warning is silenced via pytest config
  - DB connect fallback when the Atlas URL omits the database segment
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from pymongo.errors import ConfigurationError


# ──────────────────────────────────────────────────────────────────────
# Security-headers middleware
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_security_headers_present_on_health(client):
    c, _ = client
    resp = await c.get("/health")
    assert resp.status_code == 200
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert "max-age" in (resp.headers.get("strict-transport-security") or "")
    assert "geolocation" in (resp.headers.get("permissions-policy") or "")


@pytest.mark.asyncio
async def test_security_headers_present_on_404(client):
    """Headers must apply even to error responses, otherwise a clever
    attacker could probe a non-existent path to bypass them."""
    c, _ = client
    resp = await c.get("/api/this-does-not-exist")
    # FastAPI returns 404 with HTML/JSON; headers must still be set
    assert resp.headers.get("x-content-type-options") == "nosniff"


# ──────────────────────────────────────────────────────────────────────
# Password complexity
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_rejects_short_password(client):
    c, _ = client
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "short1",  # 6 chars — below the new 8-char floor
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_rejects_letters_only_password(client):
    c, _ = client
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "alllettersnodigits",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_rejects_digits_only_password(client):
    c, _ = client
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "12345678",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_accepts_strong_password(client):
    # Reset the rate limiter so a previous test's burst doesn't bleed in
    from app.services import ratelimit as rl

    rl.register_limiter.reset()
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId())
    )
    payload = {
        "name": "Test User",
        "email": "fresh@example.com",
        "password": "secret-pass-1",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 201
    rl.register_limiter.reset()


# ──────────────────────────────────────────────────────────────────────
# Rate limiters
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_rate_limit_after_burst(client):
    """20 logins in a minute is the cap — the 21st should be 429.
    Tests the limiter end-to-end through the FastAPI dependency."""
    from app.services import ratelimit as rl

    rl.login_limiter.reset()
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)  # always 401

    last_status = 200
    for _ in range(25):
        resp = await c.post(
            "/api/auth/login",
            json={"email": "x@example.com", "password": "secret-1"},
        )
        last_status = resp.status_code
        if last_status == 429:
            break
    assert last_status == 429
    rl.login_limiter.reset()


@pytest.mark.asyncio
async def test_register_rate_limit(client):
    """5 registrations per IP per hour. 6th should be 429."""
    from app.services import ratelimit as rl

    rl.register_limiter.reset()
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId())
    )
    payload_template = {
        "name": "Test User",
        "password": "secret-pass-1",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }

    last_status = 200
    for i in range(8):
        resp = await c.post(
            "/api/auth/register",
            json={**payload_template, "email": f"user{i}@example.com"},
        )
        last_status = resp.status_code
        if last_status == 429:
            break
    assert last_status == 429
    rl.register_limiter.reset()


@pytest.mark.asyncio
async def test_rate_limiter_dependency_returns_429_message():
    """Direct unit on the dep helper to confirm the exception payload."""
    from fastapi import HTTPException

    from app.core.limits import _make_dep
    from app.services.ratelimit import RateLimiter

    rl = RateLimiter(max_per_window=1, window_seconds=60)
    dep = _make_dep(rl, "unit")

    class _FakeReq:
        headers = {}
        client = type("Client", (), {"host": "1.2.3.4"})()

    await dep(_FakeReq())  # first call OK
    with pytest.raises(HTTPException) as exc:
        await dep(_FakeReq())
    assert exc.value.status_code == 429
    assert "unit" in exc.value.detail


# ──────────────────────────────────────────────────────────────────────
# DB connect fallback — the most common HF Spaces deploy crash
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_falls_back_to_default_db_name():
    """Atlas users routinely paste a connection string with no /dbname
    segment, which makes `get_default_database()` raise. Our connect()
    should fall back to the `neighbouraid` database silently."""
    from app.db import client as db_client

    # Build a fake PyMongo async client that:
    #   - raises ConfigurationError on get_default_database (the bug shape)
    #   - returns a mock DB when subscripted by name (the fallback path)
    fake_db = MagicMock()
    fake_db.alerts.create_index = AsyncMock()
    fake_db.users.create_index = AsyncMock()

    fake_client = MagicMock()
    fake_client.get_default_database = MagicMock(
        side_effect=ConfigurationError("no default db")
    )
    fake_client.__getitem__ = MagicMock(return_value=fake_db)
    # close() is a coroutine on AsyncMongoClient (it was sync on Motor).
    fake_client.close = AsyncMock()

    with patch.object(db_client, "AsyncMongoClient", return_value=fake_client):
        # Cache the original to restore afterwards so we don't pollute
        # other tests (the global fixture swaps _db too).
        original = db_client._db
        try:
            await db_client.connect()
            # The fallback should have indexed `neighbouraid`
            fake_client.__getitem__.assert_called_with("neighbouraid")
            assert db_client._db is fake_db
        finally:
            db_client._db = original


@pytest.mark.parametrize(
    "origin",
    [
        "https://neighbouraid.pages.dev",
        # Cloudflare serves static sites from Workers too, and that is a
        # different origin. Missing it blocked every API call from a real
        # deploy, surfacing only as a browser CORS error that pointed
        # nowhere near the allow-list.
        "https://neighbouraid-ap2308.kansalp-parth.workers.dev",
        "https://neighbouraid.vercel.app",
        "https://neighbouraid.netlify.app",
        "https://user-neighbouraid-api.hf.space",
    ],
)
@pytest.mark.asyncio
async def test_cors_allows_the_free_hosts_we_deploy_to(client, origin):
    c, _ = client
    resp = await c.options(
        "/api/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == origin


@pytest.mark.asyncio
async def test_cors_still_rejects_unknown_origins(client):
    """The allow-list has to keep meaning something after being widened."""
    c, _ = client
    resp = await c.options(
        "/api/auth/login",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.headers.get("access-control-allow-origin") is None
