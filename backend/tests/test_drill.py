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
