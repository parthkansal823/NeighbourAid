"""Address formatting for the volunteer-facing card.

The address is what a volunteer navigates by, so the failure that matters is
a technically-correct label too coarse to act on: "Kharar, Sahibzada Ajit
Singh Nagar" is a town and a district. These tests pin the parts that make it
navigable — landmark, street, postcode — and the deduplication that keeps it
readable, since Nominatim repeats the same string across several fields.
"""

from app.services.geocode import _compact_address


def test_leads_with_the_landmark():
    """In Indian cities directions are given relative to a landmark, so a
    mapped feature name beats the street it sits on. This field was being
    discarded entirely."""
    out = _compact_address({
        "name": "Civil Hospital",
        "address": {"road": "Mall Road", "suburb": "Sector 22",
                    "city": "Chandigarh", "postcode": "160022"},
    })
    assert out.startswith("Civil Hospital")
    assert "Mall Road" in out and "160022" in out


def test_house_number_is_joined_to_the_road():
    out = _compact_address({
        "address": {"house_number": "42", "road": "Mall Road", "city": "Chandigarh"},
    })
    assert "42 Mall Road" in out


def test_postcode_survives_when_nothing_finer_exists():
    """Rural and unmapped points often have only town + district. The
    postcode is then the only field that narrows the area at all."""
    out = _compact_address({
        "address": {"town": "Kharar", "state_district": "Sahibzada Ajit Singh Nagar",
                    "postcode": "140300"},
    })
    assert out == "Kharar, Sahibzada Ajit Singh Nagar, 140300"


def test_repeated_names_are_collapsed():
    """A village named after its tehsil yields the same string three times."""
    out = _compact_address({
        "address": {"village": "Kharar", "county": "Kharar Tahsil", "state": "Punjab"},
    })
    assert out.count("Kharar") == 1


def test_short_fragments_do_not_swallow_real_components():
    """Regression guard: bare substring dedupe ate real parts.

    "ar" is contained in "Kharar", and a house number "1" is contained in any
    part with a 1 in it — so an unguarded containment check silently dropped
    the town from the address.
    """
    out = _compact_address({
        "name": "Ar",
        "address": {"town": "Kharar", "postcode": "140300"},
    })
    assert "Kharar" in out
    assert "140300" in out


def test_falls_back_to_display_name_when_nothing_is_structured():
    out = _compact_address({"display_name": "Somewhere, India"})
    assert out == "Somewhere, India"


def test_returns_none_for_an_empty_response():
    assert _compact_address({}) is None
