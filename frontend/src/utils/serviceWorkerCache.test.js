import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/service-worker.js', 'utf8')
const ORIGIN = 'https://neighbouraid.test'
const SHELL = 'neighbouraid-shell-v4'
const ASSETS = 'neighbouraid-assets-v4'
const FIVE_MIB = 5 * 1024 * 1024

// The worker is evaluated unmodified. These small browser doubles deliberately
// have no network and can represent large responses without allocating 5 MiB.
class MockResponse {
  constructor(body = '', { status = 200, headers = {}, type = 'basic', size = body.length } = {}) {
    this.body = body
    this.status = status
    this.headers = new Headers(headers)
    this.type = type
    this.size = size
    this.ok = status >= 200 && status < 300
  }
  clone() { return new MockResponse(this.body, this) }
  async blob() { return { size: this.size } }
  async text() { return this.body }
  async json() { return JSON.parse(this.body) }
}

function worker({ indexedDB } = {}) {
  const handlers = {}
  const stores = new Map()
  const keyFor = key => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
  const caches = {
    open: vi.fn(async name => {
      if (!stores.has(name)) stores.set(name, new Map())
      const rows = stores.get(name)
      return {
        match: vi.fn(async key => rows.get(keyFor(key))?.clone()),
        put: vi.fn(async (key, response) => { rows.set(keyFor(key), response.clone()) }),
        keys: vi.fn(async () => [...rows.keys()].map(url => ({ url }))),
        delete: vi.fn(async key => rows.delete(keyFor(key))),
      }
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async name => stores.delete(name)),
  }
  const fetch = vi.fn(async () => new MockResponse('network'))
  const skipWaiting = vi.fn(async () => {})
  const claim = vi.fn(async () => {})
  runInNewContext(source, {
    URL, Headers, Response: MockResponse, caches, fetch, indexedDB,
    self: {
      location: { origin: ORIGIN },
      addEventListener: (name, handler) => { handlers[name] = handler },
      skipWaiting,
      clients: { claim, matchAll: vi.fn(async () => []) },
    },
  })
  async function dispatch(name, event = {}) {
    const pending = []
    let response
    let intercepted = false
    handlers[name]({ ...event,
      waitUntil: promise => { pending.push(promise) },
      respondWith: promise => { intercepted = true; response = Promise.resolve(promise) },
    })
    const resolved = await response
    await Promise.all(pending)
    return { response: resolved, intercepted }
  }
  const request = (path, overrides = {}) => ({
    url: new URL(path, ORIGIN).href,
    method: 'GET', mode: 'cors', cache: 'default', headers: new Headers(),
    ...overrides,
  })
  return { stores, caches, fetch, claim, skipWaiting, dispatch, request,
    fetchEvent: (path, overrides) => dispatch('fetch', { request: request(path, overrides) }),
  }
}

describe('service worker cache privacy boundaries', () => {
  it.each(['/api/alerts/', '/api/users/me', '/ws', '/ws/alerts', 'https://tiles.example.test/map.png'])('does not intercept or cache %s', async path => {
    const sw = worker()
    expect((await sw.fetchEvent(path, { mode: 'navigate' })).intercepted).toBe(false)
    expect(sw.fetch).not.toHaveBeenCalled()
    expect(sw.caches.open).not.toHaveBeenCalled()
  })

  it('does not intercept authenticated GETs or mutating requests', async () => {
    const sw = worker()
    const headers = new Headers({ Authorization: 'Bearer test-only' })
    expect((await sw.fetchEvent('/assets/private.js', { headers })).intercepted).toBe(false)
    expect((await sw.fetchEvent('/assets/file.js', { method: 'POST' })).intercepted).toBe(false)
    expect(sw.caches.open).not.toHaveBeenCalled()
  })

  it.each([
    { cache: 'no-store' },
    { headers: new Headers({ 'Cache-Control': 'no-store' }) },
  ])('bypasses persistent cache for explicitly no-store requests: %s', async options => {
    const sw = worker()
    await (await sw.caches.open(ASSETS)).put('/assets/app.js', new MockResponse('older'))
    sw.caches.open.mockClear()
    expect((await sw.fetchEvent('/assets/app.js', options)).intercepted).toBe(false)
    expect(sw.caches.open).not.toHaveBeenCalled()
  })

  it.each([404, 500, 503])('returns HTTP %s asset response without storing it', async status => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('error', { status }))
    expect((await sw.fetchEvent('/assets/app.js')).response.status).toBe(status)
    expect(sw.stores.get(ASSETS).size).toBe(0)
  })

  it.each(['no-store', 'private, No-Store'])('rejects asset responses with Cache-Control: %s', async directive => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('private', { headers: { 'Cache-Control': directive } }))
    expect((await sw.fetchEvent('/assets/app.js')).response.body).toBe('private')
    expect(sw.stores.get(ASSETS).size).toBe(0)
  })

  it('never saves opaque responses', async () => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('opaque', { type: 'opaque' }))
    await sw.fetchEvent('/assets/app.js')
    expect(sw.stores.get(ASSETS).size).toBe(0)
  })

  it('serves successfully cached assets offline without a network call', async () => {
    const sw = worker()
    await sw.fetchEvent('/assets/app.js')
    sw.fetch.mockRejectedValue(new Error('offline'))
    expect((await sw.fetchEvent('/assets/app.js')).response.body).toBe('network')
    expect(sw.fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds the asset cache to 80 entries, retaining the newest assets', async () => {
    const sw = worker()
    for (let index = 0; index < 83; index += 1) await sw.fetchEvent(`/assets/${index}.js`)
    const rows = sw.stores.get(ASSETS)
    expect(rows.size).toBe(80)
    expect(rows.has(`${ORIGIN}/assets/0.js`)).toBe(false)
    expect(rows.has(`${ORIGIN}/assets/2.js`)).toBe(false)
    expect(rows.has(`${ORIGIN}/assets/82.js`)).toBe(true)
  })

  it('accepts exactly 5 MiB but rejects assets over the size bound', async () => {
    const sw = worker()
    sw.fetch.mockResolvedValueOnce(new MockResponse('at limit', { size: FIVE_MIB }))
      .mockResolvedValueOnce(new MockResponse('over limit', { size: FIVE_MIB + 1 }))
    await sw.fetchEvent('/assets/boundary.js')
    await sw.fetchEvent('/assets/oversized.js')
    expect([...sw.stores.get(ASSETS).keys()]).toEqual([`${ORIGIN}/assets/boundary.js`])
  })
})

