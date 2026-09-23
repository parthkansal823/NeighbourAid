"""Practice alerts.

The gap this fills is not technical. In a real emergency nobody is
installing an app, granting notification permission and working out what
the accept button does — they are doing the emergency. All of that has to
have happened already, on an ordinary Tuesday, or the app is a thing people
download after the flood.

So a society or RWA can run a drill: a real alert through the real
pipeline — triage, dispatch, push, accept, resolve — that everyone can see
is not real. Volunteers learn the flow and, more importantly, discover
that their notifications were off before it mattered.

What makes it safe
------------------
A drill must never contaminate anything a decision is made on. It is
excluded from every public count, from the leaderboard, and from trust
scores — a volunteer cannot farm reputation by accepting practice alerts,
and a neighbourhood's "3 active alerts" never includes one that is pretend.

`NOT_A_DRILL` is that exclusion, written once. Ten different count sites
each carrying their own `{"is_drill": False}` is a rule that holds until
someone adds an eleventh, and nothing fails when they forget — the number
is simply wrong, in the direction that makes the app look busier than it
is. The test in tests/test_drill.py asserts every counting site uses it.

`$ne: True` rather than `False`: every alert written before this field
existed has no `is_drill` key at all, and `{"is_drill": False}` does not
match a missing field.
"""

from __future__ import annotations

from typing import Any

__all__ = ["DRILL_TTL_MINUTES", "NOT_A_DRILL", "is_drill", "mark"]

# The filter fragment that excludes practice alerts. Merge into any query
# whose result a human reads as "how much is really happening".
NOT_A_DRILL: dict[str, Any] = {"is_drill": {"$ne": True}}

# A drill cleans itself up. Nobody remembers to resolve a practice alert,
# and one left open for a day is indistinguishable from the clutter drills
# are meant to prevent.
DRILL_TTL_MINUTES = 60


def is_drill(alert: dict[str, Any]) -> bool:
    return bool(alert.get("is_drill"))


def mark(doc: dict[str, Any], drill: bool) -> dict[str, Any]:
    """Stamp a new alert document. Always writes the key, even when False,
    so a later query can tell "not a drill" from "written before drills
    existed" if it ever needs to."""
    doc["is_drill"] = bool(drill)
    return doc
