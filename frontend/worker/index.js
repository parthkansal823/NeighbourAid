/**
 * Edge proxy: Cloudflare in front, a laptop behind it.
 *
 * The deployment this supports is "the frontend is always up, the server is
 * only on when I turn it on". Cloudflare serves the SPA from its edge
 * forever; the API lives on a laptop reachable through a Cloudflare Tunnel
 * that gets started for a demo and stopped afterwards.
 *
 * WHY A WORKER RATHER THAN POINTING THE SPA AT THE TUNNEL
 *
 * A quick tunnel's hostname changes every time it restarts. Baking it into
 * the bundle (VITE_API_URL) means a rebuild and redeploy on every restart,
 * and publishing it — in the bundle or in a config.json — hands anyone the
 * raw origin, which they can then hit directly, bypassing every control that
 * lives at the edge.
 *
 * Here the browser only ever talks to this Worker, on the same origin as the
 * page. The tunnel hostname lives in KV, server-side, and is never sent to a
 * client. Changing it is one `wrangler kv key put` with no deploy at all.
 *
 * Same-origin also means there is no CORS exchange on the hot path: no
 * preflight before each write, and no origin allow-list to keep in step with
 * wherever the frontend happens to be deployed.
 *
 * COST
 *
 * Static assets are served without invoking this Worker (`run_worker_first`
 * is off), so they stay free and unmetered. Only /api, /ws and /health reach
 * the Worker and count against the free plan's daily request allowance,
 * which a demo does not come close to.
 */

/** Paths that belong to the backend. Everything else is the SPA. */
const PROXY_PREFIXES = ['/api/', '/ws/', '/health']

/** KV key holding the current tunnel origin, e.g. https://x-y-z.trycloudflare.com */
const ORIGIN_KEY = 'API_ORIGIN'

/**
 * Shaped like FastAPI's own error body so the frontend has one error shape
 * to handle rather than two. 503 and not 502: the server is not broken, it
 * is switched off, and that is a normal state for this deployment.
 */
function isCapacitorOrigin(origin) {
  // Capacitor Android uses https://localhost in current releases; older
  // shells and custom schemes can use the other two. Do not turn this into
  // `*`: these are the only local origins a packaged app can have.
  return origin === 'https://localhost' || origin === 'http://localhost' || origin === 'capacitor://localhost'
}

function capacitorCors(response, origin) {
  // Preserve Cloudflare's WebSocket response object and its webSocket
  // property. Rebuilding a 101 response breaks native live connections.
  if (response.status === 101) return response
  if (!isCapacitorOrigin(origin)) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  // The native health probe deliberately sends Cache-Control: no-cache.
  // It is not a CORS-safelisted request header, so omitting it blocks the
  // probe and makes a healthy server appear offline inside the APK.
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control')
  headers.set('Access-Control-Expose-Headers', 'X-Edge-Status')
  headers.set('Access-Control-Max-Age', '600')
  // Response caches must not reuse an answer allowed for one origin for a
  // different one. The browser sees a local origin; the backend sees the
  // Worker origin (set below), so the edge owns this small CORS bridge.
  headers.append('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function offline(reason, origin = '') {
  return capacitorCors(Response.json(
    { detail: 'The NeighbourAid API is not running right now.', reason },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        // Tells the SPA this came from the edge, not from a backend that is
        // up but unhealthy — the two deserve different messages.
        'X-Edge-Status': 'origin-offline',
      },
    }
  ), origin)
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url)

    if (!PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return env.ASSETS.fetch(request)
    }

    const callerOrigin = request.headers.get('Origin') || ''

    // Preflight is normally answered by FastAPI's CORS middleware. A native
    // shell has a local origin which FastAPI intentionally does not allow,
    // so handle only that fixed, known origin at the edge instead.
    if (request.method === 'OPTIONS' && isCapacitorOrigin(callerOrigin)) {
      return capacitorCors(new Response(null, { status: 204 }), callerOrigin)
    }

    let origin
    try {
      origin = await env.CONFIG.get(ORIGIN_KEY)
    } catch {
      return offline('configuration-unavailable', callerOrigin)
    }
    if (!origin) return offline('no-origin-configured', callerOrigin)

    let target
    try {
      const configured = new URL(origin)
      if (configured.protocol !== 'https:' || configured.username || configured.password ||
          configured.pathname !== '/' || configured.search || configured.hash) {
        return offline('invalid-origin-configured', callerOrigin)
      }
      target = new URL(url.pathname + url.search, configured.origin)
    } catch {
      return offline('invalid-origin-configured', callerOrigin)
    }

    // `new Request(target, request)` carries the method, body and headers
    // across, including the Upgrade/Sec-WebSocket-* set that /ws/volunteer
    // needs. Rebuilding the headers by hand is what usually breaks the
    // WebSocket handshake here.
    const proxied = new Request(target, request)

    // Proves to the backend that this request came through the edge. Without
    // it, anyone who learns the tunnel hostname can talk to the laptop
    // directly and skip whatever this Worker enforces. The backend only
    // checks it when EDGE_SECRET is set there too, so local development and
    // any deployment that does not want this stay unaffected.
    proxied.headers.delete('X-Edge-Secret')
    if (env.EDGE_SECRET) proxied.headers.set('X-Edge-Secret', env.EDGE_SECRET)

    // The backend recognises its own workers.dev origin. A native app's
    // local WebView origin is deliberately not accepted there; CORS is
    // instead bridged narrowly above and below for the three Capacitor
    // origins. Browser visitors already arrive with url.origin, so this is
    // unchanged for them.
    if (isCapacitorOrigin(callerOrigin)) proxied.headers.set('Origin', url.origin)

    // Preserve the caller's address for the backend's per-IP rate limiting,
    // which reads x-forwarded-for. Cloudflare sets CF-Connecting-IP.
    proxied.headers.delete('X-Forwarded-For')
    proxied.headers.delete('X-Real-IP')
    proxied.headers.delete('Forwarded')
    const ip = request.headers.get('CF-Connecting-IP')
    if (ip) proxied.headers.set('X-Forwarded-For', ip)

    try {
      const response = await fetch(proxied)
      if ([502, 503, 504, 530].includes(response.status)) {
        return offline('origin-unavailable', callerOrigin)
      }
      if (response.status === 101) return response
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      return capacitorCors(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }), callerOrigin)
    } catch {
      // The tunnel is down, or was never started. Reaching the backend is
      // the one thing this Worker does, so a failure here is the offline
      // state rather than an error worth surfacing as a 500.
      return offline('origin-unreachable', callerOrigin)
    }
  },
}
