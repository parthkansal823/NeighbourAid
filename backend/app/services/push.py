"""Web push — reaching volunteers whose tab is closed.

`websocket.py` can only reach a volunteer holding an open socket. That is
the majority of nobody: a crisis app is not something people sit with. Push
is how an alert reaches the phone in someone's pocket, and it is the only
part of the dispatch chain that works when the app is not running.

Why not `pywebpush`
-------------------
It is the reference implementation and it would work. It also hard-depends
on `aiohttp` AND `requests` — thirteen packages, two more HTTP clients, in
a project that already ships `httpx` and keeps requirements.txt short
enough to audit.

So this uses the two libraries pywebpush itself uses for the parts that
matter — `http_ece` for the payload encryption (RFC 8291) and `py_vapid`
for the auth JWT (RFC 8292) — and does the POST with the `httpx` already
here. Both add only `cryptography`, which is already a dependency. Nothing
cryptographic is hand-rolled: `http_ece.encrypt` is the same call pywebpush
makes.

Standards, and which vintage
----------------------------
* `Vapid02`, not `Vapid01`. 01 is the expired draft and sends a separate
  `Crypto-Key` header; 02 is RFC 8292 and puts everything in one
  `Authorization: vapid t=<jwt>, k=<key>`. Some push services still accept
  01; none require it.
* `aes128gcm`, not the legacy `aesgcm`. RFC 8291, and the only encoding
  current browsers need.
* An `Urgency` header per alert. The push service may hold a `low` message
  until the device next wakes, and delivers `high` immediately. Everything
  is still sent — this only tells the service how much battery each one is
  worth spending.

Declarative Web Push (a JSON payload the browser renders with no service
worker at all) is newer than both and deliberately not used: it is Safari
18.4+ only, so the service-worker path has to exist regardless, and two
code paths for one notification is worse than one.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import httpx
from bson import ObjectId
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from ..core.config import settings
from .availability import is_available

log = logging.getLogger(__name__)

__all__ = ["is_enabled", "public_key", "push_nearby", "send_to_subscription"]

COLLECTION = "push_subscriptions"

# How long a push service should hold an undelivered message. Four hours:
# long enough to cover a phone that is off or out of signal for a while,
# short enough that nobody is woken at 2 a.m. about something that resolved
# at 10 p.m. the night before.
TTL_SECONDS = 4 * 60 * 60

# Our four levels onto the protocol's. Nothing is dropped — this decides how
# hard the push service tries, not whether it tries. "very-low" is left
# unused: it permits delivery only when the device is already awake and on
# power, which for a neighbour needing help is too close to not sending.
URGENCY = {
    "CRITICAL": "high",
    "HIGH": "high",
    "MEDIUM": "normal",
    "LOW": "low",
}

# A VAPID JWT is per-origin and reusable until it expires. Twelve hours is
# the usual ceiling; re-signing per message would be wasted ECDSA on every
# fan-out.
_JWT_TTL_SECONDS = 12 * 60 * 60
_jwt_cache: dict[str, tuple[float, str]] = {}


def is_enabled() -> bool:
    """Both halves or nothing. A public key without its private key produces
    subscriptions that can never be pushed to — worse than being off,
    because the UI would tell the user notifications are on."""
    return bool(settings.VAPID_PUBLIC_KEY.strip() and settings.VAPID_PRIVATE_KEY.strip())


def public_key() -> str:
    """The `applicationServerKey` the browser needs to subscribe."""
    return settings.VAPID_PUBLIC_KEY.strip()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _load_private_key() -> ec.EllipticCurvePrivateKey:
    """The configured key, as a P-256 private key.

    Accepts either the raw urlsafe-base64 form that `py_vapid` prints or a
    PEM block, because both are what people end up with depending on which
    snippet they copied.
    """
    raw = settings.VAPID_PRIVATE_KEY.strip()
    if "BEGIN" in raw:
        return serialization.load_pem_private_key(raw.encode(), password=None)
    return ec.derive_private_key(int.from_bytes(_unb64(raw), "big"), ec.SECP256R1())


def _vapid_headers(origin: str) -> dict[str, str]:
    """`Authorization: vapid t=<jwt>, k=<key>` for one push-service origin."""
    now = time.time()
    cached = _jwt_cache.get(origin)
    # Re-sign a few minutes early: a token that expires in transit is a
    # 401 that looks like a misconfigured key.
    if cached and cached[0] - 300 > now:
        return {"Authorization": cached[1]}

    from py_vapid import Vapid02  # noqa: PLC0415 - only needed when enabled

    v = Vapid02.from_raw(settings.VAPID_PRIVATE_KEY.strip().encode())
    exp = int(now) + _JWT_TTL_SECONDS
    header = v.sign(
        {"aud": origin, "sub": settings.VAPID_SUBJECT, "exp": str(exp)}
    )["Authorization"]
    _jwt_cache[origin] = (exp, header)
    return {"Authorization": header}


def _encrypt(payload: dict[str, Any], p256dh: str, auth: str) -> bytes:
    """aes128gcm, keyed to this one subscription (RFC 8291)."""
    import http_ece  # noqa: PLC0415 - only needed when enabled

    return http_ece.encrypt(
        json.dumps(payload, default=str).encode(),
        private_key=ec.generate_private_key(ec.SECP256R1()),
        dh=_unb64(p256dh),
        auth_secret=_unb64(auth),
        version="aes128gcm",
    )


async def send_to_subscription(
    client: httpx.AsyncClient,
    subscription: dict[str, Any],
    payload: dict[str, Any],
    urgency: str = "normal",
) -> bool:
    """Send one message. Returns True if the subscription is dead.

    Dead means the push service said so — 404 (endpoint never existed) or
    410 Gone (the browser revoked it). Those are the only two codes that
    justify deleting a row. A 429 or a 503 is the service asking us to try
    later, and a timeout is the network; deleting on either would silently
    unsubscribe people whose phones were merely offline.
    """
    endpoint = subscription.get("endpoint") or ""
    keys = subscription.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        return True  # malformed beyond repair; nothing to retry

    try:
        body = _encrypt(payload, keys["p256dh"], keys["auth"])
        parsed = urlparse(endpoint)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        headers = {
            **_vapid_headers(origin),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_SECONDS),
            "Urgency": urgency,
        }
        resp = await client.post(endpoint, content=body, headers=headers)
    except Exception as exc:
        # Never raise into the caller: this runs in a background fan-out,
        # and one unreachable push service must not stop the others.
        log.warning("push send failed: %s", exc)
        return False

    if resp.status_code in (404, 410):
        return True
    if resp.status_code >= 400:
        log.warning("push rejected %s: %s", resp.status_code, resp.text[:200])
    return False


def _notification(alert: dict[str, Any]) -> dict[str, Any]:
    """What the service worker renders. Kept small — push services cap the
    payload (4 KB is the safe assumption) and the body is encrypted, so
    every field costs."""
    urgency = (alert.get("urgency") or "MEDIUM").upper()
    where = alert.get("address") or alert.get("area") or ""
    return {
        "id": str(alert.get("_id") or alert.get("id") or ""),
        "urgency": urgency,
        "category": alert.get("category") or "other",
        "title": f"{urgency} · {alert.get('category') or 'alert'}",
        "body": (alert.get("headline") or alert.get("description") or "")[:140],
        "where": where[:80],
    }


async def push_nearby(
    db,
    alert: dict[str, Any],
    radius_km: float,
    skip_user_ids: Optional[Iterable[str]] = None,
) -> int:
    """Push one alert to subscribed volunteers in range. Returns the count sent.

    `skip_user_ids` are the volunteers the WebSocket already reached. They
    are looking at the alert right now; a notification for something already
    on their screen is the fastest way to teach someone to turn them off.
    """
    if not is_enabled():
        return 0

    lng, lat = alert["location"]["coordinates"]
    skip = {str(x) for x in (skip_user_ids or ())}

    # Home location, not live position — the same limitation the responder
    # endpoint documents. Someone who moved across town today gets alerts for
    # where they said they live, which is the best a closed tab can offer.
    nearby = await db.users.find(
        {
            "role": "volunteer",
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": int(radius_km * 1000),
                }
            },
        },
        {"_id": 1, "availability": 1},
    ).to_list(500)

    urgency_label = (alert.get("urgency") or "MEDIUM").upper()
    # Quiet hours gate push and nothing else. A volunteer with the feed open
    # at three in the morning is awake and looking at it; the setting is
    # about not buzzing a pocket, not about hiding an alert from a screen.
    ids = [
        u["_id"]
        for u in nearby
        if str(u["_id"]) not in skip
        and is_available(u.get("availability"), urgency_label)
    ]
    if not ids:
        return 0

    subs = await db[COLLECTION].find({"user_id": {"$in": ids}}).to_list(1000)
    if not subs:
        return 0

    payload = _notification(alert)
    urgency = URGENCY.get(payload["urgency"], "normal")
    dead: list[ObjectId] = []
    sent = 0

    async with httpx.AsyncClient(timeout=10.0) as client:
        for sub in subs:
            if await send_to_subscription(client, sub, payload, urgency):
                dead.append(sub["_id"])
            else:
                sent += 1

    if dead:
        # Prune, or every later fan-out pays for endpoints that will never
        # accept another message. This is why 404/410 is a narrow test: a
        # wrong one here quietly unsubscribes real volunteers.
        await db[COLLECTION].delete_many({"_id": {"$in": dead}})
        log.info("pruned %s dead push subscription(s)", len(dead))

    return sent


def generate_keypair() -> tuple[str, str]:
    """A fresh VAPID pair, for `python -m app.services.push`.

    Here rather than in a README snippet because a snippet drifts and this
    cannot: it uses the same library that verifies the key at send time.
    """
    from py_vapid import Vapid02  # noqa: PLC0415

    v = Vapid02()
    v.generate_keys()
    private_raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64(public_raw), _b64(private_raw)


if __name__ == "__main__":  # pragma: no cover - operator convenience
    pub, priv = generate_keypair()
    print("Add these to backend/.env — the private key is a credential.\n")
    print(f"VAPID_PUBLIC_KEY={pub}")
    print(f"VAPID_PRIVATE_KEY={priv}")
    print(f"VAPID_SUBJECT=mailto:{os.getenv('USER') or 'ops'}@example.com")
