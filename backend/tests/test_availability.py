"""Quiet hours, and the two ways they must not fail.

Failing closed is the dangerous direction here. A volunteer who is
unreachable because of a bad timezone string, or a document written before
this field existed, is a volunteer who silently stops being paged and never
finds out. So every uncertain case resolves to "available".

Failing open on CRITICAL is the other half: someone can decide their nights
are their own for a stray dog, but "not breathing" is why they signed up.

Every test injects `now`. A time-dependent test that passes in the morning
and fails at night is worse than no test.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services.availability import is_available, normalise

IST = timezone(timedelta(hours=5, minutes=30))


def at(hour: int, minute: int = 0) -> datetime:
    """A UTC instant that is `hour` o'clock in Kolkata."""
    return datetime(2026, 9, 23, hour, minute, tzinfo=IST).astimezone(timezone.utc)


NIGHT = {"timezone": "Asia/Kolkata", "from_hour": 9, "to_hour": 22}


class TestDefaults:
    def test_nothing_stored_means_always_available(self):
        """Every document written before this field existed arrives as None,
        and must behave exactly as the app did before it."""
        for h in (0, 3, 9, 14, 22, 23):
            assert is_available(None, "LOW", at(h)) is True

    def test_an_empty_record_is_also_always_available(self):
        assert is_available({}, "LOW", at(3)) is True

    def test_normalise_fills_in_a_complete_record(self):
        av = normalise(None)
        assert av["from_hour"] == 0 and av["to_hour"] == 24
        assert av["critical_always"] is True
        assert av["timezone"]


class TestWindow:
    @pytest.mark.parametrize("hour", [9, 14, 21])
    def test_inside_the_window_is_available(self, hour):
        assert is_available(NIGHT, "LOW", at(hour)) is True

    @pytest.mark.parametrize("hour", [3, 7, 23])
    def test_outside_the_window_is_not(self, hour):
        assert is_available(NIGHT, "LOW", at(hour)) is False

    def test_a_window_that_crosses_midnight(self):
        """A volunteer awake 22:00-06:00 is not asking to be available for
        minus sixteen hours."""
        night_shift = {"timezone": "Asia/Kolkata", "from_hour": 22, "to_hour": 6}
        assert is_available(night_shift, "LOW", at(23)) is True
        assert is_available(night_shift, "LOW", at(2)) is True
        assert is_available(night_shift, "LOW", at(14)) is False

    def test_hours_are_local_not_utc(self):
        """The whole reason the zone is stored. 03:00 IST is 21:30 UTC the
        previous day — treating that as UTC would put it inside a 9-to-22
        window and page someone at three in the morning."""
        three_am_ist = at(3)
        assert three_am_ist.astimezone(timezone.utc).hour == 21
        assert is_available(NIGHT, "LOW", three_am_ist) is False


class TestCriticalOverride:
    @pytest.mark.parametrize("hour", [3, 7, 23])
    def test_critical_still_gets_through_quiet_hours(self, hour):
        assert is_available(NIGHT, "CRITICAL", at(hour)) is True

    def test_only_critical_overrides(self):
        """HIGH is a fire and can wait for morning if someone has said their
        nights are their own. CRITICAL is a person not breathing."""
        for urgency in ("HIGH", "MEDIUM", "LOW"):
            assert is_available(NIGHT, urgency, at(3)) is False

    def test_the_override_can_be_switched_off(self):
        opted_out = {**NIGHT, "critical_always": False}
        assert is_available(opted_out, "CRITICAL", at(3)) is False


class TestBusyUntil:
    def test_busy_suppresses_everything_below_critical(self):
        busy = {**NIGHT, "busy_until": at(15)}
        assert is_available(busy, "LOW", at(14)) is False
        assert is_available(busy, "CRITICAL", at(14)) is True

    def test_it_expires_on_its_own(self):
        busy = {**NIGHT, "busy_until": at(15)}
        assert is_available(busy, "LOW", at(16)) is True

    def test_a_naive_datetime_is_read_as_utc(self):
        """Mongo hands back naive datetimes even for values stored as UTC.
        Treating one as local time would shift the whole window by hours."""
        naive = at(15).replace(tzinfo=None)
        busy = {**NIGHT, "busy_until": naive}
        assert is_available(busy, "LOW", at(14)) is False
        assert is_available(busy, "LOW", at(16)) is True


def test_the_timezone_database_is_actually_present():
    """The guard for the bug the fail-open design hides.

    `zoneinfo` reads the IANA database from the operating system. Linux and
    macOS ship one; Windows does not, so every lookup raises and
    `is_available` falls open — correct behaviour, and it means the whole
    feature silently does nothing while every other test still passes.

    `tzdata` is in requirements.txt for this reason. This asserts it is
    reachable, so dropping it fails here rather than in production at three
    in the morning.
    """
    from zoneinfo import ZoneInfo

    ZoneInfo("Asia/Kolkata")  # raises ZoneInfoNotFoundError if absent

    # And prove the fall-through is not what is passing the window tests.
    assert is_available(NIGHT, "LOW", at(3)) is False


class TestFailsOpen:
    """Every uncertain case must resolve to "available". A volunteer who is
    unreachable because of a bad config value never finds out."""

    def test_an_unknown_timezone_does_not_make_someone_unreachable(self):
        assert is_available({**NIGHT, "timezone": "Mars/Olympus"}, "LOW", at(3)) is True

    def test_garbage_hours_fall_back_to_always_on(self):
        assert is_available(
            {"timezone": "Asia/Kolkata", "from_hour": "x", "to_hour": None},
            "LOW",
            at(3),
        ) is True

    def test_a_naive_now_is_read_as_utc(self):
        assert is_available(NIGHT, "LOW", datetime(2026, 9, 23, 12, 0)) is True
