"""Paid neighbourhood help — /api/help.

A separate collection from alerts on purpose (see routes/help.py for why):
none of the emergency machinery — urgency triage, geo broadcast, escalation,
corroboration — applies to a dead fuse box, and a paid job must never compete
for space in a feed whose whole point is that the most urgent thing is first.

What these cover is the part that would hurt if it broke: who can see a phone
number, who can see what everyone else quoted, and who is allowed to accept.
The serializer is where all three are decided, so most of this tests it
directly rather than through a mocked cursor.
"""

import pytest
from bson import ObjectId

from app.routes.help import BUDGET_MAX, REQUEST_TTL_DAYS, HelpCreate, _serialize


REQUESTER = ObjectId()
WORKER = ObjectId()
STRANGER = ObjectId()


def _doc(**over):
    doc = {
        "_id": ObjectId(),
        "requester_id": REQUESTER,
        "kind": "electrician",
        "title": "Fuse box tripping every hour",
        "description": "Main board trips when the geyser runs",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        "budget_min": 300,
        "budget_max": 800,
        "contact": "98xxxxxx01",
        "status": "open",
        "offers": [
            {
                "worker_id": WORKER,
                "worker_name": "Ravi",
                "price": 500,
                "note": "Can come today 6pm",
            }
        ],
        "accepted_worker_id": None,
    }
    doc.update(over)
    return doc


class TestContactIsNotPublic:
    """A phone number on an open listing is a number that gets scraped."""

    def test_hidden_from_an_anonymous_browser(self):
        out = _serialize(_doc(), viewer_id=None)
        assert "contact" not in out

    def test_hidden_from_a_stranger(self):
        out = _serialize(_doc(), viewer_id=str(STRANGER))
        assert "contact" not in out

    def test_hidden_from_a_worker_who_only_offered(self):
        # Offering is not the same as being chosen. Until the requester
        # accepts, a worker has no more claim on the number than anyone else.
        out = _serialize(_doc(), viewer_id=str(WORKER))
        assert "contact" not in out

    def test_visible_to_the_requester(self):
        out = _serialize(_doc(), viewer_id=str(REQUESTER))
        assert out["contact"] == "98xxxxxx01"

    def test_visible_to_the_accepted_worker(self):
        # The point at which the two of them are actually arranging a visit.
        out = _serialize(
            _doc(status="accepted", accepted_worker_id=WORKER),
            viewer_id=str(WORKER),
        )
        assert out["contact"] == "98xxxxxx01"

    def test_still_hidden_from_a_different_worker_after_acceptance(self):
        out = _serialize(
            _doc(status="accepted", accepted_worker_id=WORKER),
            viewer_id=str(STRANGER),
        )
        assert "contact" not in out


class TestOffersAreTheRequestersToRead:
    """A worker seeing what everyone else quoted turns this into a reverse
    auction, which is not what a neighbour asking for a plumber signed up
    for."""

    def test_offers_hidden_from_everyone_else(self):
        for viewer in (None, str(WORKER), str(STRANGER)):
            out = _serialize(_doc(), viewer_id=viewer)
            assert "offers" not in out, viewer

    def test_requester_sees_the_offers(self):
        out = _serialize(_doc(), viewer_id=str(REQUESTER))
        assert len(out["offers"]) == 1
        assert out["offers"][0]["price"] == 500

    def test_everyone_sees_the_count(self):
        # How much interest a request has drawn is not private — it is what
        # tells a worker whether it is worth quoting.
        out = _serialize(_doc(), viewer_id=None)
        assert out["offer_count"] == 1

    def test_count_is_zero_with_no_offers(self):
        out = _serialize(_doc(offers=[]), viewer_id=None)
        assert out["offer_count"] == 0


