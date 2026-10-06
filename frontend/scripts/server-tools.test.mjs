import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkApi, extractTunnelOrigin, parseApiOrigin } from './server-tools.mjs'

test('accepts a real HTTPS origin and normalises its trailing slash', () => {
  assert.equal(parseApiOrigin('https://winter-flower-1234.trycloudflare.com/'), 'https://winter-flower-1234.trycloudflare.com')
})

test('rejects the copied example and destinations with credentials or extra URL parts', () => {
  for (const url of [
    'https://example.trycloudflare.com', 'https://example.com', 'http://real.trycloudflare.com',
    'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://name:password@real.trycloudflare.com', 'https://real.trycloudflare.com/api',
    'https://real.trycloudflare.com?key=a', 'https://real.trycloudflare.com#fragment', 'not a URL',
  ]) assert.throws(() => parseApiOrigin(url))
})

test('extracts only a generated tunnel HTTPS hostname from container logs', () => {
  assert.equal(extractTunnelOrigin('Read https://developers.cloudflare.com/ then tunnel: https://forest-river-11.trycloudflare.com |'), 'https://forest-river-11.trycloudflare.com')
  assert.equal(extractTunnelOrigin('https://unrelated.example.net'), null)
})

test('checks health without sending a credential to a manual destination', async () => {
  let options
  await checkApi('https://api.demo.net', { fetchImpl: async (url, config) => {
    assert.equal(url, 'https://api.demo.net/health')
    options = config
    return Response.json({ status: 'ok' })
  } })
  assert.deepEqual(options.headers, {})
  assert.equal(options.redirect, 'error')
})

test('rejects unreachable or unhealthy backends before routing is changed', async () => {
  await assert.rejects(checkApi('https://api.demo.net', { fetchImpl: async () => new Response('offline', { status: 503 }) }))
  await assert.rejects(checkApi('https://api.demo.net', { fetchImpl: async () => Response.json({ status: 'degraded' }) }))
})

test('Docker readiness requires MongoDB and carries the edge credential', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://forest-river-11.trycloudflare.com/health/ready')
    assert.equal(options.headers['X-Edge-Secret'], 'test-secret')
    return Response.json({ status: 'ok', database: 'ok' })
  }
  await checkApi('https://forest-river-11.trycloudflare.com', { secret: 'test-secret', ready: true, fetchImpl })
  await assert.rejects(checkApi('https://api.demo.net', { ready: true, fetchImpl: async () => Response.json({ status: 'ok' }) }))
})
