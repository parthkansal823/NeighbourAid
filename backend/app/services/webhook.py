"""Fire-and-forget outbound webhook for alert events.

Used to integrate with external automation (n8n, Zapier, Make, custom cron
runners) without hard-coding a specific provider. When `ALERT_WEBHOOK_URL`
is set the backend POSTs a compact JSON payload on every new alert.

This runs in a detached task so request latency is never affected by a
slow/broken webhook. Failures are logged at WARNING level and dropped.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from ..core.config import settings

log = logging.getLogger(__name__)

# asyncio only holds a *weak* reference to a running task. A bare
# `create_task(...)` whose result nobody keeps can therefore be collected
# mid-flight, so the webhook silently never fires — the classic
# fire-and-forget footgun. Holding a strong reference until the task
# completes is the documented fix.
_pending: set[asyncio.Task] = set()


def _webhook_payload(alert: dict[str, Any]) -> dict[str, Any]:
    """Trim the alert doc to what an automation actually needs. Keeps the
    payload small (no base64 photos, no internal IDs) so consumers don't
    have to learn our full schema."""
    return {
        "event": "alert.created",
        "alert": {
            "id": alert.get("id"),
            "category": alert.get("category"),
            "urgency": alert.get("urgency"),
            "description": alert.get("description"),
            "status": alert.get("status"),
            "address": alert.get("address"),
            "location": alert.get("location"),
            "photo_count": alert.get("photo_count") or 0,
            "verified_score": alert.get("verified_score"),
            "created_at": str(alert.get("created_at") or ""),
        },
    }


async def _post(payload: dict[str, Any]) -> None:
    url = settings.ALERT_WEBHOOK_URL
    if not url:
        return
    try:
        async with httpx.AsyncClient(
            timeout=settings.ALERT_WEBHOOK_TIMEOUT_SECONDS
        ) as client:
            await client.post(url, json=payload)
    except Exception as exc:  # noqa: BLE001 — log and drop
        log.warning("alert webhook failed: %s", exc)


def fire_alert_created(alert: dict[str, Any]) -> None:
    """Schedule a detached webhook POST. Safe to call even if the URL is
    unset — short-circuits without scheduling a task."""
    if not settings.ALERT_WEBHOOK_URL:
        return
    payload = _webhook_payload(alert)
    try:
        task = asyncio.get_running_loop().create_task(_post(payload))
    except RuntimeError:
        # No running loop — caller is likely in a sync context; just skip
        log.debug("no running loop for webhook dispatch")
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)
