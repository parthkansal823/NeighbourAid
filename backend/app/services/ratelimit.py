"""Tiny in-memory token-bucket rate limiter.

Used for endpoints that are open to the unauthenticated public — primarily
anonymous alert posting. We deliberately don't reach for Redis here:
NeighbourAid is a single-process FastAPI app on Render free tier; an
in-memory bucket is fine, and "exact correctness across replicas" isn't
worth the operational weight at this scale.

If/when you scale horizontally, swap the global `_buckets` dict for a
small wrapper around `redis.Redis.incr` with the same call surface.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Deque, Dict


class RateLimiter:
    def __init__(self, max_per_window: int, window_seconds: float):
        self.max = max_per_window
        self.window = window_seconds
        self._buckets: Dict[str, Deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        """Return True if the call is permitted, False if the bucket is full.
        Side effect: records this call against the bucket on success."""
        now = time.time()
        cutoff = now - self.window
        with self._lock:
            bucket = self._buckets.setdefault(key, deque())
            # Drop old hits — keeps the deque from growing unboundedly.
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.max:
                return False
            bucket.append(now)
            return True

    def reset(self) -> None:
        """Test helper — wipe all recorded hits."""
        with self._lock:
            self._buckets.clear()


# Tunable, project-wide limiters. Free tier sees no real abuse so these
# are deliberately generous; tighten if you ever start seeing scrapes.
anonymous_alert_limiter = RateLimiter(max_per_window=10, window_seconds=3600)

# Login attempts per IP. 20/min is forgiving for a forgetful user but
# stops a credential-stuffing bot from churning through a leaked
# password list.
login_limiter = RateLimiter(max_per_window=20, window_seconds=60)

# Account creation per IP. 5/hour stops casual spammers without
# blocking a household / classroom NAT.
register_limiter = RateLimiter(max_per_window=5, window_seconds=3600)

# Witness / flag / update — UGC writes. 60/min covers any legitimate
# activity in a real crisis (one user can't physically tap that fast)
# while still rate-limiting griefers.
write_limiter = RateLimiter(max_per_window=60, window_seconds=60)
