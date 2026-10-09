import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { AI_COMPOSE_FILE, COMPOSE_FILE, REPO_DIR, checkApi, composeCommand, extractTunnelOrigin, parseApiOrigin } from './server-tools.mjs'

test('normal and AI server commands select only their intended Compose files', () => {
  assert.deepEqual(composeCommand(['config', '--quiet'], false), ['compose', '--file', COMPOSE_FILE, 'config', '--quiet'])
  assert.deepEqual(composeCommand(['config', '--quiet'], true), ['compose', '--file', COMPOSE_FILE, '--file', AI_COMPOSE_FILE, 'config', '--quiet'])
})

test('AI Docker extension is opt-in, read-only and points only at local model files', () => {
  const normal = readFileSync(COMPOSE_FILE, 'utf8')
  const ai = readFileSync(AI_COMPOSE_FILE, 'utf8')
  const env = readFileSync(resolve(REPO_DIR, 'deploy/laptop/ai.env.example'), 'utf8')
  const dockerfile = readFileSync(resolve(REPO_DIR, 'backend/Dockerfile'), 'utf8')
  assert.doesNotMatch(normal, /ai\.env|target:\s*ai/)
  assert.match(ai, /target:\s*ai/)
  assert.match(ai, /path:\s*\.\/ai\.env\s*\n\s*required:\s*true/)
  assert.match(ai, /target:\s*\/models\s*\n\s*read_only:\s*true/)
  assert.match(env, /^LLM_MODEL_PATH=\/models\/gemma-/m)
  assert.match(env, /^LLM_VERIFIER_MODEL_PATH=\/models\/qwen2\.5-3b-/m)
  assert.match(dockerfile, /FROM base AS ai/)
  assert.match(dockerfile, /FROM base AS runtime/)
  assert.doesNotMatch(dockerfile, /curl|wget|huggingface/i)
})

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
