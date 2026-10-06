import { afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {
  bumpAttempts,
  enqueueAlert,
  flushQueue,
  listPending,
  removePending,
  requestBackgroundFlush,
  QUEUE_LOCK,
  SYNC_TAG,
} from './offlineQueue'

function signIn(accountId, exp = Math.floor(Date.now() / 1000) + 3600) {
  const token = `header.${btoa(JSON.stringify({ sub: accountId, exp }))}.signature`
  localStorage.setItem('token', token)
  return token
}

afterEach(async () => {
  // Reset the IDB between tests so leftover rows don't pollute the next run
  const pending = await listPending()
  for (const row of pending) await removePending(row.id)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('offlineQueue', () => {
  it('enqueues a payload and lists it back', async () => {
    const payload = { description: 'help', category: 'medical' }
    await enqueueAlert(payload)
    const pending = await listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload).toEqual(payload)
    expect(pending[0].attempts).toBe(0)
  })

  it('removePending deletes an entry by id', async () => {
    await enqueueAlert({ description: 'one' })
    const before = await listPending()
    await removePending(before[0].id)
    expect(await listPending()).toHaveLength(0)
  })

  it('bumpAttempts increments the per-row counter', async () => {
    await enqueueAlert({ description: 'x' })
    const [row] = await listPending()
    await bumpAttempts(row.id)
    await bumpAttempts(row.id)
    const [updated] = await listPending()
    expect(updated.attempts).toBe(2)
  })

  it('flushQueue posts each pending alert and removes them on success', async () => {
    await enqueueAlert({ description: 'a' }, { anonymous: true })
    await enqueueAlert({ description: 'b' }, { anonymous: true })
    const post = vi.fn(async () => ({ ok: true }))
    const result = await flushQueue(post)
    expect(post).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(await listPending()).toHaveLength(0)
  })

  it('flushQueue retries failures by leaving the row in place and bumping attempts', async () => {
    await enqueueAlert({ description: 'fails' }, { anonymous: true })
    const post = vi.fn(async () => {
      throw new Error('network')
    })
    const result = await flushQueue(post)
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)
    const remaining = await listPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].attempts).toBe(1)
  })

  it.each([undefined, 401, 403, 408, 422, 429, 500, 503])(
    'retains reports after repeated delivery failure (HTTP %s)', async (status) => {
    await enqueueAlert({ description: 'keep me' }, { anonymous: true })
    const [row] = await listPending()
    for (let i = 0; i < 10; i += 1) await bumpAttempts(row.id)
    const post = vi.fn().mockRejectedValue({ response: status ? { status } : undefined })
    const result = await flushQueue(post)
    expect(result).toMatchObject({ failed: 1, remaining: 1 })
    expect(await listPending()).toEqual([expect.objectContaining({ id: row.id, attempts: 11 })])
  })

  it('flushQueue reuses the in-flight flush so concurrent callers do not double-post', async () => {
    await enqueueAlert({ description: 'one' }, { anonymous: true })

    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const post = vi.fn(async () => {
      await gate
      return { ok: true }
    })

    const first = flushQueue(post)
    const second = flushQueue(post)

    release()
    const [a, b] = await Promise.all([first, second])

    expect(post).toHaveBeenCalledTimes(1)
    expect(a).toStrictEqual(b)
    expect(a.sent).toBe(1)
    expect(await listPending()).toHaveLength(0)
  })

  it('passes per-report identity metadata even when anonymous and signed-in reports are mixed', async () => {
    const token = signIn('alice')
    await enqueueAlert({ description: 'anonymous' }, { anonymous: true })
    await enqueueAlert({ description: 'attributed' }, { anonymous: false, accountId: 'alice' })
    const pending = await listPending()
    expect(pending[1].accountId).toBe('alice')
    expect(JSON.stringify(pending)).not.toContain(token)
    const post = vi.fn().mockResolvedValue({})
    await flushQueue(post)
    expect(post).toHaveBeenNthCalledWith(1, { description: 'anonymous' }, { anonymous: true, accountId: null })
    expect(post).toHaveBeenNthCalledWith(2, { description: 'attributed' }, { anonymous: false, accountId: 'alice' })
  })

  it.each(['signed out', 'another account', 'expired token'])(
    'blocks an attributed report with %s and delivers it when the original account returns', async (session) => {
    signIn('alice')
    await enqueueAlert({ description: 'alice report' }, { accountId: 'alice' })
    if (session === 'signed out') localStorage.removeItem('token')
    else signIn(session === 'another account' ? 'bob' : 'alice', session === 'expired token' ? 1 : undefined)
    const post = vi.fn().mockResolvedValue({})
    expect(await flushQueue(post)).toMatchObject({ sent: 0, failed: 0, blocked: 1, remaining: 1 })
    expect(post).not.toHaveBeenCalled()
    expect((await listPending())[0].attempts).toBe(0)
    signIn('alice')
    expect(await flushQueue(post)).toMatchObject({ sent: 1, remaining: 0 })
  })

  it('never adopts legacy/unknown owners into the current account or blocks anonymous rows behind them', async () => {
    await enqueueAlert({ description: 'unknown owner' })
    await enqueueAlert({ description: 'public report' }, { anonymous: true })
    signIn('alice')
    const post = vi.fn().mockResolvedValue({})
    expect(await flushQueue(post)).toMatchObject({ sent: 1, blocked: 1, remaining: 1 })
    expect(post).toHaveBeenCalledOnce()
    expect((await listPending())[0].payload.description).toBe('unknown owner')
  })

  it('checks the session again between requests when accounts change during a flush', async () => {
    signIn('alice')
    await enqueueAlert({ description: 'first' }, { accountId: 'alice' })
    await enqueueAlert({ description: 'second' }, { accountId: 'alice' })
    const post = vi.fn(async () => { signIn('bob') })
    expect(await flushQueue(post)).toMatchObject({ sent: 1, blocked: 1, remaining: 1 })
    expect(post).toHaveBeenCalledOnce()
    expect((await listPending())[0].accountId).toBe('alice')
  })

  it('honors the submitting account supplied by a caller after a session switch', async () => {
    signIn('bob')
    await enqueueAlert({ description: 'started as alice' }, { accountId: 'alice' })
    const post = vi.fn()
    expect(await flushQueue(post)).toMatchObject({ blocked: 1, remaining: 1 })
    expect(post).not.toHaveBeenCalled()
  })

  it('does not infer an unknown submitting account from a token read after a failed request', async () => {
    signIn('bob')
    await enqueueAlert({ description: 'submission started before account switch' }, { anonymous: false })
    const post = vi.fn()
    expect(await flushQueue(post)).toMatchObject({ blocked: 1, remaining: 1 })
    expect(post).not.toHaveBeenCalled()
    expect((await listPending())[0].accountId).toBeNull()
  })

  it('keeps a rejected row while successfully delivering later rows', async () => {
    await enqueueAlert({ description: 'rejected' }, { anonymous: true })
    await enqueueAlert({ description: 'valid' }, { anonymous: true })
    const post = vi.fn().mockRejectedValueOnce({ response: { status: 422 } }).mockResolvedValueOnce({})
    expect(await flushQueue(post)).toMatchObject({ sent: 1, failed: 1, remaining: 1 })
    expect((await listPending())[0].payload.description).toBe('rejected')
  })

  it('does not acknowledge an enqueue when its successful request is later rolled back', async () => {
    const add = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(function (...args) {
      const req = add.apply(this, args)
      req.addEventListener('success', () => this.transaction.abort())
      return req
    })
    await expect(enqueueAlert({ description: 'aborted' }, { anonymous: true })).rejects.toThrow()
    expect(await listPending()).toHaveLength(0)
  })

  it('keeps a row and does not count it sent when the deletion transaction rolls back', async () => {
    await enqueueAlert({ description: 'retained' }, { anonymous: true })
    const drop = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (...args) {
      const req = drop.apply(this, args)
      req.addEventListener('success', () => this.transaction.abort())
      return req
    })
    expect(await flushQueue(vi.fn().mockResolvedValue({}))).toMatchObject({ sent: 0, failed: 1, remaining: 1 })
    expect((await listPending())[0].payload.description).toBe('retained')
  })

  it('uses the worker-compatible Web Lock when available', async () => {
    const request = vi.fn(async (_name, run) => run())
    vi.stubGlobal('navigator', { locks: { request } })
    await enqueueAlert({ description: 'locked' }, { anonymous: true })
    await flushQueue(vi.fn().mockResolvedValue({}))
    expect(request).toHaveBeenCalledWith(QUEUE_LOCK, expect.any(Function))
  })
})

