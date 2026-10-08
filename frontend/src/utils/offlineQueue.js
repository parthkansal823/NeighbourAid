/**
 * Offline alert queue backed by IndexedDB.
 *
 * When a reporter hits "Post Alert" while their connection is flaky or
 * fully offline (disaster-mode - tower overloaded or power is out), we
 * stash the payload in IDB and retry automatically when the browser
 * reports it's back online. The reporter gets immediate optimistic
 * feedback so they don't tap again and duplicate.
 *
 */

import { jwtDecode } from 'jwt-decode'
import { getAnonymousClientId, newSubmissionId } from './submissionIdentity'

const DB_NAME = 'neighbouraid-offline'
const DB_VERSION = 2
const STORE = 'pending-alerts'
const RECEIPTS = 'delivery-receipts'
const RECEIPT_TTL = 30 * 24 * 60 * 60 * 1000
const RECEIPT_LIMIT = 100

// The service worker registers for this tag so the browser can flush the
// queue with no tab open. Kept in one place because the worker reads the
// same constant by name -- if these ever drift, sync silently never fires.
export const SYNC_TAG = 'neighbouraid-alert-queue'

export const OFFLINE_QUEUE_EVENT = 'offline-queue:changed'

// Shared with the worker to serialize delivery across tabs/background sync.
export const QUEUE_LOCK = 'neighbouraid-alert-queue-flush'

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
      if (!db.objectStoreNames.contains(RECEIPTS)) db.createObjectStore(RECEIPTS, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = null }
      resolve(req.result)
    }
    req.onblocked = () => reject(new Error('Close older NeighbourAid tabs to upgrade saved reports'))
    req.onerror = () => reject(req.error)
  }).catch((error) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

// A request succeeding is not proof that its transaction committed. Only
// acknowledge saves/deletes after commit, so aborted writes cannot lose a report.
async function transaction(mode, run, stores = STORE) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Queue storage failed'))
    run(tx.objectStore(Array.isArray(stores) ? stores[0] : stores), (value) => { result = value })
  })
}

/** Read the current account without persisting a bearer token in the queue. */
export function getCurrentAccountId(token) {
  try {
    const { sub, exp } = jwtDecode(token ?? localStorage.getItem('token'))
    if (exp && exp * 1000 <= Date.now()) return null
    return typeof sub === 'string' && sub ? sub : null
  } catch {
    return null
  }
}

export function canDeliverQueuedAlert(row, accountId = getCurrentAccountId()) {
  return row.deliveryState !== 'needs_review' && canReadQueuedAlert(row, accountId)
}

export function canReadQueuedAlert(row, accountId = getCurrentAccountId()) {
  return row.anonymous === true || (
    typeof row.accountId === 'string' && !!row.accountId && row.accountId === accountId
  )
}

/**
 * Ask the browser to flush this queue once it has connectivity, even if
 * every tab is closed by then.
 *
 * Best-effort on purpose: Background Sync is Chromium-only, `registration
 * .sync` is absent in Safari and Firefox, and `register()` rejects when
 * the user has denied background activity for the site. None of that is
 * worth surfacing -- the tab-based flush in App.jsx is still there and
 * still works, so a failure here costs a reporter nothing beyond what
 * they had before.
 */
export async function requestBackgroundFlush() {
  try {
    if (typeof navigator === 'undefined') return false
    if (!('serviceWorker' in navigator)) return false
    const reg = await navigator.serviceWorker.ready
    if (!reg?.sync) return false
    await reg.sync.register(SYNC_TAG)
    return true
  } catch {
    return false
  }
}

/**
 * Queue an alert for delivery.
 *
 * `anonymous` records whether this row can be delivered without a bearer
 * token, which decides whether the service worker is allowed to send it:
 * the worker cannot read localStorage, so a signed-in row has to wait for
 * a tab. Defaulting it to false would strand the anonymous reporter the
 * feature exists for, and defaulting it to true would have the worker
 * post a signed-in report through the anonymous endpoint and strip its
 * author -- so the caller states it. `accountId` must come from the
 * submitting session, not a token read after a slow request has failed.
 * Legacy signed-in rows without an owner are retained, never assigned to whoever
 * happens to open the app next. Tokens are never written to IndexedDB.
 */
export async function enqueueAlert(payload, { anonymous, accountId, anonymousClientId, requestSync = true } = {}) {
  const owner = anonymous === true ? null : accountId
  const submissionId = payload.client_submission_id || newSubmissionId()
  const clientId = anonymous === true ? anonymousClientId || getAnonymousClientId() : null
  const id = await transaction('readwrite', (store, done) => {
    const req = store.add({
      payload: { ...payload, client_submission_id: submissionId },
      anonymousClientId: clientId,
      anonymous: anonymous === true,
      accountId: typeof owner === 'string' && owner ? owner : null,
      created_at: Date.now(),
      attempts: 0,
    })
    req.onsuccess = () => done(req.result)
  })
  await publishQueueState({ type: requestSync ? 'enqueued' : 'prepared' })
  // After the row is safely stored, never before.
  if (requestSync) void requestBackgroundFlush()
  return id
}

export async function listPending() {
  return transaction('readonly', (store, done) => {
    const req = store.getAll()
    req.onsuccess = () => done(req.result || [])
  })
}

export async function removePending(id) {
  await transaction('readwrite', (store) => {
    store.delete(id)
  })
  await publishQueueState({ type: 'removed' })
}

