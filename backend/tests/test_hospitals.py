"""Nearby-hospital lookup.

A medical alert already offers the numbers to call — 108, 102, 112. It did
not answer the other question: where to drive. This covers the parsing and
ranking that turns an Overpass response into that answer.

No network. Overpass is a free community service and a test suite must not
hammer it, and a test that depends on a live third party fails for reasons
that have nothing to do with the code. The one place a live call is
justified is `tests/smoke_live.py`, which is run deliberately.
"""

import pytest

from app.services.hospitals import (
    SEARCH_RADIUS_M,
    _is_veterinary,
    _parse,
    nearby_hospitals,
)

# Chandigarh, matching the rest of the fixtures.
LAT, LNG = 30.7333, 76.7794


def _element(name, *, amenity="hospital", lat=None, lng=None, way=False, **tags):
    tag_map = {"name": name, "amenity": amenity, **tags}
    pos = {"lat": lat if lat is not None else LAT, "lon": lng if lng is not None else LNG}
    if way:
        # A hospital mapped as a building outline: the position arrives under
        # `center`, which is why the query asks for `out center`. Without it
        # every way-mapped hospital would be silently dropped.
        return {"type": "way", "id": 1, "center": pos, "tags": tag_map}
    return {"type": "node", "id": 1, **pos, "tags": tag_map}


class TestVeterinaryFilter:
    """A live Chandigarh query returned "Government Pet Hospital" as the
    third-nearest result. Sending someone having a heart attack to a
    veterinary clinic is not a ranking nitpick."""

    @pytest.mark.parametrize(
        "tags,name",
        [
            ({"amenity": "hospital"}, "Government Pet Hospital"),
            ({"amenity": "veterinary"}, "City Clinic"),
            ({"amenity": "hospital"}, "Veterinary Polyclinic"),
            ({"healthcare": "veterinary"}, "Some Hospital"),
            ({"amenity": "clinic"}, "Pashu Chikitsalaya"),
        ],
    )
    def test_rejects_animal_places(self, tags, name):
        assert _is_veterinary(tags, name)

    @pytest.mark.parametrize(
        "name",
        [
            "Civil Hospital-Sector 22",
            "Hope Clinic And Maternity Centre",
            "PGIMER",
            "Oxford Heart and Multispeciality Hospital",
        ],
    )
    def test_keeps_real_hospitals(self, name):
        assert not _is_veterinary({"amenity": "hospital"}, name)

    def test_filtered_out_of_the_parsed_list(self):
        rows = _parse(
            {
                "elements": [
                    _element("Government Pet Hospital"),
                    _element("Civil Hospital-Sector 22"),
                ]
            },
            LAT,
            LNG,
        )
        assert [r["name"] for r in rows] == ["Civil Hospital-Sector 22"]


class TestRanking:
    def test_emergency_departments_outrank_a_closer_clinic(self):
        # The actual decision being made when this list is read: a walk-in
        # clinic 200 m away cannot admit someone a hospital 2 km away can.
        rows = _parse(
            {
                "elements": [
                    _element("Near Clinic", amenity="clinic", lat=LAT + 0.002),
                    _element(
                        "Far Hospital",
                        amenity="hospital",
                        lat=LAT + 0.02,
                        emergency="yes",
                    ),
                ]
            },
            LAT,
            LNG,
        )
        assert [r["name"] for r in rows] == ["Far Hospital", "Near Clinic"]

    def test_within_a_tier_the_nearest_wins(self):
        rows = _parse(
            {
                "elements": [
                    _element("Further", lat=LAT + 0.02),
                    _element("Closer", lat=LAT + 0.002),
                ]
            },
            LAT,
            LNG,
        )
        assert [r["name"] for r in rows] == ["Closer", "Further"]

    def test_caps_the_list(self):
        many = {"elements": [_element(f"H{i}", lat=LAT + i / 1000) for i in range(30)]}
        assert len(_parse(many, LAT, LNG)) == 10


class TestParsing:
    def test_reads_a_way_mapped_hospital(self):
        rows = _parse({"elements": [_element("Outlined Hospital", way=True)]}, LAT, LNG)
        assert len(rows) == 1
        assert rows[0]["lat"] == LAT

    def test_drops_unnamed_points(self):
        # Unnavigable and unreadable aloud, so noise on a card being scanned
        # under pressure.
        rows = _parse(
            {"elements": [{"type": "node", "lat": LAT, "lon": LNG, "tags": {"amenity": "hospital"}}]},
            LAT,
            LNG,
        )
        assert rows == []

    def test_drops_points_with_no_position(self):
        rows = _parse(
            {"elements": [{"type": "way", "id": 2, "tags": {"name": "X", "amenity": "hospital"}}]},
            LAT,
            LNG,
        )
        assert rows == []

    def test_surfaces_a_phone_from_either_tag(self):
        rows = _parse(
            {
                "elements": [
                    _element("A", phone="0172-111"),
                    _element("B", lat=LAT + 0.01, **{"contact:phone": "0172-222"}),
                ]
            },
            LAT,
            LNG,
        )
        phones = {r["name"]: r["phone"] for r in rows}
        assert phones == {"A": "0172-111", "B": "0172-222"}

    def test_distance_is_in_kilometres(self):
        # ~0.011 degrees of latitude is roughly 1.2 km.
        rows = _parse({"elements": [_element("A", lat=LAT + 0.011)]}, LAT, LNG)
        assert 1.0 < rows[0]["distance_km"] < 1.5

    def test_an_empty_response_is_an_empty_list(self):
        assert _parse({}, LAT, LNG) == []
        assert _parse({"elements": []}, LAT, LNG) == []


class TestFailureIsSurvivable:
    async def test_returns_a_list_when_every_mirror_fails(self, monkeypatch):
        """This sits on top of 108, which already works. It must never be the
        thing that breaks the card."""
        import app.services.hospitals as mod

        monkeypatch.setattr(mod, "_ENDPOINTS", ("https://overpass.invalid/api",))
        mod._CACHE.clear()
        assert await nearby_hospitals(LAT, LNG, timeout=0.2) == []

    def test_search_radius_is_a_neighbourhood_not_a_city(self):
        # "Nearest" during a crisis is a question about a couple of km. A
        # 30 km list is a directory, not a decision.
        assert 1000 <= SEARCH_RADIUS_M <= 5000
