"""Alert-to-resource matching.

Both halves of this existed for a long time and never met: someone pins an
oxygen cylinder, someone else reports that a person cannot breathe, and the
app shows them on two different screens.

Two properties are worth defending. The mapping stays narrow — padding a
missing-person alert with a plausible-looking shelter turns a three-line
panel into a directory nobody reads in an emergency. And the lookup can
never take the alert down with it: this decorates a card, and a decoration
that raises is worse than one that is absent.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.alert import AlertCategory
from app.models.resource import ResourceKind
from app.services import matching


class TestTheMapping:
    def test_covers_every_alert_category(self):
        """A category with no entry silently returns nothing. Listing them
        all — including the deliberately empty ones — makes "no resource
        helps here" a decision someone made rather than one they forgot."""
        for category in AlertCategory:
            assert category.value in matching.CATEGORY_RESOURCE_KINDS, category.value

    def test_only_names_resource_kinds_that_exist(self):
        """A typo here fails no test and matches no documents — the panel
        just never appears."""
        valid = {k.value for k in ResourceKind}
        for category, kinds in matching.CATEGORY_RESOURCE_KINDS.items():
            unknown = set(kinds) - valid
            assert not unknown, f"{category}: unknown resource kinds {unknown}"

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("medical", "oxygen"), ("medical", "blood"), ("flood", "shelter"), ("water", "water")],
    )
    def test_the_obvious_pairs_are_wired(self, category, expected):
        assert expected in matching.kinds_for(category)

    @pytest.mark.parametrize("category", ["missing", "violence", "animal", "power"])
    def test_categories_no_resource_helps_are_empty(self, category):
        """Nothing in the resource list finds a missing person, stops
        violence, catches an animal or restores power."""
        assert matching.kinds_for(category) == ()

    def test_a_gas_leak_is_not_a_fire(self):
        """Water helps after a fire and does nothing for a gas leak. The
        temptation is to give similar categories similar lists."""
        assert "water" in matching.kinds_for("fire")
        assert "water" not in matching.kinds_for("gas")

    def test_an_unknown_category_returns_empty_rather_than_raising(self):
        assert matching.kinds_for("chupacabra") == ()


class TestLookup:
    COORDS = [76.7794, 30.7333]

    @staticmethod
    def _db(found):
        db = MagicMock()
        cursor = MagicMock()
        cursor.limit = MagicMock(return_value=cursor)
        cursor.to_list = AsyncMock(return_value=found)
        db.resources.find = MagicMock(return_value=cursor)
        return db

    @pytest.mark.asyncio
    async def test_an_unmapped_category_never_touches_the_database(self):
        db = self._db([])
        assert await matching.nearby_resources(db, "missing", self.COORDS) == []
        db.resources.find.assert_not_called()

    @pytest.mark.asyncio
    async def test_queries_only_the_matching_kinds(self):
        db = self._db([])
        await matching.nearby_resources(db, "medical", self.COORDS)
        query = db.resources.find.call_args.args[0]
        assert set(query["kind"]["$in"]) == set(matching.kinds_for("medical"))
        assert query["location"]["$nearSphere"]["$maxDistance"] == matching.MATCH_RADIUS_M

    @pytest.mark.asyncio
    async def test_serialises_what_the_panel_renders(self):
        from bson import ObjectId

        oid = ObjectId()
        db = self._db(
            [
                {
                    "_id": oid,
                    "name": "Sector 22 oxygen point",
                    "kind": "oxygen",
                    "contact": "98xxxxxx01",
                    "location": {"type": "Point", "coordinates": [76.78, 30.73]},
                }
            ]
        )
        out = await matching.nearby_resources(db, "medical", self.COORDS)
        assert out[0]["id"] == str(oid)
        assert out[0]["contact"] == "98xxxxxx01"
        assert out[0]["coordinates"] == [76.78, 30.73]

    @pytest.mark.asyncio
    async def test_a_database_error_returns_empty_rather_than_raising(self):
        """This decorates an alert card. A decoration that raises takes the
        alert down with it, which is a strictly worse outcome than a missing
        panel."""
        db = MagicMock()
        db.resources.find = MagicMock(side_effect=RuntimeError("mongo is down"))
        assert await matching.nearby_resources(db, "medical", self.COORDS) == []

    @pytest.mark.asyncio
    async def test_the_radius_is_tighter_than_dispatch(self):
        """A volunteer can be paged from twelve kilometres because they will
        drive. A shelter twelve kilometres from a flood is not a shelter
        anyone is walking to."""
        from app.services.dispatch import MAX_DISPATCH_RADIUS_KM

        assert matching.MATCH_RADIUS_M / 1000 < MAX_DISPATCH_RADIUS_KM