// Separate in-memory databases make queue tests independent of the page queue
// module and its global cached connection. All assertions await transaction
// completion, not merely a request success callback.
async function withQueuedWorker(overrides, run) {
  const indexedDB = new IDBFactory()
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('neighbouraid-offline', 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('pending-alerts', { keyPath: 'id', autoIncrement: true })
      request.result.createObjectStore('delivery-receipts', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const row = {
      id: 1, anonymous: true, accountId: null, attempts: 0, created_at: Date.now(),
      anonymousClientId: '22111111-1111-4111-8111-111111111111',
      payload: { description: 'Need assistance', client_submission_id: '33111111-1111-4111-8111-111111111111' },
      ...overrides,
    }
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('pending-alerts', 'readwrite')
      transaction.objectStore('pending-alerts').put(row)
      transaction.oncomplete = resolve
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
    const rows = (name = 'pending-alerts') => new Promise((resolve, reject) => {
      const transaction = db.transaction(name, 'readonly')
      const request = transaction.objectStore(name).getAll()
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
    await run(worker({ indexedDB }), rows, row)
  } finally { db.close() }
}

describe('service worker durable queue review states', () => {
  const sync = sw => sw.dispatch('sync', { tag: 'neighbouraid-alert-queue' })

  it('never sends a report paused for review', async () => {
    await withQueuedWorker({ deliveryState: 'needs_review', attempts: 2 }, async (sw, rows) => {
      await sync(sw)
      expect(sw.fetch).not.toHaveBeenCalled()
      expect(await rows()).toMatchObject([{ deliveryState: 'needs_review', attempts: 2 }])
      expect(await rows('delivery-receipts')).toEqual([])
    })
  })

  it('persists a terminal HTTP400 rejection and pauses subsequent retries', async () => {
    await withQueuedWorker({}, async (sw, rows) => {
      sw.fetch.mockResolvedValue(new MockResponse('{"detail":"Invalid report"}', { status: 400 }))
      await expect(sync(sw)).rejects.toThrow('still need delivery')
      expect(await rows()).toMatchObject([{ deliveryState: 'needs_review', attempts: 1 }])
      expect(await rows('delivery-receipts')).toEqual([])
      await sync(sw)
      expect(sw.fetch).toHaveBeenCalledOnce()
      expect(await rows()).toMatchObject([{ deliveryState: 'needs_review', attempts: 1 }])
    })
  })

  it('keeps SUBMISSION_PENDING retryable and later commits its server receipt', async () => {
    await withQueuedWorker({}, async (sw, rows, original) => {
      sw.fetch.mockResolvedValueOnce(new MockResponse('{"detail":{"code":"SUBMISSION_PENDING"}}', { status: 409 }))
        .mockResolvedValueOnce(new MockResponse('{"id":"received-alert"}'))
      await expect(sync(sw)).rejects.toThrow('still need delivery')
      const [pending] = await rows()
      expect(pending.attempts).toBe(1)
      expect(pending.deliveryState).not.toBe('needs_review')
      expect(await rows('delivery-receipts')).toEqual([])
      await sync(sw)
      expect(await rows()).toEqual([])
      expect(await rows('delivery-receipts')).toMatchObject([{
        id: original.payload.client_submission_id,
        anonymous: true, accountId: null, alertId: 'received-alert', status: 'server_received',
      }])
      expect(sw.fetch).toHaveBeenCalledTimes(2)
      const attempts = sw.fetch.mock.calls.map(([_url, options]) => options)
      expect(attempts[0].body).toBe(attempts[1].body)
      expect(attempts[1].headers['X-Anonymous-Client-ID']).toBe(original.anonymousClientId)
    })
  })
})

describe('service worker shell and approved update lifecycle', () => {
  it('installs the shell without forcing an update and serves an installed icon offline', async () => {
    const sw = worker()
    await sw.dispatch('install')
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    expect(sw.stores.get(SHELL).has(`${ORIGIN}/index.html`)).toBe(true)
    sw.fetch.mockRejectedValue(new Error('offline'))
    expect((await sw.fetchEvent('/icon-192.png')).response.body).toBe('network')
    expect(sw.fetch).toHaveBeenCalledTimes(10)
  })

  it('tolerates an unavailable install asset without storing its error response', async () => {
    const sw = worker()
    sw.fetch.mockImplementation(async path => {
      if (path === '/favicon-32.png') throw new Error('offline')
      return new MockResponse('install', { status: path === '/brand-logo.png' ? 404 : 200 })
    })
    await sw.dispatch('install')
    const rows = sw.stores.get(SHELL)
    expect(rows.has(`${ORIGIN}/index.html`)).toBe(true)
    expect(rows.has(`${ORIGIN}/favicon-32.png`)).toBe(false)
    expect(rows.has(`${ORIGIN}/brand-logo.png`)).toBe(false)
  })

  it('does not precache no-store install responses', async () => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('private', { headers: { 'Cache-Control': 'No-Store' } }))
    await sw.dispatch('install')
    expect(sw.stores.get(SHELL).size).toBe(0)
  })

  it('cleans only obsolete app shell/asset/brand caches during activation', async () => {
    const sw = worker()
    for (const name of [SHELL, ASSETS, 'neighbouraid-shell-v1', 'neighbouraid-assets-v2', 'neighbouraid-brand-v3', 'other-app-v1', 'neighbouraid-offline-data']) {
      await sw.caches.open(name)
    }
    await sw.dispatch('activate')
    expect([...sw.stores.keys()].sort()).toEqual([SHELL, ASSETS, 'other-app-v1', 'neighbouraid-offline-data'].sort())
    expect(sw.claim).toHaveBeenCalledOnce()
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })

  it('skips waiting only after the explicit approved update message', async () => {
    const sw = worker()
    await sw.dispatch('message', { data: { type: 'UNRELATED' } })
    await sw.dispatch('message', { data: null })
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } })
    expect(sw.skipWaiting).toHaveBeenCalledOnce()
  })

  it.each(['offline', 503])('falls back to the cached shell when navigation fails: %s', async failure => {
    const sw = worker()
    await (await sw.caches.open(SHELL)).put('/index.html', new MockResponse('saved shell'))
    if (failure === 'offline') sw.fetch.mockRejectedValue(new Error('offline'))
    else sw.fetch.mockResolvedValue(new MockResponse('server error', { status: failure }))
    expect((await sw.fetchEvent('/post-alert', { mode: 'navigate' })).response.body).toBe('saved shell')
  })

  it('returns a controlled offline response when no shell has been cached', async () => {
    const sw = worker()
    sw.fetch.mockRejectedValue(new Error('offline'))
    const { response } = await sw.fetchEvent('/post-alert', { mode: 'navigate' })
    expect(response).toBeInstanceOf(MockResponse)
    expect(response.status).toBe(503)
    expect(await response.text()).toMatch(/offline/i)
  })

  it('stores successful HTML navigation responses as the offline shell', async () => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('new shell', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    await sw.fetchEvent('/help', { mode: 'navigate' })
    expect(sw.stores.get(SHELL).get(`${ORIGIN}/index.html`).body).toBe('new shell')
  })

  it.each(['no-store', 'private, No-Store'])('does not save no-store HTML navigation: %s', async directive => {
    const sw = worker()
    sw.fetch.mockResolvedValue(new MockResponse('private page', { headers: { 'Content-Type': 'text/html', 'Cache-Control': directive } }))
    await sw.fetchEvent('/help', { mode: 'navigate' })
    expect(sw.stores.get(SHELL)?.size || 0).toBe(0)
  })

  it('never replaces the shell with a JSON or HTTP error navigation response', async () => {
    const sw = worker()
    await (await sw.caches.open(SHELL)).put('/index.html', new MockResponse('saved shell'))
    sw.fetch.mockResolvedValueOnce(new MockResponse('{}', { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new MockResponse('not found', { status: 404, headers: { 'Content-Type': 'text/html' } }))
    await sw.fetchEvent('/help', { mode: 'navigate' })
    await sw.fetchEvent('/missing', { mode: 'navigate' })
    expect(sw.stores.get(SHELL).get(`${ORIGIN}/index.html`).body).toBe('saved shell')
  })
})
