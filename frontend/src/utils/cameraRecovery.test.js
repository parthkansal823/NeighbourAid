import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

const mocks = vi.hoisted(() => ({ native: vi.fn(), platform: vi.fn(), available: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native, getPlatform: mocks.platform, isPluginAvailable: mocks.available } }))
vi.mock('@capacitor/camera', () => ({ Camera: { takePhoto: vi.fn() }, EncodingType: { JPEG: 0 }, MediaType: { Photo: 0 } }))
let recovery
const draft = () => ({
  form: { category: 'medical', description: 'Synthetic unsent report', location: { type: 'Point', coordinates: [77, 29] }, token: 'SECRET_FORM_TOKEN' },
  photos: ['data:image/jpeg;base64,/9j/2Q=='], locationSet: true, address: 'Synthetic location', isDrill: true,
  token: 'SECRET_BEARER', user: { access_token: 'SECRET_ACCOUNT_TOKEN' },
})
const photo = () => ({ type: 0, webPath: `${window.location.origin}/_capacitor_file_/cache/synthetic.jpg`, thumbnail: 'SECRET_THUMBNAIL', metadata: { exif: 'SECRET_EXIF' } })
async function storedRows() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('neighbouraid-camera-recovery', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('session', 'readonly')
      const rows = tx.objectStore('session').getAll()
      tx.oncomplete = () => { db.close(); resolve(rows.result) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  mocks.native.mockReturnValue(true); mocks.platform.mockReturnValue('android'); mocks.available.mockReturnValue(true)
  recovery = await import('./cameraRecovery')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('private durable unsent camera session', () => {
  it('keeps one explicitly bounded draft without any bearer/account extras or automatic submission', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy)
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    expect(id).toMatch(/^[\da-f-]{36}$/)
    const row = await recovery.readCameraRecovery('owner')
    expect(row).toMatchObject({ id, accountId: 'owner', status: 'pending', restored: false, photo: null, draft: { form: { description: 'Synthetic unsent report' }, photos: draft().photos, address: 'Synthetic location', locationSet: true, isDrill: true } })
    expect(row.expiresAt - row.createdAt).toBe(24 * 60 * 60 * 1000)
    expect(JSON.stringify(row)).not.toContain('SECRET')
    expect(await storedRows()).toHaveLength(1)
    expect(JSON.stringify(await storedRows())).not.toContain('SECRET')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('never reveals, overwrites or deletes a live draft for another account/null context', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'alice')
    expect(await recovery.readCameraRecovery('bob')).toBeNull()
    expect(await recovery.readCameraRecovery(null)).toBeNull()
    await expect(recovery.prepareCameraRecovery(draft(), 'bob')).rejects.toMatchObject({ code: 'CAMERA_RECOVERY_OWNER' })
    expect(await recovery.clearCameraRecovery('unknown-session')).toBe(false)
    expect((await recovery.readCameraRecovery('alice')).id).toBe(id)
  })
  it('keeps anonymous sessions readable only in anonymous context, with drills disabled', async () => {
    await recovery.prepareCameraRecovery(draft(), null)
    expect(await recovery.readCameraRecovery('signed-in')).toBeNull()
    expect(await recovery.readCameraRecovery(null)).toMatchObject({ accountId: null, draft: { isDrill: false } })
  })
  it('serializes concurrent prepares and retains the successful pending session', async () => {
    const results = await Promise.allSettled([recovery.prepareCameraRecovery(draft(), 'owner'), recovery.prepareCameraRecovery(draft(), 'owner')])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(item => item.status === 'rejected').reason.code).toBe('CAMERA_RECOVERY_PENDING')
    expect((await recovery.readCameraRecovery('owner')).id).toBe(results.find(item => item.status === 'fulfilled').value)
  })
  it('attaches only sanitized native result and later cancellation cannot erase a completed photo', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    expect(await recovery.completeCameraRecovery(id, photo())).toMatchObject({ id, accountId: 'owner', status: 'completed', photo: { webPath: photo().webPath } })
    const row = await recovery.completeCameraRecovery(id, null)
    expect(row.photo).toEqual({ webPath: photo().webPath })
    expect(JSON.stringify(row)).not.toContain('SECRET')
  })
  it('preserves text/photos on cancel and uses ID compare-and-set for stale completions/deletes', async () => {
    const old = await recovery.prepareCameraRecovery(draft(), 'owner')
    expect(await recovery.completeCameraRecovery(old, null)).toMatchObject({ status: 'cancelled', draft: { form: { description: 'Synthetic unsent report' } } })
    const current = await recovery.prepareCameraRecovery({ ...draft(), address: 'Newer draft' }, 'owner')
    expect(await recovery.completeCameraRecovery(old, photo())).toBeNull()
    expect(await recovery.clearCameraRecovery(old)).toBe(false)
    expect((await recovery.readCameraRecovery('owner')).id).toBe(current)
    expect(await storedRows()).toHaveLength(1)
    expect(await recovery.clearCameraRecovery(current)).toBe(true)
    expect(await recovery.readCameraRecovery('owner')).toBeNull()
  })
  it('persists across module reload and expires exactly at 24 hours, not indefinitely', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    vi.resetModules(); recovery = await import('./cameraRecovery')
    expect((await recovery.readCameraRecovery('owner')).id).toBe(id)
    clock.mockReturnValue(1000000 + recovery.CAMERA_RECOVERY_TTL)
    expect(await recovery.readCameraRecovery('owner')).toBeNull()
    expect(await recovery.completeCameraRecovery(id, photo())).toBeNull()
  })
  it('rejects invalid results without losing pending draft context', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    await expect(recovery.completeCameraRecovery(id, { webPath: 'https://remote.invalid/photo.jpg' })).rejects.toMatchObject({ code: 'CAMERA_INVALID_PHOTO' })
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', photo: null })
  })
  it.each([
    value => ({ ...value, form: { ...value.form, description: 'x'.repeat(2001) } }),
    value => ({ ...value, form: { ...value.form, category: 'invalid' } }),
    value => ({ ...value, form: { ...value.form, location: { coordinates: [NaN, 90] } } }),
    value => ({ ...value, photos: Array(4).fill(value.photos[0]) }),
    value => ({ ...value, photos: ['https://remote.invalid/private.jpg'] }),
    value => ({ ...value, photos: ['data:image/jpeg;base64,' + 'A'.repeat(300001)] }),
  ])('does not truncate or overwrite draft after invalid input', async change => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    await expect(recovery.prepareCameraRecovery(change(draft()), 'owner')).rejects.toMatchObject({ code: 'CAMERA_RECOVERY_INVALID' })
    expect((await recovery.readCameraRecovery('owner')).id).toBe(id)
  })
  it('emits context-free mutation events only after a successful durable commit', async () => {
    const listener = vi.fn(); window.addEventListener(recovery.CAMERA_RECOVERY_EVENT, listener)
    try {
      const id = await recovery.prepareCameraRecovery(draft(), 'owner')
      expect(listener.mock.calls[0][0].detail).toEqual({ id, type: 'prepared' })
      await recovery.completeCameraRecovery(id, null)
      await recovery.clearCameraRecovery(id)
      expect(listener.mock.calls.map(([event]) => event.detail.type)).toEqual(['prepared', 'completed', 'cleared'])
      expect(JSON.stringify(listener.mock.calls.map(([event]) => event.detail))).not.toContain('Synthetic')
    } finally { window.removeEventListener(recovery.CAMERA_RECOVERY_EVENT, listener) }
  })
  it('retains context if an IndexedDB write aborts and does not acknowledge/emit the failed mutation', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) { const req = original.apply(this, args); this.transaction.abort(); return req })
    const listener = vi.fn(); window.addEventListener(recovery.CAMERA_RECOVERY_EVENT, listener)
    try {
      await expect(recovery.completeCameraRecovery(id, photo())).rejects.toThrow()
      expect(listener).not.toHaveBeenCalled()
      expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', photo: null })
    } finally { window.removeEventListener(recovery.CAMERA_RECOVERY_EVENT, listener) }
  })
  it('fails closed if durable storage is unavailable, never using localStorage for private reports', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(recovery.prepareCameraRecovery(draft(), 'owner')).rejects.toMatchObject({ code: 'CAMERA_RECOVERY_UNAVAILABLE' })
    expect(localStorage.length).toBe(0)
  })
  it('rejects an accidental bearer/token string as an account ID', async () => {
    await expect(recovery.prepareCameraRecovery(draft(), 'Bearer header.payload.signature')).rejects.toMatchObject({ code: 'CAMERA_RECOVERY_INVALID' })
    await expect(recovery.prepareCameraRecovery(draft(), 'header.payload.signature')).rejects.toMatchObject({ code: 'CAMERA_RECOVERY_INVALID' })
  })
})

