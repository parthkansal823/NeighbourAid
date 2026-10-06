"""Security-headers middleware.

Adds the OWASP-recommended response headers to every API response.
Most of them have no runtime cost; they exist purely so a browser
treats responses safely (no MIME-sniffing, no clickjacking, no
referrer leak, locked-down feature set, only-https-after-first-visit).

We deliberately do NOT set a Content-Security-Policy here — the API
returns JSON, never HTML, so CSP would be moot. The frontend's CSP
is enforced by the SPA host (nginx/Vercel/HF Spaces serving the
built bundle).
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


# Header set chosen for an API server. Tightened to what makes sense for
# JSON-only endpoints; the frontend layer adds its own CSP/COOP/COEP
# at the edge (nginx / Vercel / Cloudflare).
_HEADERS: dict[str, str] = {
    # Prevents MIME-sniffing attacks. Browsers should treat the
    # Content-Type response header as authoritative.
    "X-Content-Type-Options": "nosniff",
    # Defence-in-depth against clickjacking. The API returns JSON,
    # but HTML error pages from misconfigured proxies might be framed.
    "X-Frame-Options": "DENY",
    # Hide the path/query of the API URL when a browser navigates
    # cross-origin from one of our pages.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    # Restrict access to powerful browser APIs from any code we serve.
    # The frontend uses geolocation + microphone + camera, which are
    # explicitly granted via the SPA's own permission prompts; the API
    # never needs them.
    "Permissions-Policy": (
        "camera=(self), microphone=(self), geolocation=(self), "
        "payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()"
    ),
    # Strict Transport Security: tell browsers to always upgrade
    # http:// → https:// for our origin for the next 6 months. Free
    # hosts (HF Spaces, Vercel) terminate TLS for us so this is safe
    # to set unconditionally; if you ever serve plain HTTP behind a
    # custom domain you'd want to gate this on `request.url.scheme`.
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
    # Cross-Origin-Resource-Policy. `cross-origin` allows the SPA on
    # any domain to call us; we already gate auth via JWT in the
    # Authorization header, which is not subject to CSRF the way
    # cookie-auth is.
    "Cross-Origin-Resource-Policy": "cross-origin",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for name, value in _HEADERS.items():
            # Don't clobber explicit per-route overrides.
            response.headers.setdefault(name, value)
        return response
