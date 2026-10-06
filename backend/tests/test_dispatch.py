"""Minutes-to-arrive, and the radius that depends on how you travel.

The bug this replaced: `has_vehicle` was collected at registration, stored,
and sent to the client, and never once consulted when deciding who to page.
A volunteer with a car got the same 5 km as one walking — so a driver six
kilometres out, twenty-eight minutes away, was excluded, while a walker four
kilometres out, seventy-eight minutes away, was paged.

The tests that matter here are the two invariants:
  * walking coverage must not shrink (cutting it would look rigorous and
    would delete most of the volunteer pool), and
  * the database pre-filter must reach at least as far as the widest radius
    any volunteer can qualify for, or the per-volunteer check never sees the
    rows it would have kept.
"""

import pytest

from app.services import dispatch as d


class TestEta:
    def test_a_vehicle_beats_a_shorter_walk(self):
        """The case the whole module exists for."""
        assert d.eta_minutes(6.0, has_vehicle=True) < d.eta_minutes(4.2, has_vehicle=False)

    def test_the_five_km_walk_is_the_hour_and_a_half_it_really_is(self):
        # 5 km x 1.4 detour / 4.5 km/h = 93 min. If this ever reads like a
        # reasonable response time, the speed constant has drifted.
        assert 85 <= d.eta_minutes(5.0, has_vehicle=False) <= 100

    def test_never_promises_zero_minutes(self):
        """A volunteer shown "0 min" has been promised something impossible;
        the floor is the time to find your shoes."""
        assert d.eta_minutes(0.0, has_vehicle=True) >= 1
        assert d.eta_minutes(0.001, has_vehicle=False) >= 1

    def test_monotonic_in_distance(self):
        for veh in (False, True):
            etas = [d.eta_minutes(km, veh) for km in (1, 2, 5, 10, 20)]
            assert etas == sorted(etas)

    def test_includes_a_detour_penalty(self):
        """Straight-line distance is not road distance. Without the factor
        every ETA is optimistic, and a volunteer who is consistently late
        stops being trusted."""
        assert d.DETOUR_FACTOR > 1.0
        straight = 10.0 / d.SPEED_KMH[False] * 60
        assert d.eta_minutes(10.0, False) > straight

    def test_vehicle_speed_is_city_traffic_not_highway(self):
        """Quoting 40 km/h would produce ETAs nobody could meet."""
        assert 10 <= d.SPEED_KMH[True] <= 25


class TestRadius:
    def test_walking_coverage_is_unchanged(self):
        """Deliberate. Tightening this to whatever is reachable in fifteen
        minutes is defensible on paper and removes most of the pool — a
        neighbour forty minutes away on foot is still worth having."""
        assert d.radius_km_for(has_vehicle=False, skill_match=False) == 5.0

    def test_a_vehicle_covers_more_ground(self):
        assert d.radius_km_for(True, False) > d.radius_km_for(False, False)

    def test_a_skill_match_never_shrinks_a_radius(self):
        """A rare skill is worth waiting longer for, so it extends the
        radius. It must never replace it with something smaller."""
        for veh in (False, True):
            assert d.radius_km_for(veh, True) >= d.radius_km_for(veh, False)

    def test_the_query_bound_covers_every_case(self):
        """The regression this guards: the /nearby query was bounded at
        SKILL_RADIUS_KM (15 km) while a vehicle-owning volunteer with a
        matching skill qualified out to 25 km. Alerts in the band between
        were filtered out before the per-volunteer check ever ran, and
        nothing failed — they simply never appeared."""
        widest = max(
            d.radius_km_for(v, s) for v in (False, True) for s in (False, True)
        )
        assert d.MAX_DISPATCH_RADIUS_KM >= widest


class TestAgreementBetweenTheTwoDispatchPaths:
    """The WebSocket fan-out and the /nearby feed answer the same question.
    If they ever disagree, a volunteer sees an alert arrive live and then
    vanish when the feed refreshes."""

    @pytest.mark.parametrize("has_vehicle", [False, True])
    @pytest.mark.parametrize("skill_match", [False, True])
    def test_both_paths_call_the_same_function(self, has_vehicle, skill_match):
        import inspect

        from app.routes import alerts
        from app.services import websocket

        for module in (alerts, websocket):
            src = inspect.getsource(module)
            assert "radius_km_for(" in src, module.__name__
            # ...and neither reintroduces its own ladder.
            assert "SKILL_RADIUS_KM if skill_match" not in src, module.__name__
