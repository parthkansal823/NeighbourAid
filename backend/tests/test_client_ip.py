"""Forwarded identity is trusted only after the ASGI edge guard succeeds."""

import json

import pytest
from fastapi import HTTPException, Request
from httpx import ASGITransport, AsyncClient

from app.core.edge_guard import EDGE_AUTHENTICATED, HEADER, EdgeSecretMiddleware
from app.core.limits import _client_ip, _make_dep
from app.services.ratelimit import RateLimiter

SECRET = "test-edge-secret-for-client-identity"
PEER = "192.0.2.20"


def _request(headers=(), *, trusted=False, client=(PEER, 1234)):
    return Request({
        "type": "http",
        "headers": list(headers),
        "client": client,
        EDGE_AUTHENTICATED: trusted,
    })


@pytest.mark.parametrize("trusted", [False, True])
@pytest.mark.parametrize("value", [
    b"", b"made-up-ip", b", 198.51.100.1", b"198.51.100.1:80",
    b"fe80::1%bucket-a", b"::1%bucket-b", b"\xff",
])
def test_invalid_forwarded_identity_falls_back_to_peer(trusted, value):
    assert _client_ip(_request([(b"x-forwarded-for", value)], trusted=trusted)) == PEER


@pytest.mark.parametrize("value,expected", [
    (b"198.51.100.7", "198.51.100.7"),
    (b" 198.51.100.7 , 192.0.2.3", "198.51.100.7"),
    (b"2001:0db8:0000:0000:0000:0000:0000:0007", "2001:db8::7"),
])
def test_authenticated_edge_identity_is_normalized(value, expected):
    assert _client_ip(_request([(b"x-forwarded-for", value)], trusted=True)) == expected


def test_duplicate_forwarded_headers_fall_back_to_peer():
    request = _request([
        (b"x-forwarded-for", b"198.51.100.1"),
        (b"x-forwarded-for", b"198.51.100.2"),
    ], trusted=True)
    assert _client_ip(request) == PEER


def test_missing_peer_has_a_shared_fallback():
    assert _client_ip(_request(client=None)) == "unknown"


@pytest.mark.parametrize("secret,path,header,expected", [
    ("", "/api/example", SECRET, PEER),
    (SECRET, "/health", None, PEER),
    (SECRET, "/health", SECRET, PEER),
    (SECRET, "/api/example", SECRET, "198.51.100.7"),
])
async def test_guard_alone_controls_forwarded_identity(secret, path, header, expected):
    seen = []

    async def app(scope, receive, send):
        seen.append(scope[EDGE_AUTHENTICATED])
        body = json.dumps({"ip": _client_ip(Request(scope))}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    # Even preexisting scope state must be reset when the guard is disabled
    # or the health exemption bypasses authentication.
    async def upstream(scope, receive, send):
        scope[EDGE_AUTHENTICATED] = True
        await EdgeSecretMiddleware(app, secret=secret)(scope, receive, send)

    headers = {"x-forwarded-for": "198.51.100.7"}
    if header:
        headers[HEADER] = header
    async with AsyncClient(
        transport=ASGITransport(app=upstream, client=(PEER, 1234)),
        base_url="http://test",
    ) as client:
        response = await client.get(path, headers=headers)
    assert response.json()["ip"] == expected
    assert seen == [expected != PEER]


async def test_forwarded_and_secret_headers_cannot_evade_a_direct_rate_limit():
    dep = _make_dep(RateLimiter(1, 60), "test")
    await dep(_request([(b"x-forwarded-for", b"198.51.100.1")]))
    with pytest.raises(HTTPException) as exc:
        await dep(_request([
            (b"x-forwarded-for", b"198.51.100.2"),
            (HEADER.encode(), SECRET.encode()),
            (b"neighbouraid.edge_authenticated", b"true"),
        ]))
    assert exc.value.status_code == 429


async def test_authenticated_clients_get_distinct_buckets():
    dep = _make_dep(RateLimiter(1, 60), "test")
    for ip in (b"198.51.100.1", b"198.51.100.2"):
        await dep(_request([(b"x-forwarded-for", ip)], trusted=True))
    with pytest.raises(HTTPException) as exc:
        await dep(_request([(b"x-forwarded-for", b"198.51.100.1")], trusted=True))
    assert exc.value.status_code == 429


def test_alerts_and_geo_use_the_shared_identity_helper():
    from app.routes import alerts, geo

    for helper in (alerts._client_ip, geo._client_ip):
        request = _request([(b"x-forwarded-for", b"198.51.100.7")])
        assert helper(request) == PEER
        request.scope[EDGE_AUTHENTICATED] = True
        assert helper(request) == "198.51.100.7"


@pytest.mark.parametrize("path,limiter_name,prefix,body", [
    ("/api/auth/login", "login_limiter", "login:",
     {"email": "x@example.com", "password": "secret-1"}),
    ("/api/alerts/anonymous", "anonymous_alert_limiter", "", {
        "category": "fire", "description": "Smoke coming from the kitchen",
        "location": {"type": "Point", "coordinates": [76.7, 30.7]},
    }),
    ("/api/geo/reverse", "write_limiter", "", None),
    ("/api/geo/hospitals", "write_limiter", "", None),
])
async def test_route_limits_cannot_be_bypassed_with_spoofed_ip(
    client, monkeypatch, path, limiter_name, prefix, body,
):
    from app.services import ratelimit

    limiter = getattr(ratelimit, limiter_name)
    monkeypatch.setattr(limiter, "max", 1)
    assert limiter.allow(f"{prefix}127.0.0.1")
    c, db = client
    headers = {"x-forwarded-for": "198.51.100.123", HEADER: SECRET}
    if body is None:
        response = await c.get(path, params={"lat": 30.7, "lng": 76.7}, headers=headers)
    else:
        response = await c.post(path, json=body, headers=headers)
    assert response.status_code == 429
    db.users.find_one.assert_not_awaited()
    db.alerts.insert_one.assert_not_awaited()