describe('native restored activity results', () => {
  const event = () => ({ pluginId: 'Camera', methodName: 'takePhoto', success: true, data: photo() })
  it('only completes an existing pending session, under its original owner', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'original-owner')
    const candidate = await recovery.cameraRestorationCandidate()
    expect(candidate).toBe(id)
    expect(await recovery.recoverCameraResult(event(), candidate)).toMatchObject({ id, accountId: 'original-owner', restored: true, status: 'completed' })
    expect(await recovery.readCameraRecovery('new-owner')).toBeNull()
    expect(await recovery.cameraRestorationCandidate()).toBeNull()
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
  })
  it('ignores photo/event data without saved context and never fabricates a report', async () => {
    const candidate = await recovery.cameraRestorationCandidate()
    expect(candidate).toBeNull()
    expect(await recovery.recoverCameraResult({ ...event(), data: { webPath: 'https://remote.invalid/photo.jpg' } }, candidate)).toBeNull()
    expect(await recovery.readCameraRecovery(null)).toBeNull()
  })
  it.each([{ pluginId: 'Other' }, { methodName: 'getPhoto' }, { success: undefined }])('ignores unrelated callbacks %o without changing context', async change => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    const candidate = await recovery.cameraRestorationCandidate()
    expect(await recovery.recoverCameraResult({ ...event(), ...change }, candidate)).toBeNull()
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', restored: false })
  })
  it('retains the draft when Android supplies a failed/cancelled restored event', async () => {
    await recovery.prepareCameraRecovery(draft(), null)
    const candidate = await recovery.cameraRestorationCandidate()
    expect(await recovery.recoverCameraResult({ ...event(), success: false, error: { code: 'OS-PLUG-CAMR-0006' } }, candidate)).toMatchObject({ accountId: null, restored: true, status: 'cancelled', photo: null })
  })
  it('retains pending context when a successful restored callback contains no usable photo', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    const candidate = await recovery.cameraRestorationCandidate()
    await expect(recovery.recoverCameraResult({ ...event(), data: undefined }, candidate)).rejects.toMatchObject({ code: 'CAMERA_INVALID_PHOTO' })
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', restored: false })
  })
  it('ignores restored results for expired or cancelled context and cannot recreate a cleared session', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    const candidate = await recovery.cameraRestorationCandidate()
    await recovery.completeCameraRecovery(id, null)
    expect(await recovery.cameraRestorationCandidate()).toBeNull()
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
    await recovery.clearCameraRecovery(id)
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
    await recovery.prepareCameraRecovery(draft(), 'owner')
    const laterCandidate = await recovery.cameraRestorationCandidate()
    clock.mockReturnValue(1000000 + recovery.CAMERA_RECOVERY_TTL)
    expect(await recovery.cameraRestorationCandidate()).toBeNull()
    expect(await recovery.recoverCameraResult(event(), laterCandidate)).toBeNull()
  })
  it('does not process native restored callbacks on web or without the plugin', async () => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    const candidate = await recovery.cameraRestorationCandidate()
    mocks.available.mockReturnValue(false)
    expect(await recovery.cameraRestorationCandidate()).toBeNull()
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
    mocks.available.mockReturnValue(true); mocks.native.mockReturnValue(false)
    expect(await recovery.cameraRestorationCandidate()).toBeNull()
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending' })
  })
  it.each([undefined, null, '', 42])('fails closed without a valid frozen session ID (%s)', async candidate => {
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    expect(await recovery.recoverCameraResult(event(), candidate)).toBeNull()
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', photo: null })
  })
  it.each([['alice', 'alice'], ['alice', 'bob'], [null, 'signed-in'], ['signed-in', null]])(
    'never correlates a delayed old event from %s with a new session for %s', async (oldOwner, newOwner) => {
      const oldId = await recovery.prepareCameraRecovery(draft(), oldOwner)
      const bootCandidate = await recovery.cameraRestorationCandidate()
      expect(bootCandidate).toBe(oldId)
      await recovery.clearCameraRecovery(oldId)
      const newId = await recovery.prepareCameraRecovery({ ...draft(), address: 'New pending session' }, newOwner)
      expect(await recovery.recoverCameraResult(event(), bootCandidate)).toBeNull()
      expect(await recovery.recoverCameraResult({ ...event(), success: false }, bootCandidate)).toBeNull()
      expect(await recovery.readCameraRecovery(newOwner)).toMatchObject({ id: newId, accountId: newOwner, status: 'pending', photo: null, restored: false, draft: { address: 'New pending session' } })
    }
  )
  it('a missing boot candidate cannot bind to a camera opened later in the same app run', async () => {
    const bootCandidate = await recovery.cameraRestorationCandidate()
    expect(bootCandidate).toBeNull()
    const id = await recovery.prepareCameraRecovery(draft(), 'owner')
    expect(await recovery.recoverCameraResult(event(), bootCandidate)).toBeNull()
    expect(await recovery.readCameraRecovery('owner')).toMatchObject({ id, status: 'pending', photo: null, restored: false })
  })
})
