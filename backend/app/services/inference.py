"""One admitted worker per local model, including loading; no waiting queue."""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

log = logging.getLogger(__name__)
T = TypeVar("T")


class InferenceSlot:
    """A timeout/cancelled caller cannot release a still-running native model.

    Acquire before submitting, release ONLY in the actual worker's finally.
    A dedicated one-thread executor avoids piling model work behind unrelated
    default-executor tasks. Text and vision own separate slots.
    """

    def __init__(self):
        self._busy = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="local-ai")

    async def run(self, call: Callable[[], T], *, timeout: float, fallback: T) -> T:
        if not self._busy.acquire(blocking=False):
            return fallback

        def invoke():
            try:
                return call()
            except Exception:  # optional inference; exception text may contain input
                log.info("Local AI worker failed; retaining fallback")
                return fallback
            finally:
                self._busy.release()

        try:
            worker = self._executor.submit(invoke)
        except Exception:
            self._busy.release()
            log.info("Local AI worker unavailable; retaining fallback")
            return fallback

        # Shield prevents wait_for/caller cancellation from cancelling queued
        # executor work before invoke() can release the admission lock.
        future = asyncio.wrap_future(worker)
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
        except TimeoutError:
            log.info("Local AI wait timed out; worker retains admission until finished")
            return fallback
