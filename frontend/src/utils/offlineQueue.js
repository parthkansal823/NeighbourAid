/**
 * Offline alert queue backed by IndexedDB.
 *
 * When a reporter hits "Post Alert" while their connection is flaky or
 * fully offline (disaster-mode - tower overloaded or power is out), we
 * stash the payload in IDB and retry automatically when the browser
 * reports it's back online. The reporter gets immediate optimistic
 * feedback so they don't tap again and duplicate.
 *
 * Kept dependency-free on purpose - a `idb` wrapper would be nicer but
 * IDB in 40 lines is fine for one store.
 */

const DB_NAME = 'neighbouraid-offline'
const DB_VERSION = 1
const STORE = 'pending-alerts'

export const OFFLINE_QUEUE_EVENT = 'offline-queue:changed'

// After this many failed delivery attempts a queued alert is dropped, so a
// permanently-rejected payload can't block the queue behind it forever.
const MAX_ATTEMPTS = 10

let dbPromise = null
let flushPromise = null

function emitQueueEvent(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT, { detail }))
}

async function publishQueueState(detail = {}) {
  try {
    const remaining = (await listPending()).length
    emitQueueEvent({ ...detail, remaining })
    return remaining
  } catch {
    emitQueueEvent(detail)
    return null
  }
}

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode) {
  const db = await openDb()
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function enqueueAlert(payload) {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const req = store.add({
      payload,
      created_at: Date.now(),
      attempts: 0,
    })
    req.onsuccess = () => {
      resolve(req.result)
      void publishQueueState({ type: 'enqueued' })
    }
    req.onerror = () => reject(req.error)
  })
}

export async function listPending() {
  const store = await tx('readonly')
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function removePending(id) {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const req = store.delete(id)
    req.onsuccess = () => {
      resolve()
      void publishQueueState({ type: 'removed' })
    }
    req.onerror = () => reject(req.error)
  })
}

/** Increment a row's failure counter. Resolves with the new count (or 0 if
 *  the row is already gone) so callers can act on the fresh value rather
 *  than the stale one they read before the attempt. */
export async function bumpAttempts(id) {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const row = getReq.result
      if (!row) return resolve(0)
      row.attempts = (row.attempts ?? 0) + 1
      const putReq = store.put(row)
      putReq.onsuccess = () => resolve(row.attempts)
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Flush the queue by POSTing each pending alert. Caller supplies the
 * `postFn` (usually `api.post('/api/alerts/', payload)`). Returns
 * { sent, failed, remaining } counts so the UI can show progress.
 */
export async function flushQueue(postFn) {
  if (flushPromise) return flushPromise

  flushPromise = (async () => {
    const pending = await listPending()
    let sent = 0
    let failed = 0

    for (const row of pending) {
      try {
        await postFn(row.payload)
        await removePending(row.id)
        sent += 1
      } catch {
        failed += 1
        // Give up on irrecoverable rows so one bad payload cannot block the
        // entire queue forever. Count the attempt we just made — `row` was
        // read before the POST, so its `attempts` is one behind and would
        // buy every poison payload an extra retry.
        const attempts = await bumpAttempts(row.id)
        if (attempts >= MAX_ATTEMPTS) {
          await removePending(row.id).catch(() => {})
        }
      }
    }

    const remaining = await publishQueueState({
      type: 'flushed',
      sent,
      failed,
    })

    return {
      sent,
      failed,
      remaining: remaining ?? (await listPending()).length,
    }
  })().finally(() => {
    flushPromise = null
  })

  return flushPromise
}
