"""Require that requests arrived through the Cloudflare edge.

The laptop-as-server deployment puts the API behind a Cloudflare Tunnel and
a Worker. The Worker keeps the tunnel hostname server-side, so it is not in
the bundle and not in any config a visitor can read — but a hostname is not
a secret in the way a key is. Tunnel URLs end up in logs, in a shared
screen, in a browser's history. Once one leaks, the laptop is reachable
directly and everything the edge was doing is skipped.

So the Worker signs each request with a shared secret and this refuses
anything without it. The tunnel stops being a way in on its own.

OFF BY DEFAULT, DELIBERATELY

With `EDGE_SECRET` unset this middleware does nothing at all. Local
development, the test suite and any deployment that fronts the API some
other way are unaffected — nobody has to know this exists to run the
project. It only switches on where it is configured, on both sides.

WHY ASGI AND NOT BaseHTTPMiddleware

`/ws/volunteer` is the live volunteer feed, and a WebSocket upgrade never
passes through `BaseHTTPMiddleware` — it only sees `http` scopes. Guarding
with that class would leave the one long-lived, authenticated connection in
the app as the single unguarded way in, which is the opposite of the point.
This sits at the raw ASGI layer so `http` and `websocket` are both covered.

WHY THE COMPARISON IS CONSTANT-TIME

`==` on bytes returns as soon as it finds a difference, so how long a
rejection takes leaks how much of the prefix was right. That is enough to
recover a secret a character at a time over many attempts. `compare_digest`
takes the same time either way.
"""

from __future__ import annotations

import hmac

from app.core.config import settings

HEADER = "x-edge-secret"
# Internal ASGI scope marker; no request header can set it. IP consumers may
# trust forwarding headers only after this middleware authenticates the edge.
EDGE_AUTHENTICATED = "neighbouraid.edge_authenticated"

# Paths that stay reachable without the header. A health probe is how the
# frontend decides whether to show "the demo server is off", and it has to
# answer before anything else is trusted.
_OPEN_PATHS = frozenset({"/health"})


class EdgeSecretMiddleware:
    """Reject anything that did not come through the edge, when configured."""

    def __init__(self, app, secret: str | None = None):
        self.app = app
        # Read once at construction. Flipping this per request would mean an
        # env lookup on every call for a value that cannot change inside a
        # running process.
        # Settings is responsible for reading backend/.env.  Reading
        # os.environ here looks equivalent but is not: pydantic-settings
        # parses env files into `settings` without mutating the process
        # environment, leaving a configured guard silently disabled.
        self._secret = (
            secret if secret is not None else settings.EDGE_SECRET
        ).strip().encode("utf-8")

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        scope[EDGE_AUTHENTICATED] = False
        if not self._secret:
            await self.app(scope, receive, send)
            return

        if scope.get("path", "") in _OPEN_PATHS:
            await self.app(scope, receive, send)
            return

        supplied = [
            raw_value
            for raw_name, raw_value in scope.get("headers", [])
            if raw_name.lower() == HEADER.encode("ascii")
        ]
        # Compare raw bytes: compare_digest(str, str) raises TypeError when
        # an attacker sends a non-ASCII value. Reject ambiguous duplicates.
        if len(supplied) == 1 and hmac.compare_digest(supplied[0], self._secret):
            scope[EDGE_AUTHENTICATED] = True
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            # Close before the handshake completes. A WebSocket cannot carry
            # a status code the way HTTP does, so this is the refusal.
            await send({"type": "websocket.close", "code": 1008})
            return

        body = b'{"detail":"Direct access is not allowed. Use the published address."}'
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
