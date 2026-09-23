"""When a volunteer is willing to be woken.

There was no concept of this at all. Every volunteer in range was paged for
every alert, at every hour — a LOW report about a stray dog at three in the
morning reached the same person who had to be at work at six.

That is not a small annoyance. It is the mechanism by which someone turns
notifications off, and once they are off the CRITICAL alert does not arrive
either. The setting exists to protect the notifications that matter from
the ones that do not.

Timezones
---------
"Ten at night" is meaningless without knowing whose ten. The window is
stored as local hours plus an IANA zone the browser reports
(`Intl.DateTimeFormat().resolvedOptions().timeZone`), and compared here with
`zoneinfo` from the standard library — no dependency, and correct across DST
in a way that storing a UTC offset is not.

A volunteer who never touches the setting is available at all hours, which
is the behaviour this app had before and the right default for a crisis
tool: opting out should be deliberate.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__all__ = ["DEFAULT_TIMEZONE", "is_available", "normalise"]

DEFAULT_TIMEZONE = "Asia/Kolkata"

# Urgency that ignores the window when the volunteer has allowed it to.
# Only CRITICAL: HIGH is a fire or a flood and can wait for morning if
# someone has said their nights are their own, but "not breathing" cannot.
ALWAYS_URGENCY = "CRITICAL"


def normalise(raw: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Fill in a complete availability record from whatever is stored.

    Anything missing means "available" — a user who has never opened the
    setting, and every document written before this field existed, both
    arrive here as None and must behave exactly as the app did before.
    """
    raw = raw or {}
    try:
        from_hour = int(raw.get("from_hour", 0))
        to_hour = int(raw.get("to_hour", 24))
    except (TypeError, ValueError):
        from_hour, to_hour = 0, 24

    return {
        "timezone": raw.get("timezone") or DEFAULT_TIMEZONE,
        "from_hour": max(0, min(23, from_hour)),
        "to_hour": max(0, min(24, to_hour)),
        "critical_always": bool(raw.get("critical_always", True)),
        "busy_until": raw.get("busy_until"),
    }


def _within_window(hour: int, start: int, end: int) -> bool:
    """Is `hour` inside [start, end)?

    Handles a window that crosses midnight, which is the common case — a
    volunteer awake 22:00–06:00 is not asking to be available for minus
    sixteen hours.
    """
    if start == end or (start == 0 and end == 24):
        return True  # always on
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end  # wraps midnight


def is_available(
    raw: Optional[dict[str, Any]],
    urgency: str = "MEDIUM",
    now: Optional[datetime] = None,
) -> bool:
    """Should this volunteer be paged for an alert of this urgency, now?

    `now` is injectable so the tests do not depend on when they run — a
    time-dependent test that passes in the morning and fails at night is
    worse than no test.
    """
    av = normalise(raw)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        # Mongo hands back naive datetimes even for values stored as UTC.
        # Treating one as local time would shift the whole window by hours.
        now = now.replace(tzinfo=timezone.utc)

    critical_override = urgency == ALWAYS_URGENCY and av["critical_always"]

    busy_until = av["busy_until"]
    if isinstance(busy_until, datetime):
        if busy_until.tzinfo is None:
            busy_until = busy_until.replace(tzinfo=timezone.utc)
        if now < busy_until:
            return critical_override

    try:
        local = now.astimezone(ZoneInfo(av["timezone"]))
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        # A bad zone must not make someone unreachable. Falling back to
        # "available" is the safe direction to fail in a crisis app.
        return True

    if _within_window(local.hour, av["from_hour"], av["to_hour"]):
        return True
    return critical_override
