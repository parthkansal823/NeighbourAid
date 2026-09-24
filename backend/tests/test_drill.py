"""Practice alerts, and the one thing that must never leak.

A drill runs the real pipeline so volunteers learn the real flow. The whole
design rests on it never contaminating a number someone makes a decision
on — a neighbourhood's "3 active alerts" must never include a pretend one,
and a volunteer must not be able to farm trust by accepting practice runs.

The load-bearing test here is the last one. Ten counting sites each carrying
their own exclusion is a rule that holds until someone adds an eleventh, and
nothing fails when they forget: the count is simply wrong, in the direction
that makes the app look busier than it is. So the test reads the source and
asserts every count goes through the shared fragment.
"""

import ast
import inspect
import re

import pytest

from app.services.drill import NOT_A_DRILL, is_drill, mark


def _excludes_drills(node) -> bool:
    """Does this filter expression carry the drill exclusion?

    Two legitimate shapes:
      * a dict literal with `**NOT_A_DRILL` spread into it, or
      * a reference to a shared `*_filter` that was built with it (the test
        below proves those filters really do carry it).
    """
    if node is None:
        return False
    if isinstance(node, ast.Name):
        return node.id.endswith("_filter")
    if isinstance(node, ast.Dict):
        for key, value in zip(node.keys, node.values):
            # `**something` appears as a None key.
            if key is None:
                if isinstance(value, ast.Name) and (
                    value.id == "NOT_A_DRILL" or value.id.endswith("_filter")
                ):
                    return True
    return False


class TestTheFilterFragment:
    def test_matches_documents_written_before_drills_existed(self):
        """`{"is_drill": False}` does not match a document with no `is_drill`
        key at all — which is every alert in the database today. `$ne: True`
        does."""
        assert NOT_A_DRILL == {"is_drill": {"$ne": True}}

    def test_mark_always_writes_the_key(self):
        """Even for False, so a later query can tell "not a drill" from
        "written before drills existed" if it ever needs to."""
        assert mark({}, False)["is_drill"] is False
        assert mark({}, True)["is_drill"] is True

    @pytest.mark.parametrize(
        ("doc", "expected"),
        [({}, False), ({"is_drill": False}, False), ({"is_drill": True}, True)],
    )
    def test_is_drill_reads_a_missing_key_as_false(self, doc, expected):
        assert is_drill(doc) is expected


class TestCreation:
    def test_the_model_defaults_to_a_real_alert(self):
        from app.models.alert import AlertCreate

        alert = AlertCreate(
            category="medical",
            description="Person collapsed near the park gate",
            location={"type": "Point", "coordinates": [76.7794, 30.7333]},
        )
        assert alert.is_drill is False

    def test_the_anonymous_endpoint_cannot_mint_a_drill(self):
        """An unauthenticated endpoint that can create alerts excluded from
        the public counts is a way to make the numbers lie, for free. The
        anonymous path writes no drill flag at all, so every alert it
        creates is counted."""
        from app.routes import alerts

        src = inspect.getsource(alerts.create_anonymous_alert)
        assert "is_drill" not in src


class TestNoCountingSiteIsMissed:
    """The regression this exists for: an eleventh count added later, with
    no exclusion, that nothing fails on."""

    # Every module whose numbers a human reads as "how much is happening".
    MODULES = ["app.routes.stats", "app.routes.users"]

    @staticmethod
    def _source(name):
        import importlib

        return inspect.getsource(importlib.import_module(name))

    @pytest.mark.parametrize("module", MODULES)
    def test_every_count_documents_call_excludes_drills(self, module):
        """Parsed, not grepped.

        The first version of this test regexed the source for
        `count_documents(...)` and looked for NOT_A_DRILL in the match. With
        re.S the non-greedy span ran past the call it was meant to check and
        found the constant in a *later* call, so deleting an exclusion still
        passed. It was a test that could not fail. Walking the AST checks
        the argument of each call and nothing else.
        """
        tree = ast.parse(self._source(module))
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "count_documents"
        ]
        assert calls, f"no count_documents found in {module} - did it move?"

        for call in calls:
            arg = call.args[0] if call.args else None
            assert _excludes_drills(arg), (
                f"{module}: a count_documents call on line {call.lineno} does not "
                f"exclude drills - merge **NOT_A_DRILL into its filter"
            )

    @pytest.mark.parametrize("module", MODULES)
    def test_the_shared_filters_carry_the_exclusion(self, module):
        """The `_filter` escape hatch above is only legitimate because the
        filters themselves are built with it."""
        src = self._source(module)
        for line in src.splitlines():
            if re.match(r"\s*\w*_filter = \{", line):
                assert "NOT_A_DRILL" in line, f"{module}: {line.strip()}"

    def test_the_leaderboard_aggregation_excludes_drills(self):
        """Not a count_documents call, so the check above cannot see it —
        and the leaderboard is exactly where farmed reputation would show."""
        src = self._source("app.routes.stats")
        match = re.search(r'\{"\$match": \{"accepted_by".*?\}\},', src, re.S)
        assert match, "leaderboard $match stage not found - did it move?"
        assert "NOT_A_DRILL" in match.group(0)


