"""Web push: the enable gate, the subscription endpoints, and the fan-out.

Two things here are worth more than the rest.

`send_to_subscription` must delete a subscription on 404/410 and on nothing
else. Too narrow and every fan-out pays forever for endpoints that will
never accept a message again; too wide and a volunteer whose phone was
briefly offline is silently unsubscribed and never paged again. Both
failures are invisible from the outside, which is why both are asserted.

`push_nearby` must skip whoever the WebSocket already reached. A push for an
alert already on someone's screen is the fastest way to teach them to turn
notifications off, and then the CRITICAL one does not arrive either.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from bson import ObjectId

from app.core.config import settings
from app.core.security import create_token
from app.services import push


def _token(uid=None, role="volunteer"):
    return create_token({"sub": str(uid or ObjectId()), "role": role})


@pytest.fixture
def keys():
    """A real VAPID pair for the duration of one test."""
    pub, priv = push.generate_keypair()
    old = (settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY)
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = pub, priv
    push._jwt_cache.clear()
    yield pub
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = old
    push._jwt_cache.clear()


@pytest.fixture
def no_keys():
    old = (settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY)
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "", ""
    yield
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = old


def _subscription():
    """A subscription shaped like `PushSubscription.toJSON()`."""
    import base64
    import os

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )

    def b64(b):
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    return {
        "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
        "keys": {"p256dh": b64(raw), "auth": b64(os.urandom(16))},
    }


class TestEnableGate:
    def test_off_without_keys(self, no_keys):
        assert push.is_enabled() is False

    def test_on_with_both(self, keys):
        assert push.is_enabled() is True

    def test_half_configured_is_off(self):
        """A public key with no private key produces subscriptions that can
        never be pushed to — worse than being off, because the UI would tell
        the volunteer they are covered."""
        old = (settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY)
        settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "something", ""
        try:
            assert push.is_enabled() is False
        finally:
            settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = old


class TestKeyEndpoint:
    @pytest.mark.asyncio
    async def test_503_when_not_configured(self, client, no_keys):
        c, _ = client
        assert (await c.get("/api/push/key")).status_code == 503

    @pytest.mark.asyncio
    async def test_returns_the_application_server_key(self, client, keys):
        c, _ = client
        resp = await c.get("/api/push/key")
        assert resp.status_code == 200
        # 87 chars is what a browser accepts for an uncompressed P-256 point;
        # anything else and `pushManager.subscribe` throws.
        assert len(resp.json()["public_key"]) == 87


class TestSubscribe:
    @pytest.mark.asyncio
    async def test_stores_the_subscription_against_the_caller(self, client, keys):
        c, db = client
        uid = ObjectId()
        db[push.COLLECTION].create_index = AsyncMock()
        db[push.COLLECTION].update_one = AsyncMock()
        resp = await c.post(
            "/api/push/subscribe",
            json=_subscription(),
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 201
        args = db[push.COLLECTION].update_one.await_args
        # Keyed on endpoint, not user: one person may carry a phone and a
        # laptop, and both should ring.
        assert "endpoint" in args.args[0]
        assert args.args[1]["$set"]["user_id"] == uid
        assert args.kwargs["upsert"] is True

    @pytest.mark.asyncio
    async def test_503_when_not_configured(self, client, no_keys):
        c, _ = client
        resp = await c.post(
            "/api/push/subscribe",
            json=_subscription(),
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_anonymous_callers_are_rejected(self, client, keys):
        c, _ = client
        assert (await c.post("/api/push/subscribe", json=_subscription())).status_code in (
            401,
            403,
        )

    @pytest.mark.asyncio
    async def test_plain_http_endpoints_are_refused(self, client, keys):
        """Every real push service is https. A plain-http endpoint is either
        a misconfiguration or someone pointing this server at a host of
        their choosing."""
        c, db = client
        db[push.COLLECTION].create_index = AsyncMock()
        db[push.COLLECTION].update_one = AsyncMock()
        body = _subscription()
        body["endpoint"] = "http://evil.example.com/hook"
        resp = await c.post(
            "/api/push/subscribe",
            json=body,
            headers={"Authorization": f"Bearer {_token()}"},
        )
        assert resp.status_code == 422
        db[push.COLLECTION].update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unsubscribe_is_scoped_to_the_owner(self, client, keys):
        c, db = client
        uid = ObjectId()
        db[push.COLLECTION].delete_one = AsyncMock()
        resp = await c.request(
            "DELETE",
            "/api/push/subscribe",
            json=_subscription(),
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 204
        assert db[push.COLLECTION].delete_one.await_args.args[0]["user_id"] == uid


class TestDeadSubscriptionDetection:
    """404 and 410 mean delete. Nothing else does."""

    @staticmethod
    def _client_returning(status):
        cli = MagicMock()
        cli.post = AsyncMock(return_value=MagicMock(status_code=status, text=""))
        return cli

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [404, 410])
    async def test_gone_endpoints_are_reported_dead(self, keys, status):
        dead = await push.send_to_subscription(
            self._client_returning(status), _subscription(), {"title": "x"}
        )
        assert dead is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [201, 429, 500, 503])
    async def test_everything_else_is_kept(self, keys, status):
        """429 and 503 are the service asking us to try later. Deleting on
        either would unsubscribe volunteers whose phones were merely busy."""
        dead = await push.send_to_subscription(
            self._client_returning(status), _subscription(), {"title": "x"}
        )
        assert dead is False

    @pytest.mark.asyncio
    async def test_a_network_error_is_not_death(self, keys):
        cli = MagicMock()
        cli.post = AsyncMock(side_effect=TimeoutError("network"))
        assert await push.send_to_subscription(cli, _subscription(), {"t": 1}) is False

    @pytest.mark.asyncio
    async def test_a_malformed_row_is_dead(self, keys):
        """No keys means it can never be encrypted for. Retrying forever is
        the only other option, and it never succeeds."""
        assert await push.send_to_subscription(MagicMock(), {"endpoint": ""}, {}) is True


class TestUrgencyMapping:
    def test_every_level_maps(self):
        assert set(push.URGENCY) == {"CRITICAL", "HIGH", "MEDIUM", "LOW"}

    def test_critical_is_delivered_immediately(self):
        assert push.URGENCY["CRITICAL"] == "high"

    def test_low_is_allowed_to_wait_but_not_to_be_dropped(self):
        """"very-low" permits delivery only when the device is awake and on
        power, which for a neighbour needing help is too close to not
        sending at all."""
        assert push.URGENCY["LOW"] == "low"
        assert "very-low" not in push.URGENCY.values()


class TestFanOut:
    @staticmethod
    def _db(volunteers, subs):
        db = MagicMock()
        cur = MagicMock()
        cur.to_list = AsyncMock(return_value=volunteers)
        db.users.find = MagicMock(return_value=cur)
        sub_cur = MagicMock()
        sub_cur.to_list = AsyncMock(return_value=subs)
        coll = MagicMock()
        coll.find = MagicMock(return_value=sub_cur)
        coll.delete_many = AsyncMock()
        db.__getitem__ = MagicMock(return_value=coll)
        return db, coll

    ALERT = {
        "_id": ObjectId(),
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
        "urgency": "CRITICAL",
        "category": "medical",
        "description": "Person unconscious near the park gate",
    }

    @pytest.mark.asyncio
    async def test_does_nothing_when_push_is_off(self, no_keys):
        db, _ = self._db([], [])
        assert await push.push_nearby(db, self.ALERT, 5.0) == 0

    @pytest.mark.asyncio
    async def test_skips_volunteers_the_socket_already_reached(self, keys, monkeypatch):
        live, offline = ObjectId(), ObjectId()
        db, coll = self._db([{"_id": live}, {"_id": offline}], [])
        await push.push_nearby(db, self.ALERT, 5.0, skip_user_ids={str(live)})
        # Only the offline volunteer's subscriptions are even looked up.
        assert coll.find.call_args.args[0]["user_id"]["$in"] == [offline]

    @pytest.mark.asyncio
    async def test_prunes_only_the_dead_rows(self, keys, monkeypatch):
        vid = ObjectId()
        good = {"_id": ObjectId(), **_subscription()}
        bad = {"_id": ObjectId(), **_subscription()}
        db, coll = self._db([{"_id": vid}], [good, bad])

        async def fake_send(_client, sub, _payload, _urgency="normal"):
            return sub["_id"] == bad["_id"]

        monkeypatch.setattr(push, "send_to_subscription", fake_send)
        sent = await push.push_nearby(db, self.ALERT, 5.0)
        assert sent == 1
        coll.delete_many.assert_awaited_once()
        assert coll.delete_many.await_args.args[0]["_id"]["$in"] == [bad["_id"]]

    @pytest.mark.asyncio
    async def test_no_subscriptions_is_not_an_error(self, keys):
        db, coll = self._db([{"_id": ObjectId()}], [])
        assert await push.push_nearby(db, self.ALERT, 5.0) == 0
        coll.delete_many.assert_not_awaited()


class TestPayload:
    def test_stays_small_enough_for_a_push_service(self):
        """4 KB is the safe cap, and the body is encrypted, so every field
        costs. A payload over the limit is rejected wholesale."""
        import json

        alert = {
            "_id": ObjectId(),
            "urgency": "CRITICAL",
            "category": "medical",
            "description": "x" * 5000,
            "address": "y" * 5000,
        }
        blob = json.dumps(push._notification(alert))
        assert len(blob.encode()) < 1024, len(blob)

    def test_falls_back_when_fields_are_missing(self):
        n = push._notification({"location": {}, "_id": ObjectId()})
        assert n["urgency"] == "MEDIUM"
        assert n["category"] == "other"
