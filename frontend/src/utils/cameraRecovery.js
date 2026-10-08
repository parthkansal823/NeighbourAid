import { newSubmissionId } from './submissionIdentity'
import { hasNativeCamera, validateNativePhoto } from './nativeCamera'

export const CAMERA_RECOVERY_EVENT = 'camera-recovery:changed'
export const CAMERA_RECOVERY_TTL = 24 * 60 * 60 * 1000
const DB_NAME = 'neighbouraid-camera-recovery'
const STORE = 'session'
const SLOT = 'current'
const CATEGORIES = new Set(['medical', 'fire', 'flood', 'accident', 'missing', 'violence', 'animal', 'gas', 'power', 'water', 'structure', 'other'])
let dbPromise

function failure(code, message) { return Object.assign(new Error(message), { code }) }
function ownerId(value) {
  if (value == null) return null
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,200}$/.test(value)) throw failure('CAMERA_RECOVERY_INVALID', 'The reporting account is invalid.')
  return value
}
function boundedText(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw failure('CAMERA_RECOVERY_INVALID', `${label} cannot be safely saved.`)
  return value
}
function safeDraft(value) {
  const form = value?.form
  const coordinates = form?.location?.coordinates
  if (!form || !CATEGORIES.has(form.category) || !Array.isArray(coordinates) || coordinates.length !== 2 ||
      !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) {
    throw failure('CAMERA_RECOVERY_INVALID', 'The camera draft has an invalid category or location.')
  }
  const photos = value.photos ?? []
  if (!Array.isArray(photos) || photos.length > 3 || photos.some(photo =>
    typeof photo !== 'string' || photo.length > 300000 || !/^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/.test(photo))) {
    throw failure('CAMERA_RECOVERY_INVALID', 'The camera draft has invalid or oversized photos.')
  }
  // Explicit allowlist: no tokens, account objects, submission IDs or EXIF.
  return {
    form: { category: form.category, description: boundedText(form.description, 2000, 'The report'), location: { type: 'Point', coordinates: [...coordinates] } },
    photos: [...photos], locationSet: value.locationSet === true,
    address: boundedText(value.address ?? '', 1000, 'The address'), isDrill: value.isDrill === true,
  }
}
function alive(row, now = Date.now()) {
  return row && typeof row.id === 'string' && Number.isFinite(row.createdAt) && row.createdAt <= now + 60000 &&
    row.expiresAt === row.createdAt + CAMERA_RECOVERY_TTL && row.expiresAt > now
}
function publicRow(row) {
  return {
    id: row.id, accountId: ownerId(row.accountId), createdAt: row.createdAt, expiresAt: row.expiresAt,
    draft: safeDraft(row.draft), photo: row.photo ? validateNativePhoto(row.photo) : null,
    status: row.status, restored: row.restored === true,
  }
}
function emit(id, type) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CAMERA_RECOVERY_EVENT, { detail: { id, type } }))
}
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(failure('CAMERA_RECOVERY_UNAVAILABLE', 'Private camera draft storage is unavailable.')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'slot' })
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(failure('CAMERA_RECOVERY_UNAVAILABLE', 'Close older app windows to save the camera draft.'))
  }).catch(error => { dbPromise = undefined; throw error })
  return dbPromise
}
async function transaction(mode, action) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let result, error
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(error || tx.error || failure('CAMERA_RECOVERY_UNAVAILABLE', 'The camera draft could not be safely saved.'))
    const store = tx.objectStore(STORE)
    const request = store.get(SLOT)
    request.onsuccess = () => {
      try { result = action(store, request.result) }
      catch (caught) { error = caught; tx.abort() }
    }
  })
}

/** Save before leaving the WebView. Only one bounded private draft is retained. */
export async function prepareCameraRecovery(draft, accountId) {
  const owner = ownerId(accountId)
  const clean = safeDraft(draft)
  if (!owner) clean.isDrill = false
  const id = newSubmissionId()
  const createdAt = Date.now()
  await transaction('readwrite', (store, row) => {
    if (alive(row, createdAt)) {
      if (row.accountId !== owner) throw failure('CAMERA_RECOVERY_OWNER', 'A private camera draft belongs to another reporting account. Return to that account to review or discard it.')
      if (row.status === 'pending') throw failure('CAMERA_RECOVERY_PENDING', 'A saved camera session is still pending. Review or discard its draft before opening another camera.')
    }
    store.put({ slot: SLOT, id, accountId: owner, createdAt, expiresAt: createdAt + CAMERA_RECOVERY_TTL, draft: clean, photo: null, status: 'pending', restored: false })
  })
  emit(id, 'prepared')
  return id
}

async function finish(id, result, restored) {
  const photo = result == null ? null : validateNativePhoto(result)
  const row = await transaction('readwrite', (store, current) => {
    if (!alive(current) || current.id !== id) return null
    // Late cancellation/duplicate result must never erase a completed photo.
    if (current.status !== 'pending') return restored ? null : publicRow(current)
    const next = { ...current, photo, status: photo ? 'completed' : 'cancelled', restored: restored === true }
    const clean = publicRow(next)
    store.put(next)
    return clean
  })
  if (row) emit(row.id, restored ? 'restored' : 'completed')
  return row
}
export async function completeCameraRecovery(sessionId, resultOrNull) { return finish(sessionId, resultOrNull, false) }

/** A wrong/anonymous owner cannot discover another account's report or photo. */
export async function readCameraRecovery(accountId) {
  const owner = ownerId(accountId)
  let expiredId
  const row = await transaction('readwrite', (store, current) => {
    if (!current) return null
    if (!alive(current)) { expiredId = current.id; store.delete(SLOT); return null }
    return current.accountId === owner ? publicRow(current) : null
  })
  if (expiredId) emit(expiredId, 'expired')
  return row
}

/** Compare-and-delete: never delete a newer session because an old modal closed. */
export async function clearCameraRecovery(sessionId) {
  const removed = await transaction('readwrite', (store, current) => {
    if (!current || current.id !== sessionId) return false
    store.delete(SLOT)
    return true
  })
  if (removed) emit(sessionId, 'cleared')
  return removed
}

/** Snapshot once at app boot, BEFORE registering appRestoredResult. Only the
 * opaque pending ID escapes: no report, photo, location or account information. */
export async function cameraRestorationCandidate() {
  if (!hasNativeCamera()) return null
  return transaction('readonly', (_store, row) => alive(row) && row.status === 'pending' ? row.id : null)
}

/** A restored event cannot identify its camera session itself. Require the
 * frozen boot candidate; never bind a delayed old event to a newly opened camera. */
export async function recoverCameraResult(event, expectedSessionId) {
  if (typeof expectedSessionId !== 'string' || !expectedSessionId || !hasNativeCamera() ||
      event?.pluginId !== 'Camera' || event.methodName !== 'takePhoto' || typeof event.success !== 'boolean') return null
  const eligible = await transaction('readonly', (_store, row) => alive(row) && row.status === 'pending' && row.id === expectedSessionId)
  if (!eligible) return null
  if (event.success && event.data == null) throw failure('CAMERA_INVALID_PHOTO', 'The restored camera result did not contain a valid photo.')
  return finish(expectedSessionId, event.success ? event.data : null, true)
}