class TestDrillsExpire:
    """A drill that outlives the drill is just a fake alert in the feed.

    `DRILL_TTL_MINUTES` was exported and applied nowhere for a while, which
    is exactly the failure that leaves one there: nothing raises, the
    constant simply has no effect and practice alerts never end.
    """

    @staticmethod
    def _run_sweep():
        """Call the sweeper with a stub db and hand back the filters it used."""
        import asyncio
        from app.routes.alerts import _auto_resolve_stale

        calls = []

        class _Alerts:
            async def update_many(self, flt, update):
                calls.append((flt, update))

        class _Db:
            alerts = _Alerts()

        asyncio.run(_auto_resolve_stale(_Db()))
        return calls

    def test_a_drill_is_swept_on_its_own_clock(self):
        from datetime import datetime, timedelta, timezone

        from app.services.drill import DRILL_TTL_MINUTES

        calls = self._run_sweep()
        drill_calls = [f for f, _ in calls if f.get("is_drill") is True]
        assert drill_calls, "no sweep targets drills at all"

        cutoff = drill_calls[0]["created_at"]["$lt"]
        window = datetime.now(timezone.utc) - cutoff
        # Allow a second of slack for the clock read inside the sweeper.
        assert abs(window - timedelta(minutes=DRILL_TTL_MINUTES)) < timedelta(seconds=5)

    def test_an_accepted_drill_expires_too(self):
        """A volunteer accepting a practice alert is the drill working, not
        a reason to leave it open. Filtering on status "open" alone would
        strand every drill that did its job."""
        calls = self._run_sweep()
        drill_flt = next(f for f, _ in calls if f.get("is_drill") is True)
        statuses = drill_flt["status"]["$in"]
        assert "accepted" in statuses and "open" in statuses

    def test_the_sweep_marks_it_resolved_and_auto(self):
        calls = self._run_sweep()
        _, update = next((f, u) for f, u in calls if f.get("is_drill") is True)
        assert update["$set"]["status"] == "resolved"
        assert update["$set"]["auto_resolved"] is True

    def test_drills_are_swept_before_the_24h_rule(self):
        """The 24h sweep carries no drill exclusion, and does not need one
        only because this one has already closed them. Reverse the order and
        an accepted drill would sit in the feed for a day."""
        calls = self._run_sweep()
        kinds = ["drill" if f.get("is_drill") is True else "stale" for f, _ in calls]
        assert kinds == ["drill", "stale"], kinds

    def test_the_stale_rule_still_only_touches_unaccepted_alerts(self):
        """Guard against the drill change widening the 24h rule by accident:
        a real alert someone accepted must never be auto-resolved out from
        under them."""
        calls = self._run_sweep()
        stale = next(f for f, _ in calls if f.get("is_drill") is None)
        assert stale["accepted_by"] is None
        assert stale["status"] == "open"

    def test_a_dead_database_does_not_break_the_read(self):
        """Cleanup is best-effort; /nearby must still answer."""
        import asyncio

        from app.routes.alerts import _auto_resolve_stale

        class _Alerts:
            async def update_many(self, flt, update):
                raise RuntimeError("mongo is down")

        class _Db:
            alerts = _Alerts()

        asyncio.run(_auto_resolve_stale(_Db()))  # must not raise