describe('background sync', () => {
  it('defaults a row to non-anonymous so the worker leaves it alone', async () => {
    // The worker can't read a bearer token, so an untagged row must never
    // be assumed safe to send through the anonymous endpoint.
    await enqueueAlert({ description: 'signed in' })
    const [row] = await listPending()
    expect(row.anonymous).toBe(false)
  })

  it('records an anonymous row so the worker can deliver it', async () => {
    await enqueueAlert({ description: 'no account' }, { anonymous: true })
    const [row] = await listPending()
    expect(row.anonymous).toBe(true)
  })

  it('asks the browser for a background flush once the row is stored', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      serviceWorker: { ready: Promise.resolve({ sync: { register } }) },
    })

    await enqueueAlert({ description: 'queued' }, { anonymous: true })
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith(SYNC_TAG))

    vi.unstubAllGlobals()
  })

  it('still queues the alert where Background Sync is unsupported', async () => {
    // Safari and Firefox expose no registration.sync at all. Reading
    // `.register` off undefined would throw inside enqueue and lose the
    // alert the reporter just wrote.
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      serviceWorker: { ready: Promise.resolve({}) },
    })

    await expect(
      enqueueAlert({ description: 'safari' }, { anonymous: true })
    ).resolves.toBeDefined()
    expect(await listPending()).toHaveLength(1)

    vi.unstubAllGlobals()
  })

  it('survives a serviceWorker.ready that rejects', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      serviceWorker: { ready: Promise.reject(new Error('no SW')) },
    })

    // Called directly rather than through enqueueAlert: enqueue fires this
    // without awaiting it, so the assertion could unstub the global before
    // the rejection was caught and Node would report it as unhandled.
    await expect(requestBackgroundFlush()).resolves.toBe(false)

    await expect(
      enqueueAlert({ description: 'rejected' }, { anonymous: true })
    ).resolves.toBeDefined()
    expect(await listPending()).toHaveLength(1)

    vi.unstubAllGlobals()
  })
})

