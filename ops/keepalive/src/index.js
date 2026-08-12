/**
 * Keeps the Render free-tier backend from sleeping.
 *
 * Render spins a free web service down after 15 minutes with no inbound
 * request, and the cold start back up is roughly 50 seconds. For most side
 * projects that is a shrug. Here the first request after an idle period is
 * someone pressing SOS, so the entire premise of the app — "reach in
 * minutes" — is spent waiting for a container to boot. This worker keeps
 * the service warm by making sure a request always arrives first.
 *
 * Cloudflare Workers cron triggers are free and the frontend already lives
 * on Cloudflare, so this adds a schedule rather than another vendor.
 *
 * Budget note: Render gives 750 free instance-hours a month and a calendar
 * month is ~730, so one always-warm service fits — but only one. A second
 * free service on the same account pushes you over and both get suspended.
 */

const TIMEOUT_MS = 20_000

async function ping(env) {
  const base = (env.BACKEND_URL || '').replace(/\/+$/, '')
  if (!base) {
    console.error('BACKEND_URL is not set — nothing to ping')
    return { ok: false, status: 0, reason: 'unconfigured' }
  }

  // AbortSignal rather than a bare fetch: a cold-starting Render container
  // can hold the socket open for the better part of a minute, and a worker
  // invocation that hangs is a worker invocation that gets killed with the
  // wake-up only half done.
  const started = Date.now()
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'neighbouraid-keepalive/1.0' },
      // Never serve this from cache — a cached 200 would keep reporting
      // success while the origin quietly slept.
      cache: 'no-store',
    })
    const ms = Date.now() - started
    if (!res.ok) {
      console.error(`health ${res.status} in ${ms}ms`)
      return { ok: false, status: res.status, ms }
    }
    // A slow success is the interesting signal: it means the ping arrived
    // after the service had already gone cold, so the schedule is drifting
    // wider than Render's 15-minute idle window.
    if (ms > 5000) console.warn(`health ok but slow: ${ms}ms — likely a cold start`)
    return { ok: true, status: res.status, ms }
  } catch (err) {
    console.error(`health unreachable after ${Date.now() - started}ms: ${err}`)
    return { ok: false, status: 0, reason: String(err) }
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env))
  },

  // Manual trigger, so you can confirm the worker is wired up correctly
  // without waiting out a cron interval.
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/ping') {
      return new Response('neighbouraid keepalive — GET /ping to test\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
    const result = await ping(env)
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
