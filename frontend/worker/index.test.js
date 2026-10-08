import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const publicOrigin = 'https://neighbouraid.example.workers.dev'

afterEach(() => vi.restoreAllMocks())

function env(origin = 'https://api.example.test') {
  return {
    CONFIG: { get: vi.fn().mockResolvedValue(origin) },
    ASSETS: { fetch: vi.fn() },
    EDGE_SECRET: 'only-the-worker-knows-this',
  }
}

describe('native Capacitor proxy bridge', () => {
  it.each(['https://localhost', 'http://localhost', 'capacitor://localhost'])(
    'allows the exact anonymous-report preflight from %s without sending a report', async origin => {
      const config = env()
      const fetchMock = vi.spyOn(globalThis, 'fetch')
      const response = await worker.fetch(new Request(`${publicOrigin}/api/alerts/anonymous`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-anonymous-client-id',
        },
      }), config)
      const allowed = response.headers.get('Access-Control-Allow-Headers').toLowerCase().split(',').map(header => header.trim())
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(response.headers.get('Access-Control-Allow-Methods').split(',').map(method => method.trim())).toContain('POST')
      expect(allowed).toContain('content-type')
      expect(allowed).toContain('x-anonymous-client-id')
      expect(allowed).not.toContain('x-edge-secret')
      expect(config.CONFIG.get).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('handles the Android local-origin preflight at the edge', async () => {
    const response = await worker.fetch(
      new Request(`${publicOrigin}/api/alerts/`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://localhost' },
      }),
      env()
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Anonymous-Client-ID')
  })

  it('allows the native health probe cache-control preflight without allowing a caller edge secret', async () => {
    const response = await worker.fetch(new Request(`${publicOrigin}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'cache-control',
      },
    }), env())
    const allowed = response.headers.get('Access-Control-Allow-Headers').toLowerCase().split(',').map((header) => header.trim())
    expect(allowed).toContain('cache-control')
    expect(allowed).not.toContain('x-edge-secret')
  })

  it('exposes only the safe offline-status header to native JavaScript', async () => {
    const response = await worker.fetch(new Request(`${publicOrigin}/health`, {
      headers: { Origin: 'https://localhost' },
    }), env(null))
    expect(response.status).toBe(503)
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Edge-Status')
  })

  it('forwards a native API call as the Worker and restores only Capacitor CORS', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"status":"ok"}', {
        headers: { 'Access-Control-Allow-Origin': publicOrigin },
      })
    )

    const response = await worker.fetch(
      new Request(`${publicOrigin}/health`, {
        headers: { Origin: 'https://localhost' },
      }),
      env()
    )

    const forwarded = fetchMock.mock.calls[0][0]
    expect(forwarded.headers.get('Origin')).toBe(publicOrigin)
    expect(forwarded.headers.get('X-Edge-Secret')).toBe('only-the-worker-knows-this')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost')
    fetchMock.mockRestore()
  })

  it('does not grant arbitrary browser origins the native CORS bridge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const response = await worker.fetch(
      new Request(`${publicOrigin}/health`, {
        headers: { Origin: 'https://untrusted.example' },
      }),
      env()
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    fetchMock.mockRestore()
  })
})

describe('proxy security and offline behavior', () => {
  it('overwrites forged forwarding and edge headers with Cloudflare values', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await worker.fetch(new Request(`${publicOrigin}/api/stats/`, {
      headers: {
        'X-Edge-Secret': 'forged', 'X-Forwarded-For': 'attacker',
        'X-Real-IP': 'attacker', Forwarded: 'for=attacker', 'CF-Connecting-IP': '203.0.113.9',
      },
    }), env())
    const forwarded = fetchMock.mock.calls[0][0]
    expect(forwarded.headers.get('X-Edge-Secret')).toBe('only-the-worker-knows-this')
    expect(forwarded.headers.get('X-Forwarded-For')).toBe('203.0.113.9')
    expect(forwarded.headers.has('X-Real-IP')).toBe(false)
    expect(forwarded.headers.has('Forwarded')).toBe(false)
  })

  it('does not forward a caller-provided edge credential when the Worker is unconfigured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const config = env()
    delete config.EDGE_SECRET
    await worker.fetch(new Request(`${publicOrigin}/health`, { headers: { 'X-Edge-Secret': 'forged' } }), config)
    expect(fetchMock.mock.calls[0][0].headers.has('X-Edge-Secret')).toBe(false)
  })

  it.each(['http://localhost:8000', 'not-a-url', 'https://name:pass@api.example.test', 'https://api.example.test/api'])('returns a safe response for malformed configuration %s', async (origin) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const response = await worker.fetch(new Request(`${publicOrigin}/health`), env(origin))
    expect(response.status).toBe(503)
    expect((await response.json()).reason).toBe('invalid-origin-configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not expose the tunnel hostname in failure diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Cannot reach secret-tunnel.trycloudflare.com'))
    const response = await worker.fetch(new Request(`${publicOrigin}/health`), env())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret-tunnel')
  })

  it('converts tunnel error HTML into the stable offline response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>tunnel down</html>', { status: 502 }))
    const response = await worker.fetch(new Request(`${publicOrigin}/health`), env())
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Edge-Status')).toBe('origin-offline')
    expect((await response.json()).reason).toBe('origin-unavailable')
  })

  it('preserves the WebSocket upgrade object for native clients', async () => {
    // Node cannot construct Cloudflare's 101 Response, but identity matters:
    // its webSocket attachment must survive without a response rebuild.
    const upgrade = { status: 101, webSocket: { accepted: true } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upgrade)
    const response = await worker.fetch(new Request(`${publicOrigin}/ws/volunteer`, { headers: { Origin: 'https://localhost' } }), env())
    expect(response).toBe(upgrade)
  })

  it('marks authenticated API responses uncacheable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ phone: 'private' }))
    const response = await worker.fetch(new Request(`${publicOrigin}/api/users/me`), env())
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
