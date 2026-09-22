"""Folding duplicate reports of one incident into a single alert.

Corroboration was computed long before this and already fed verified_score,
but only in one direction: a new alert recorded which existing alerts it
matched, and none of those alerts learned about it. So five people reporting
one fire produced five separate cards. Volunteers split across them, and the
strongest signal the app has — how many independent people are saying this —
was spread thin instead of concentrated on one card.

`is_duplicate` existed, was tested, and was exported, with zero callers in
`app/`. The machinery was all there; the last step was not.

What happens now: the new report becomes a witness on the OLDEST matching
alert and is marked `duplicate_of` it. Nothing is deleted — the reporter still
sees their own alert under /mine and their share link still resolves. Only the
public lists collapse to one card per incident.
"""

from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.services.verification import pick_canonical


def _alert(minutes_ago: int, **over):
    doc = {
        "_id": ObjectId(),
        "created_at": datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        "description": "Fire near gate 3",
    }
    doc.update(over)
    return doc


class TestPickCanonical:
    def test_nothing_to_fold_into(self):
        assert pick_canonical([]) is None

    def test_picks_the_oldest(self):
        oldest = _alert(25)
        candidates = [_alert(5), oldest, _alert(12)]
        assert pick_canonical(candidates) is oldest

    def test_a_single_candidate_is_the_canonical(self):
        only = _alert(3)
        assert pick_canonical([only]) is only

    def test_choice_is_stable_as_more_reports_arrive(self):
        """The reason it is the oldest and not the newest.

        If the canonical changed each time someone else reported, a volunteer
        who accepted a card would watch it turn into a different card, and a
        link already shared would point at a report that is now a duplicate
        of something else.
        """
        first = _alert(30)
        chosen = [pick_canonical([first])]
        for newer in (20, 10, 1):
            chosen.append(pick_canonical([first, _alert(newer)]))
        assert all(c is first for c in chosen)

    def test_a_document_without_created_at_never_wins(self):
        # Written before the field existed. It sorts last rather than
        # crashing the comparison, and it would be a poor canonical anyway.
        real = _alert(9)
        legacy = {"_id": ObjectId(), "description": "Fire near gate 3"}
        assert pick_canonical([legacy, real]) is real
        assert pick_canonical([real, legacy]) is real

    def test_returns_the_document_not_a_copy(self):
        # The caller reads _id off the result, so identity has to survive.
        target = _alert(15)
        result = pick_canonical([_alert(2), target])
        assert result["_id"] == target["_id"]


class TestPublicListsCollapse:
    """The filter that makes the feed show one card per incident.

    Asserted against the route source rather than a live query: the unit
    suite mocks the database, so a wrong filter would pass a mock happily.
    `tests/smoke_live.py` is what exercises it against real MongoDB.
    """

    def _source(self):
        from pathlib import Path

        import app.routes.alerts as mod

        return Path(mod.__file__).read_text(encoding="utf-8")

    def test_nearby_and_heatmap_exclude_duplicates(self):
        src = self._source()
        # Both public list queries must carry the filter; /mine must not.
        assert src.count('"duplicate_of": None,') >= 2

    def test_mine_still_shows_the_reporters_own_duplicate(self):
        src = self._source()
        start = src.index("async def my_alerts(")
        end = src.index("async def", start + 10)
        assert "duplicate_of" not in src[start:end], (
            "a reporter must still see the alert they filed, even when it was "
            "folded into an earlier one"
        )

    def test_the_public_share_link_still_resolves_a_duplicate(self):
        src = self._source()
        start = src.index("async def get_alert(")
        end = src.index("async def", start + 10)
        assert "duplicate_of" not in src[start:end], (
            "a link already shared must keep working after the alert is "
            "folded into another"
        )


class TestSerialisation:
    def test_duplicate_of_is_stringified_like_the_other_object_ids(self):
        # Stored as an ObjectId; FastAPI's JSON encoder does not know the
        # type, so leaving it raw fails the whole response, not one field.
        from app.routes.alerts import _serialize

        parent = ObjectId()
        out = _serialize(
            {
                "_id": ObjectId(),
                "reporter_id": ObjectId(),
                "duplicate_of": parent,
                "description": "x",
                "category": "fire",
            }
        )
        assert out["duplicate_of"] == str(parent)
        assert isinstance(out["duplicate_of"], str)

    def test_an_original_alert_serialises_duplicate_of_as_none(self):
        from app.routes.alerts import _serialize

        out = _serialize(
            {
                "_id": ObjectId(),
                "reporter_id": ObjectId(),
                "description": "x",
                "category": "fire",
            }
        )
        assert out["duplicate_of"] is None