class TestSerialisation:
    def test_object_ids_become_strings(self):
        # FastAPI's JSON encoder does not know ObjectId, so a raw one fails
        # the whole response rather than the single field.
        out = _serialize(_doc(), viewer_id=str(REQUESTER))
        assert isinstance(out["id"], str)
        assert isinstance(out["requester_id"], str)
        assert isinstance(out["offers"][0]["worker_id"], str)

    def test_accepted_worker_is_none_when_unaccepted(self):
        assert _serialize(_doc(), viewer_id=None)["accepted_worker_id"] is None

    def test_accepted_worker_is_a_string_once_set(self):
        out = _serialize(_doc(accepted_worker_id=WORKER), viewer_id=None)
        assert out["accepted_worker_id"] == str(WORKER)


class TestBudgetValidation:
    def test_accepts_a_sane_range(self):
        body = HelpCreate(
            kind="plumber",
            title="Leaking tap in the kitchen",
            location={"type": "Point", "coordinates": [76.7, 30.7]},
            budget_min=200,
            budget_max=600,
        )
        assert body.budget_max == 600

    def test_rejects_a_max_below_the_min(self):
        # A typo, not a preference — and it would render as "₹500–₹100".
        with pytest.raises(ValueError):
            HelpCreate(
                kind="plumber",
                title="Leaking tap in the kitchen",
                location={"type": "Point", "coordinates": [76.7, 30.7]},
                budget_min=500,
                budget_max=100,
            )

    def test_allows_zero_for_tell_me_your_price(self):
        body = HelpCreate(
            kind="tech",
            title="Laptop will not start at all",
            location={"type": "Point", "coordinates": [76.7, 30.7]},
        )
        assert body.budget_min == 0 and body.budget_max == 0

    def test_rejects_an_absurd_number(self):
        # An unbounded number in a public listing is an invitation.
        with pytest.raises(ValueError):
            HelpCreate(
                kind="tech",
                title="Laptop will not start at all",
                location={"type": "Point", "coordinates": [76.7, 30.7]},
                budget_max=BUDGET_MAX + 1,
            )

    def test_rejects_a_title_too_short_to_mean_anything(self):
        with pytest.raises(ValueError):
            HelpCreate(
                kind="tech",
                title="fix",
                location={"type": "Point", "coordinates": [76.7, 30.7]},
            )

    def test_trims_whitespace(self):
        body = HelpCreate(
            kind="carpenter",
            title="   Door hinge broken   ",
            location={"type": "Point", "coordinates": [76.7, 30.7]},
        )
        assert body.title == "Door hinge broken"


class TestRequestsExpire:
    def test_ttl_is_weeks_not_months(self):
        # Nobody comes back to close their own request, so a plumber wanted
        # three weeks ago would sit in the feed as noise forever.
        assert 7 <= REQUEST_TTL_DAYS <= 30


class TestEndpointGuards:
    async def test_posting_requires_an_account(self, client):
        c, _ = client
        resp = await c.post(
            "/api/help/",
            json={
                "kind": "electrician",
                "title": "Fuse box tripping every hour",
                "location": {"type": "Point", "coordinates": [76.7, 30.7]},
            },
        )
        assert resp.status_code == 401

    async def test_browsing_does_not(self, client):
        # Someone deciding whether the app is worth installing should be able
        # to see whether anyone nearby needs their trade.
        c, db = client
        db.help_requests.create_index = _AsyncNoop()
        db.help_requests.find = _cursor([])
        resp = await c.get("/api/help/near", params={"lat": 30.7, "lng": 76.7})
        assert resp.status_code == 200

    async def test_mine_requires_an_account(self, client):
        c, _ = client
        assert (await c.get("/api/help/mine")).status_code == 401


class _AsyncNoop:
    async def __call__(self, *a, **k):
        return None


def _cursor(docs):
    from unittest.mock import MagicMock

    async def iterate():
        for d in docs:
            yield d

    cur = MagicMock()
    cur.limit = MagicMock(return_value=iterate())
    cur.__aiter__ = lambda _self: iterate()
    return MagicMock(return_value=cur)
