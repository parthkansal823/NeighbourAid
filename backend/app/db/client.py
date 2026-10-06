"""MongoDB connection handling.

Uses PyMongo's native async driver (`AsyncMongoClient`, added in PyMongo 4.9)
rather than Motor. MongoDB deprecated Motor in May 2025 and it reaches
end-of-life in May 2026; the async API now lives in PyMongo itself. The call
surface is the same — `db.collection.find_one(...)` and friends — so the
routes needed no changes. The one real difference is that `close()` is a
coroutine here, where Motor's was synchronous.
"""

from __future__ import annotations

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConfigurationError

from ..core.config import settings

# Default DB name used when the connection string doesn't carry one.
# Atlas users routinely paste a URL of the form
# `mongodb+srv://.../?retryWrites=true&w=majority` (no `/dbname` segment),
# which makes `get_default_database()` raise. Falling back to this name
# matches what the local-dev URL uses (`mongodb://localhost:27017/neighbouraid`)
# and keeps deploys forgiving.
_DEFAULT_DB_NAME = "neighbouraid"

_client: AsyncMongoClient | None = None
_db: AsyncDatabase | None = None


async def connect():
    global _client, _db
    _client = AsyncMongoClient(settings.MONGO_URL)
    try:
        _db = _client.get_default_database()
    except ConfigurationError:
        # Atlas SRV strings often omit the database segment. Picking up
        # `neighbouraid` here keeps the user from having to learn the
        # exact connection-string syntax just to deploy.
        _db = _client[_DEFAULT_DB_NAME]
    await _db.alerts.create_index([("location", "2dsphere")])
    await _db.users.create_index("email", unique=True)

    # Compound indexes for the non-geo alert queries.
    #
    # The 2dsphere index above only serves `$nearSphere`. Every other alert
    # read filters on some combination of reporter_id, accepted_by, status
    # and created_at, none of which were indexed — so /api/stats,
    # /api/stats/leaderboard, /api/alerts/mine and /api/users/me/stats each
    # did a full collection scan. That is invisible on a demo database and
    # becomes the first thing to fall over as alerts accumulate.
    #
    # Field order matters: Mongo can use a prefix of a compound index, so
    # equality fields come first and the sort/range field last.
    #
    # (reporter_id, created_at desc) — /api/alerts/mine filters on
    # reporter_id and sorts by created_at descending, so this one index
    # serves both halves and the sort needs no in-memory pass.
    await _db.alerts.create_index([("reporter_id", 1), ("created_at", -1)])
    # (reporter_id, status) — the three count_documents calls in the
    # reporter branch of /api/users/me/stats.
    await _db.alerts.create_index([("reporter_id", 1), ("status", 1)])
    # (accepted_by, created_at desc) — the volunteer branch of that same
    # endpoint plus the leaderboard aggregation, which matches on
    # accepted_by and a created_at window.
    await _db.alerts.create_index([("accepted_by", 1), ("created_at", -1)])
    # (status, created_at desc) — the landing-page counters in /api/stats,
    # every one of which is a status filter over a 24-hour window.
    await _db.alerts.create_index([("status", 1), ("created_at", -1)])


async def disconnect():
    # Clear the globals too, so a second lifespan cycle (tests, reload) can't
    # hand out a handle to an already-closed client.
    global _client, _db
    if _client is not None:
        await _client.close()
    _client = None
    _db = None


def get_db() -> AsyncDatabase:
    return _db
