"""Unit tests for news authenticity scoring + topic classification.

We don't hit live RSS — `_score_item`, `_topic_for`, `_link_matches_source`
are pure functions over the parsed entry shape, so we exercise them
directly.
"""

from app.services.news import (
    _link_matches_source,
    _score_item,
    _topic_for,
    _MIN_AUTHENTICITY_SCORE,
)


def _feed():
    return {
        "source": "Test Outlet",
        "url": "https://example.com/rss",
        "domain": "example.com",
        "trust_base": 60,
    }


def test_topic_for_detects_fire_keyword():
    assert _topic_for("Massive fire breaks out", "buildings damaged") == "fire"


def test_topic_for_detects_flood_keyword():
    assert _topic_for("Flooding inundates city centre", "rescue underway") == "flood"


def test_topic_for_falls_back_to_other():
    assert _topic_for("Something completely unrelated", "no crisis terms") == "other"


def test_topic_priority_first_match_wins():
    # "fire" wins over "flood" because it's listed first in _TOPIC_MAP
    assert _topic_for("Fire and flood at once", "") == "fire"


def test_link_matches_exact_domain():
    assert _link_matches_source("https://example.com/article/1", "example.com")


def test_link_matches_subdomain():
    assert _link_matches_source("https://www.example.com/article/1", "example.com")


def test_link_does_not_match_unrelated_domain():
    assert not _link_matches_source("https://attacker.com/example.com", "example.com")


def test_link_handles_empty_inputs():
    assert not _link_matches_source("", "example.com")
    assert not _link_matches_source("https://example.com/x", "")


def test_score_high_for_canonical_link_with_metadata():
    score, label = _score_item(
        _feed(),
        title="Fire at warehouse — 3 firefighters injured",
        summary="Fire broke out late Tuesday at a warehouse complex...",
        link="https://example.com/news/fire-warehouse",
        published="Tue, 16 Apr 2024 10:00:00 +0000",
    )
    # 60 base + 20 domain match + 5 published + 5 distinct summary = 90
    assert score == 90
    assert label == "verified"


def test_score_penalised_for_clickbait_screamer():
    score, label = _score_item(
        _feed(),
        title="SHOCKING!!! YOU WON'T BELIEVE",
        summary="",
        link="https://example.com/x",
        published="",
    )
    # 60 + 20 (domain) - 15 (clickbait) = 65
    assert score == 65
    assert label == "reputable"


def test_score_drops_when_link_points_off_domain():
    score, _label = _score_item(
        _feed(),
        title="Fire at warehouse",
        summary="real story",
        link="https://content-mirror.farm/copy",
        published="Tue, 16 Apr 2024 10:00:00 +0000",
    )
    # No domain match: 60 + 0 + 5 + 5 = 70 — still passes the floor
    assert score == 70


def test_min_authenticity_score_constant_is_set():
    """Sanity: if someone tunes the floor down to e.g. 0, the news feed
    suddenly shows everything — flagged in review by this assertion."""
    assert 50 <= _MIN_AUTHENTICITY_SCORE <= 80
