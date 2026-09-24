import { afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  bumpAttempts,
  enqueueAlert,
  flushQueue,
  listPending,
  removePending,
  requestBackgroundFlush,
  SYNC_TAG,
} from './offlineQueue'

afterEach(async () => {
  // Reset the IDB between tests so leftover rows don't pollute the next run
  const pending = await listPending()
  for (const row of pending) await removePending(row.id)
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
    await enqueueAlert({ description: 'a' })
    await enqueueAlert({ description: 'b' })
    const post = vi.fn(async () => ({ ok: true }))
    const result = await flushQueue(post)
    expect(post).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(await listPending()).toHaveLength(0)
  })

  it('flushQueue retries failures by leaving the row in place and bumping attempts', async () => {
    await enqueueAlert({ description: 'fails' })
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

  it('flushQueue drops a row that has failed >= 10 times to avoid a stuck queue', async () => {
    await enqueueAlert({ description: 'poison' })
    const [row] = await listPending()
    // Pre-bump to 10 attempts
    for (let i = 0; i < 10; i += 1) await bumpAttempts(row.id)
    const post = vi.fn(async () => {
      throw new Error('still broken')
    })
    await flushQueue(post)
    expect(await listPending()).toHaveLength(0)
  })

  it('flushQueue reuses the in-flight flush so concurrent callers do not double-post', async () => {
    await enqueueAlert({ description: 'one' })

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