/** Receipt and queue deletion commit together. If storage aborts, the stable
 * submission identity remains queued and the server can safely replay it. */
export async function completeDelivery(id, response) {
  const data = response?.data || response
  if (typeof data?.id !== 'string' || !data.id) throw new Error('Server receipt is missing an alert ID')
  await transaction('readwrite', store => {
    const get = store.get(id)
    get.onsuccess = () => {
      const row = get.result
      if (!row) return
      store.transaction.objectStore(RECEIPTS).put({
        id: row.payload.client_submission_id,
        anonymous: row.anonymous === true,
        accountId: row.accountId,
        alertId: data.id,
        created_at: row.created_at,
        received_at: Date.now(),
        status: 'server_received',
      })
      store.delete(id)
    }
  }, [STORE, RECEIPTS])
  await pruneReceipts().catch(() => {})
  await publishQueueState({ type: 'received' })
}

async function pruneReceipts() {
  await transaction('readwrite', store => {
    const request = store.getAll()
    request.onsuccess = () => {
      const sorted = request.result.sort((a, b) => b.received_at - a.received_at)
      sorted.forEach((row, index) => {
        if (index >= RECEIPT_LIMIT || row.received_at < Date.now() - RECEIPT_TTL) store.delete(row.id)
      })
    }
  }, RECEIPTS)
}

export async function listReceipts(accountId = getCurrentAccountId()) {
  await pruneReceipts()
  return transaction('readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done(request.result
      .filter(row => row.anonymous === true || (accountId && row.accountId === accountId))
      .sort((a, b) => b.received_at - a.received_at))
  }, RECEIPTS)
}

/** Explicit cancellation waits for delivery's shared lock before deleting. */
export async function cancelPending(id) {
  const cancel = async () => {
    const rows = await listPending()
    const row = rows.find(item => item.id === id)
    if (!row || !canReadQueuedAlert(row)) return false
    await removePending(id)
    return true
  }
  return navigator.locks?.request ? navigator.locks.request(QUEUE_LOCK, cancel) : cancel()
}

export function needsDeliveryReview(error) {
  const status = error?.response?.status
  const code = error?.response?.data?.detail?.code || error?.response?.data?.code
  return [400, 403, 404, 413, 415, 422].includes(status) || (status === 409 && code !== 'SUBMISSION_PENDING')
}

export async function markPendingForReview(id) {
  await transaction('readwrite', store => {
    const request = store.get(id)
    request.onsuccess = () => {
      if (!request.result) return
      store.put({ ...request.result, deliveryState: 'needs_review' })
    }
  })
  await publishQueueState({ type: 'review_required' })
}

async function ensureSubmissionIdentity(row) {
  if (row.payload.client_submission_id && (row.anonymous !== true || row.anonymousClientId)) return row
  return transaction('readwrite', (store, done) => {
    const get = store.get(row.id)
    get.onsuccess = () => {
      const current = get.result
      if (!current) return done(null)
      current.payload = { ...current.payload, client_submission_id: current.payload.client_submission_id || newSubmissionId() }
      if (current.anonymous === true) current.anonymousClientId ||= getAnonymousClientId()
      store.put(current)
      done(current)
    }
  })
}

/** Increment a row's failure counter. Resolves with the new count (or 0 if
 *  the row is already gone) so callers can act on the fresh value rather
 *  than the stale one they read before the attempt. */
export async function bumpAttempts(id) {
  return transaction('readwrite', (store, done) => {
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const row = getReq.result
      if (!row) return done(0)
      row.attempts = (row.attempts ?? 0) + 1
      store.put(row)
      done(row.attempts)
    }
  })
}

/**
 * Flush the queue by POSTing each pending alert. Caller supplies the
 * `postFn(payload, { anonymous, accountId })`, which must route using that
 * metadata and pin any request credentials to that account. Returns
 * { sent, failed, blocked, remaining } counts so the UI can show progress.
 */
export async function flushQueue(postFn) {
  if (flushPromise) return flushPromise

  const flush = async () => {
    const pending = await listPending()
    let sent = 0
    let failed = 0
    let blocked = 0

    for (let row of pending) {
      // Re-read the session for every row: logout/account switch may occur
      // during the preceding request. Unknown legacy owners are never inferred.
      if (!canDeliverQueuedAlert(row)) {
        blocked += 1
        continue
      }
      try {
        row = await ensureSubmissionIdentity(row)
        if (!row) continue
        const result = await postFn(row.payload, {
          anonymous: row.anonymous === true,
          accountId: row.accountId ?? null,
          anonymousClientId: row.anonymousClientId ?? null,
        })
        await completeDelivery(row.id, result)
        sent += 1
      } catch (error) {
        failed += 1
        // Even 4xx can be temporary (401/408/429). Retain rejected reports too:
        // without a review/edit flow, silently deleting emergency reports is unsafe.
        await bumpAttempts(row.id)
        if (needsDeliveryReview(error)) await markPendingForReview(row.id)
      }
    }

    const remaining = await publishQueueState({
      type: 'flushed',
      sent,
      failed,
      blocked,
    })

    return {
      sent,
      failed,
      blocked,
      remaining: remaining ?? (await listPending()).length,
    }
  }

  const locks = typeof navigator !== 'undefined' ? navigator.locks : null
  flushPromise = (locks?.request
    ? locks.request(QUEUE_LOCK, flush)
    : flush()
  ).finally(() => {
    flushPromise = null
  })

  return flushPromise
}