describe('service worker delivery', () => {
  const source = readFileSync('public/service-worker.js', 'utf8')
  function worker(fetch, clients = [], request) {
    const handlers = {}
    runInNewContext(source, {
      indexedDB,
      fetch,
      self: {
        addEventListener: (name, handler) => { handlers[name] = handler },
        clients: { matchAll: async () => clients },
        navigator: { locks: request ? { request } : undefined },
      },
    })
    return () => {
      let completion
      handlers.sync({ tag: SYNC_TAG, waitUntil: (promise) => { completion = promise } })
      return completion
    }
  }

  it.each([401, 403, 408, 422, 429, 500, 503])('retains HTTP %s failures and delivers later anonymous rows', async (status) => {
    await enqueueAlert({ description: 'rejected' }, { anonymous: true })
    await enqueueAlert({ description: 'valid' }, { anonymous: true })
    await enqueueAlert({ description: 'signed-in' }, { accountId: 'alice' })
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status }).mockResolvedValueOnce({ ok: true })
    await expect(worker(fetch)()).rejects.toThrow('still need delivery')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await listPending()).map((row) => row.payload.description)).toEqual(['rejected', 'signed-in'])
  })

  it('retains rows when fetch throws, then sends on a later background sync', async () => {
    await enqueueAlert({ description: 'offline' }, { anonymous: true })
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true })
    const sync = worker(fetch)
    await expect(sync()).rejects.toThrow()
    expect(await listPending()).toHaveLength(1)
    await sync()
    expect(await listPending()).toHaveLength(0)
  })

  it('stands down for hidden tabs too and shares the page delivery lock', async () => {
    await enqueueAlert({ description: 'in tab' }, { anonymous: true })
    const fetch = vi.fn()
    const request = vi.fn(async (_name, run) => run())
    await worker(fetch, [{ visibilityState: 'hidden' }], request)()
    expect(fetch).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(QUEUE_LOCK, expect.any(Function))
    expect(await listPending()).toHaveLength(1)
  })

  it('serializes background sync with a page that opens during delivery', async () => {
    let tail = Promise.resolve()
    const request = vi.fn((_name, run) => {
      const next = tail.then(run)
      tail = next.catch(() => {})
      return next
    })
    vi.stubGlobal('navigator', { locks: { request } })
    await enqueueAlert({ description: 'once' }, { anonymous: true })
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const post = vi.fn(async () => gate)
    const page = flushQueue(post)
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce())
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const background = worker(fetch, [], request)()
    release()
    await Promise.all([page, background])
    expect(post).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(await listPending()).toHaveLength(0)
  })

  it('keeps a report when the worker deletion fails to commit', async () => {
    await enqueueAlert({ description: 'retained' }, { anonymous: true })
    const drop = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (...args) {
      const req = drop.apply(this, args)
      req.addEventListener('success', () => this.transaction.abort())
      return req
    })
    await expect(worker(vi.fn().mockResolvedValue({ ok: true }))()).rejects.toThrow()
    expect(await listPending()).toHaveLength(1)
  })
})
