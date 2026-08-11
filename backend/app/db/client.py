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
