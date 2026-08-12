import os

# Force the keyword-heuristic fallback so unit tests are deterministic and
# never reach the Anthropic API — no key required to run the suite, and no
# network call in a unit test. Must be set before app imports.
# test_ai_triage.py covers the Claude path separately with a mocked client.
os.environ.setdefault("NA_DISABLE_AI_MODEL", "1")

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """Wipe the in-memory rate-limit buckets before every test.

    The limiters are module-level singletons keyed by client IP, and every
    test hits the app from the same IP. Without this, the 6th registration
    *anywhere in the suite* got a 429, so tests asserting on validation
    behaviour started failing purely because of how many tests ran before
    them — and adding an unrelated test could break a passing one.
    """
    from app.services import ratelimit as rl

    for limiter in (
        rl.anonymous_alert_limiter,
        rl.login_limiter,
        rl.register_limiter,
        rl.write_limiter,
    ):
        limiter.reset()
    yield


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id="507f1f77bcf86cd799439011")
    )
    db.users.create_index = AsyncMock()
    db.alerts.find_one = AsyncMock(return_value=None)
    db.alerts.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id="507f1f77bcf86cd799439012")
    )
    db.alerts.create_index = AsyncMock()
    # Readiness probe (/health/ready) issues a raw `ping` command.
    db.command = AsyncMock(return_value={"ok": 1})
    return db


@pytest.fixture
async def client(mock_db):
    from app.db import client as db_client
    from app.main import app

    original = db_client._db
    db_client._db = mock_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c, mock_db
    finally:
        db_client._db = original
