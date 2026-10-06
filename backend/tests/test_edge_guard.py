"""The edge guard: only the Cloudflare Worker may reach this API.

Tested against the middleware directly rather than through the app fixture,
because the secret is read once when the middleware is constructed — the
app the fixture builds was constructed without one, so patching the
environment afterwards would prove nothing.

The cases that matter are the ones where a guard quietly stops guarding:
it is off and nobody notices, it misses WebSockets, or it lets /health drag
the whole surface open with it.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.edge_guard import HEADER, EdgeSecretMiddleware

SECRET = "s3cret-from-the-worker"


async def _ok_app(scope, receive, send):
    """Minimal ASGI app standing in for the real one."""
    if scope["type"] == "websocket":
        await send({"type": "websocket.accept"})
        return
    body = b'{"reached":true}'
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


def _client(secret):
    app = EdgeSecretMiddleware(_ok_app, secret=secret)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestEdgeSecret:
    @pytest.mark.asyncio
    async def test_a_request_without_the_header_is_refused(self):
        async with _client(SECRET) as c:
            r = await c.get("/api/stats/")
        assert r.status_code == 403
        assert "Direct access" in r.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_request_carrying_the_secret_passes_through(self):
        async with _client(SECRET) as c:
            r = await c.get("/api/stats/", headers={HEADER: SECRET})
        assert r.status_code == 200
        assert r.json() == {"reached": True}

    @pytest.mark.asyncio
    async def test_a_wrong_secret_is_refused(self):
        async with _client(SECRET) as c:
            r = await c.get("/api/stats/", headers={HEADER: SECRET + "x"})
        assert r.status_code == 403

    @pytest.mark.parametrize("value", [b"\xff", b"\xc3\xa9", b"secret\x80"])
    async def test_non_ascii_header_is_refused_without_crashing(self, value):
        async with _client(SECRET) as c:
            r = await c.get("/api/stats/", headers=[(HEADER.encode(), value)])
        assert r.status_code == 403

    @pytest.mark.parametrize("values", [(SECRET, SECRET), (SECRET, "wrong")])
    async def test_duplicate_secret_headers_are_refused(self, values):
        async with _client(SECRET) as c:
            r = await c.get("/api/stats/", headers=[(HEADER, v) for v in values])
        assert r.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("secret", ["", "   "])
    async def test_it_does_nothing_when_unconfigured(self, secret, monkeypatch):
        """The whole project has to keep working for anyone who has never
        heard of this. An empty or whitespace EDGE_SECRET must not half-arm
        it into refusing everything."""
        async with _client(secret) as c:
            r = await c.get("/api/stats/")
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_an_empty_settings_value_leaves_the_guard_off(self, monkeypatch):
        """The default remains a no-op for normal local development."""
        monkeypatch.setattr(settings, "EDGE_SECRET", "")
        app = EdgeSecretMiddleware(_ok_app)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/stats/")
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_it_reads_the_pydantic_settings_value_when_no_secret_is_passed(self, monkeypatch):
        """backend/.env is parsed into settings, not copied into os.environ."""
        monkeypatch.setattr(settings, "EDGE_SECRET", SECRET)
        app = EdgeSecretMiddleware(_ok_app)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            refused = await c.get("/api/stats/")
            accepted = await c.get("/api/stats/", headers={HEADER: SECRET})
        assert refused.status_code == 403
        assert accepted.status_code == 200

    @pytest.mark.asyncio
    async def test_health_answers_without_the_secret(self):
        """The frontend decides whether to show 'the demo server is off' by
        probing /health. If that needed the secret, a misconfigured edge
        would look identical to a laptop that is switched off."""
        async with _client(SECRET) as c:
            r = await c.get("/health")
        assert r.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "path", ["/healthz", "/health-internal", "/health/secrets", "/health/ready", "/health/"]
    )
    async def test_the_open_path_does_not_open_its_prefix(self, path):
        """/health is exact-match, not a prefix.

        Written with real sibling paths rather than a `/health/../api/...`
        traversal: httpx normalises that away before the middleware ever
        sees it, so that version passed even with the check swapped to
        `startswith` — a test that proved nothing about the thing it named.
        """
        async with _client(SECRET) as c:
            r = await c.get(path)
        assert r.status_code == 403


class TestWebSocketsAreCoveredToo:
    """`/ws/volunteer` is the only long-lived authenticated connection in the
    app, and `BaseHTTPMiddleware` never sees a WebSocket scope. Guarding with
    that class would have left exactly this route open."""

    @staticmethod
    async def _handshake(secret, headers):
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            return {"type": "websocket.connect"}

        scope = {
            "type": "websocket",
            "path": "/ws/volunteer",
            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
        }
        await EdgeSecretMiddleware(_ok_app, secret=secret)(scope, receive, send)
        return sent

    @pytest.mark.asyncio
    async def test_a_websocket_without_the_secret_is_closed(self):
        sent = await self._handshake(SECRET, {})
        assert sent and sent[0]["type"] == "websocket.close"
        # 1008 is "policy violation", which is what this is.
        assert sent[0]["code"] == 1008

    @pytest.mark.asyncio
    async def test_a_websocket_carrying_the_secret_is_accepted(self):
        sent = await self._handshake(SECRET, {HEADER: SECRET})
        assert sent and sent[0]["type"] == "websocket.accept"

    async def test_non_ascii_websocket_secret_is_closed_without_crashing(self):
        sent = await self._handshake(SECRET, {HEADER: "\u00e9"})
        assert sent == [{"type": "websocket.close", "code": 1008}]


@pytest.mark.asyncio
async def test_the_header_name_matches_what_the_worker_sends():
    """The Worker and this module agree on a header name by convention
    only — nothing links them. A rename on one side turns the guard into a
    403 on every request, or into nothing at all."""
    import pathlib
    import re

    worker = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "worker" / "index.js"
    if not worker.exists():
        pytest.skip("frontend worker not present in this checkout")
    sent = re.search(r"headers\.set\(\s*'([^']+)'\s*,\s*env\.EDGE_SECRET", worker.read_text(encoding="utf-8"))
    assert sent, "the Worker no longer sets a secret header"
    assert sent.group(1).lower() == HEADER
