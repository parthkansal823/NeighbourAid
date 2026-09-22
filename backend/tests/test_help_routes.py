"""Route handlers for /api/help.

`test_help.py` covers the serializer, which is where the privacy decisions
live. This covers the handlers around it: what gets written, who is allowed
to call what, and the several ways an offer or an acceptance is supposed to
be refused.

Those refusals are the point. An open marketplace where anyone can accept on
someone else's behalf, or quote on a job that is already taken, is worse than
no marketplace — the failure is silent and lands on a stranger who turned up
expecting work.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from bson import ObjectId

from app.core.security import create_token


def _token(uid=None):
    return create_token({"sub": str(uid or ObjectId()), "role": "reporter"})


def _cursor(docs):
    """A cursor that supports the three shapes the routes use.

    `/near` does `.find(...).limit(n)` then `async for`; `/mine` does
    `.find(...).sort(...).limit(n)` then `.to_list(n)`. Both chaining calls
    return the cursor itself so either order works.
    """

    def iterate():
        async def gen():
            for d in docs:
                yield d

        return gen()

    cur = MagicMock()
    cur.limit = MagicMock(return_value=cur)
    cur.sort = MagicMock(return_value=cur)
    cur.to_list = AsyncMock(return_value=list(docs))
    cur.__aiter__ = lambda _self: iterate()
    return cur


@pytest.fixture(autouse=True)
def _reset_index_guard():
    """`_ensure_indexes` latches after its first run, so without this the
    first test to touch the route hides the index calls from every test
    after it — and whichever one asserted on them would pass or fail
    depending on suite order."""
    from app.routes import help as mod

    mod._indexes_ready = False
    yield
    mod._indexes_ready = False


@pytest.fixture
def helpdb(client):
    """The client fixture with help_requests wired up for the happy path."""
    c, db = client
    db.help_requests.create_index = AsyncMock()
    db.help_requests.find = MagicMock(return_value=_cursor([]))
    db.help_requests.find_one = AsyncMock(return_value=None)
    db.help_requests.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId())
    )
    db.help_requests.update_one = AsyncMock()
    db.help_requests.find_one_and_update = AsyncMock(return_value=None)
    db.help_requests.delete_one = AsyncMock(return_value=MagicMock(deleted_count=0))
    return c, db


BODY = {
    "kind": "electrician",
    "title": "Fuse box tripping every hour",
    "description": "Trips when the geyser runs",
    "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    "budget_min": 300,
    "budget_max": 800,
    "contact": "98xxxxxx01",
}


class TestCreate:
    async def test_persists_the_request(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        resp = await c.post(
            "/api/help/", json=BODY, headers={"Authorization": f"Bearer {_token(uid)}"}
        )
        assert resp.status_code == 201

        # NOTE: `_serialize` mutates the document it is handed — it replaces
        # the ObjectIds with strings in place — and `create_request` calls it
        # on the same dict it inserted. So by the time the mock's recorded
        # argument is inspected, requester_id is already a string. Harmless
        # here because the dict is not used again, but it is the kind of
        # shared-mutation that bites a later caller.
        written = db.help_requests.insert_one.await_args.args[0]
        assert str(written["requester_id"]) == str(uid)
        assert written["kind"] == "electrician"
        assert written["status"] == "open"
        assert written["offers"] == []
        assert written["accepted_worker_id"] is None

    async def test_sets_an_expiry_so_requests_do_not_pile_up(self, helpdb):
        # Nobody comes back to close their own request, so without the TTL a
        # plumber wanted three weeks ago sits in the feed as noise forever.
        c, db = helpdb
        await c.post(
            "/api/help/", json=BODY, headers={"Authorization": f"Bearer {_token()}"}
        )
        written = db.help_requests.insert_one.await_args.args[0]
        assert written["expires_at"] > written["created_at"]

    async def test_builds_the_indexes_its_queries_need(self, helpdb):
        c, db = helpdb
        await c.post(
            "/api/help/", json=BODY, headers={"Authorization": f"Bearer {_token()}"}
        )
        specs = [call.args[0] for call in db.help_requests.create_index.await_args_list]
        assert [("location", "2dsphere")] in specs
        assert "expires_at" in specs

    async def test_rejects_a_bad_budget_range(self, helpdb):
        c, db = helpdb
        resp = await c.post(
            "/api/help/",
            json={**BODY, "budget_min": 800, "budget_max": 100},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 422
        db.help_requests.insert_one.assert_not_awaited()

    async def test_rejects_an_unknown_trade(self, helpdb):
        # A closed set on both sides: free text would make the list
        # unfilterable, and finding the one person who does the thing is the
        # entire value of the page.
        c, db = helpdb
        resp = await c.post(
            "/api/help/",
            json={**BODY, "kind": "astrologer"},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 422
        db.help_requests.insert_one.assert_not_awaited()


class TestBrowse:
    async def test_queries_only_open_requests(self, helpdb):
        c, db = helpdb
        await c.get("/api/help/near", params={"lat": 30.7, "lng": 76.7})
        query = db.help_requests.find.call_args.args[0]
        assert query["status"] == "open"
        assert "$nearSphere" in query["location"]

    async def test_passes_lng_lat_in_geojson_order(self, helpdb):
        # Swapping them does not error — it quietly lists requests from
        # somewhere else entirely.
        c, db = helpdb
        await c.get("/api/help/near", params={"lat": 30.7333, "lng": 76.7794})
        query = db.help_requests.find.call_args.args[0]
        coords = query["location"]["$nearSphere"]["$geometry"]["coordinates"]
        assert coords == [76.7794, 30.7333]

    async def test_filters_by_trade_when_asked(self, helpdb):
        c, db = helpdb
        await c.get(
            "/api/help/near", params={"lat": 30.7, "lng": 76.7, "kind": "plumber"}
        )
        assert db.help_requests.find.call_args.args[0]["kind"] == "plumber"

    async def test_no_trade_filter_by_default(self, helpdb):
        c, db = helpdb
        await c.get("/api/help/near", params={"lat": 30.7, "lng": 76.7})
        assert "kind" not in db.help_requests.find.call_args.args[0]

    async def test_rejects_an_absurd_radius(self, helpdb):
        c, _ = helpdb
        resp = await c.get(
            "/api/help/near", params={"lat": 30.7, "lng": 76.7, "km": 5000}
        )
        assert resp.status_code == 422


class TestMine:
    async def test_returns_both_posted_and_offered(self, helpdb):
        # One screen, one round trip: a worker's "did they accept?" and a
        # requester's "who replied?" are the same question.
        c, db = helpdb
        resp = await c.get(
            "/api/help/mine", headers={"Authorization": f"Bearer {_token()}"}
        )
        assert resp.status_code == 200
        assert set(resp.json()) == {"posted", "offered"}

    async def test_offered_is_queried_by_membership_in_offers(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        await c.get(
            "/api/help/mine", headers={"Authorization": f"Bearer {_token(uid)}"}
        )
        queries = [call.args[0] for call in db.help_requests.find.call_args_list]
        assert {"requester_id": uid} in queries
        assert {"offers.worker_id": uid} in queries


class TestOffers:
    async def test_cannot_offer_on_your_own_request(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        db.help_requests.find_one = AsyncMock(
            return_value={"requester_id": uid, "status": "open"}
        )
        resp = await c.post(
            f"/api/help/{ObjectId()}/offers",
            json={"price": 500},
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 400

    async def test_cannot_offer_on_a_closed_request(self, helpdb):
        # Someone turning up to a job that is already taken is the failure
        # this exists to prevent.
        c, db = helpdb
        db.help_requests.find_one = AsyncMock(
            return_value={"requester_id": ObjectId(), "status": "accepted"}
        )
        resp = await c.post(
            f"/api/help/{ObjectId()}/offers",
            json={"price": 500},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 409

    async def test_missing_request_is_404(self, helpdb):
        c, _ = helpdb
        resp = await c.post(
            f"/api/help/{ObjectId()}/offers",
            json={"price": 500},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 404

    async def test_one_offer_per_worker_replaces_the_old_one(self, helpdb):
        c, db = helpdb
        worker = ObjectId()
        db.help_requests.find_one = AsyncMock(
            return_value={"requester_id": ObjectId(), "status": "open"}
        )
        db.users.find_one = AsyncMock(return_value={"name": "Ravi"})
        db.help_requests.find_one_and_update = AsyncMock(
            return_value={
                "_id": ObjectId(),
                "requester_id": ObjectId(),
                "offers": [{"worker_id": worker, "price": 450}],
                "accepted_worker_id": None,
            }
        )
        resp = await c.post(
            f"/api/help/{ObjectId()}/offers",
            json={"price": 450, "note": "revised"},
            headers={"Authorization": f"Bearer {_token(worker)}"},
        )
        assert resp.status_code == 201
        # The pull is scoped to this worker, so a re-quote replaces only
        # their own offer and leaves everyone else's alone.
        pull = db.help_requests.update_one.await_args.args[1]
        assert pull["$pull"]["offers"] == {"worker_id": worker}

    async def test_rejects_an_absurd_price(self, helpdb):
        c, db = helpdb
        db.help_requests.find_one = AsyncMock(
            return_value={"requester_id": ObjectId(), "status": "open"}
        )
        resp = await c.post(
            f"/api/help/{ObjectId()}/offers",
            json={"price": 99_999_999},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 422

    async def test_requires_an_account(self, helpdb):
        c, _ = helpdb
        resp = await c.post(f"/api/help/{ObjectId()}/offers", json={"price": 500})
        assert resp.status_code == 401


class TestAccept:
    async def test_the_filter_pins_requester_status_and_offer(self, helpdb):
        """All three conditions are in the query, not in Python.

        Checking them after the read would leave a window where two taps
        both see 'open' and both write — and the second would silently
        replace the first accepted worker.
        """
        c, db = helpdb
        uid, worker = ObjectId(), ObjectId()
        db.help_requests.find_one_and_update = AsyncMock(return_value=None)
        await c.patch(
            f"/api/help/{ObjectId()}/accept",
            params={"worker_id": str(worker)},
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        flt = db.help_requests.find_one_and_update.await_args.args[0]
        assert flt["requester_id"] == uid
        assert flt["status"] == "open"
        assert flt["offers.worker_id"] == worker

    async def test_one_404_for_every_refusal(self, helpdb):
        # Distinguishing "not yours" from "not open" from "no such offer"
        # would let anyone probe which requests exist and who has offered.
        c, db = helpdb
        db.help_requests.find_one_and_update = AsyncMock(return_value=None)
        resp = await c.patch(
            f"/api/help/{ObjectId()}/accept",
            params={"worker_id": str(ObjectId())},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 404

    async def test_rejects_a_malformed_id_as_400_not_500(self, helpdb):
        c, _ = helpdb
        resp = await c.patch(
            "/api/help/not-an-objectid/accept",
            params={"worker_id": str(ObjectId())},
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 400


class TestDoneAndDelete:
    async def test_done_is_scoped_to_the_requester(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        db.help_requests.find_one_and_update = AsyncMock(return_value=None)
        await c.patch(
            f"/api/help/{ObjectId()}/done",
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert db.help_requests.find_one_and_update.await_args.args[0][
            "requester_id"
        ] == uid

    async def test_done_on_someone_elses_request_is_404(self, helpdb):
        c, db = helpdb
        db.help_requests.find_one_and_update = AsyncMock(return_value=None)
        resp = await c.patch(
            f"/api/help/{ObjectId()}/done",
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 404

class TestWithdraw:
    """Withdrawing splits on whether anyone else has put work in.

    The split is the whole point. Deleting a row a plumber has quoted on
    makes his copy of it vanish with no explanation, which is the one
    outcome this endpoint exists to avoid.
    """

    @staticmethod
    def _row(requester_id, *, offers=(), status="open"):
        return {
            "_id": ObjectId(),
            "requester_id": requester_id,
            "status": status,
            "offers": [
                {"worker_id": ObjectId(), "price": 400, "note": ""} for _ in offers
            ],
            "accepted_worker_id": None,
            "contact": "98xxxxxx01",
        }

    async def test_no_offers_is_deleted_outright(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        db.help_requests.find_one = AsyncMock(return_value=self._row(uid))
        db.help_requests.delete_one = AsyncMock(
            return_value=MagicMock(deleted_count=1)
        )
        resp = await c.delete(
            f"/api/help/{ObjectId()}",
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "deleted"}
        # Scoped to the owner, so one requester cannot withdraw another's.
        assert db.help_requests.delete_one.await_args.args[0]["requester_id"] == uid
        db.help_requests.find_one_and_update.assert_not_awaited()

    async def test_offers_present_soft_cancels_instead(self, helpdb):
        c, db = helpdb
        uid = ObjectId()
        row = self._row(uid, offers=["one"])
        db.help_requests.find_one = AsyncMock(return_value=row)
        db.help_requests.find_one_and_update = AsyncMock(
            return_value={**row, "status": "cancelled"}
        )
        resp = await c.delete(
            f"/api/help/{ObjectId()}",
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"
        # The row survives — this is the guarantee the worker relies on.
        db.help_requests.delete_one.assert_not_awaited()
        update = db.help_requests.find_one_and_update.await_args.args[1]["$set"]
        assert update["status"] == "cancelled"
        assert "cancelled_at" in update

    async def test_accepted_request_is_never_deleted(self, helpdb):
        """An accepted worker is already on their way. Deleting the row here
        is the exact failure the split exists to prevent."""
        c, db = helpdb
        uid = ObjectId()
        row = self._row(uid, offers=["one"], status="accepted")
        db.help_requests.find_one = AsyncMock(return_value=row)
        db.help_requests.find_one_and_update = AsyncMock(
            return_value={**row, "status": "cancelled"}
        )
        resp = await c.delete(
            f"/api/help/{ObjectId()}",
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 200
        db.help_requests.delete_one.assert_not_awaited()

    async def test_withdrawing_someone_elses_request_is_404(self, helpdb):
        c, db = helpdb
        db.help_requests.find_one = AsyncMock(return_value=None)
        resp = await c.delete(
            f"/api/help/{ObjectId()}",
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 404
        db.help_requests.delete_one.assert_not_awaited()

    @pytest.mark.parametrize("status", ["done", "cancelled"])
    async def test_already_closed_is_409(self, helpdb, status):
        c, db = helpdb
        uid = ObjectId()
        db.help_requests.find_one = AsyncMock(
            return_value=self._row(uid, offers=["one"], status=status)
        )
        resp = await c.delete(
            f"/api/help/{ObjectId()}",
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 409
        db.help_requests.delete_one.assert_not_awaited()
        db.help_requests.find_one_and_update.assert_not_awaited()
