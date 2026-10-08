import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMERA_MAX_BYTES, cameraPhotoBlob, hasNativeCamera, isCameraCancelled, takeNativePhoto, validateNativePhoto } from './nativeCamera'

const mocks = vi.hoisted(() => ({ native: vi.fn(), platform: vi.fn(), available: vi.fn(), take: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native, getPlatform: mocks.platform, isPluginAvailable: mocks.available } }))
vi.mock('@capacitor/camera', () => ({ Camera: { takePhoto: mocks.take }, EncodingType: { JPEG: 0 }, MediaType: { Photo: 0 } }))
const localPath = () => `${window.location.origin}/_capacitor_file_/data/user/0/com.neighbouraid.app/cache/photo.jpg`
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 255, 217])
function response(chunks = [jpeg], headers = { 'content-type': 'image/jpeg' }, extras = {}) {
  let index = 0
  const reader = { read: vi.fn(async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }), cancel: vi.fn().mockResolvedValue(), releaseLock: vi.fn() }
  return { reader, ok: true, headers: new Headers(headers), body: { getReader: () => reader }, ...extras }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.native.mockReturnValue(true); mocks.platform.mockReturnValue('android'); mocks.available.mockReturnValue(true)
  mocks.take.mockResolvedValue({ webPath: localPath(), type: 0, thumbnail: 'not-the-full-photo', metadata: { exif: 'private' }, uri: 'file:///private' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('camera-only Android bridge', () => {
  it('uses current takePhoto with bounded JPEG options and returns only a validated local path', async () => {
    expect(hasNativeCamera()).toBe(true)
    expect(await takeNativePhoto()).toEqual({ webPath: localPath() })
    expect(mocks.take).toHaveBeenCalledWith({ encodingType: 0, quality: 85, targetWidth: 1280, targetHeight: 1280, correctOrientation: true, editable: 'no', saveToGallery: false, includeMetadata: false })
  })
  it.each(['web', 'ios', 'missing-plugin', 'bridge-throw', 'ssr'])('cannot open a web/gallery fallback when %s', async mode => {
    if (mode === 'web') mocks.native.mockReturnValue(false)
    if (mode === 'ios') mocks.platform.mockReturnValue('ios')
    if (mode === 'missing-plugin') mocks.available.mockReturnValue(false)
    if (mode === 'bridge-throw') mocks.platform.mockImplementation(() => { throw new Error('missing bridge') })
    if (mode === 'ssr') vi.stubGlobal('window', undefined)
    expect(hasNativeCamera()).toBe(false)
    await expect(takeNativePhoto()).rejects.toMatchObject({ code: 'CAMERA_UNAVAILABLE' })
    expect(mocks.take).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('preserves SDK permission/cancellation failures without requesting gallery permissions', async () => {
    const error = { code: 'OS-PLUG-CAMR-0003', message: 'Permission denied' }
    mocks.take.mockRejectedValue(error)
    await expect(takeNativePhoto()).rejects.toBe(error)
    expect(isCameraCancelled(error)).toBe(false)
  })
  it.each(['OS-PLUG-CAMR-0006', 'OS-PLUG-CAMR-0013', 'CAMERA_CANCELLED', 'CANCELLED'])('recognizes explicit cancellation %s', code => {
    expect(isCameraCancelled({ code })).toBe(true)
  })
  it.each([null, {}, { code: 'OS-PLUG-CAMR-0010' }, { message: 'Camera not accessible, not canceled' }])('never infers cancellation from unrelated failure %o', error => {
    expect(isCameraCancelled(error)).toBe(false)
  })
})

describe('local original camera photo reads', () => {
  it.each(['file', 'content'])('accepts only the same-origin Capacitor %s gateway', kind => {
    const path = `${window.location.origin}/_capacitor_${kind}_/some/photo%20one.jpg`
    expect(validateNativePhoto({ webPath: path })).toEqual({ webPath: path })
  })
  it.each([
    'https://remote.invalid/_capacitor_file_/photo.jpg', '/api/private', 'file:///photo.jpg', 'content://photos/1',
    'data:image/jpeg;base64,/9j/', 'blob:https://localhost/file', 'javascript:alert(1)',
    '/_capacitor_file_/photo.jpg?token=secret', '/_capacitor_file_/photo.jpg#secret', '/_capacitor_file_/photo.jpg?',
    '/_capacitor_file_/photo.jpg#', '/_capacitor_file_/../private.jpg', '/_capacitor_file_/%2e%2e/private.jpg',
    '/_capacitor_file_/%252e%252e/private.jpg', '/_capacitor_file_/photo%00.jpg', '/_capacitor_file_/photo\\secret.jpg',
    '/_capacitor_file_/', '', null,
  ])('rejects unsafe path %s before any fetch', async webPath => {
    await expect(cameraPhotoBlob({ webPath, thumbnail: '/9j/full-looking-thumbnail' })).rejects.toMatchObject({ code: 'CAMERA_INVALID_PHOTO' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects videos, credentials and thumbnail-only results', () => {
    for (const photo of [{ webPath: localPath(), type: 1 }, { webPath: localPath().replace('://', '://user:password@') }, { thumbnail: '/9j/...' }]) {
      expect(() => validateNativePhoto(photo)).toThrow()
    }
  })
  it('reads full JPEG bytes locally without credentials, caching or redirects', async () => {
    const blob = await cameraPhotoBlob({ webPath: localPath(), thumbnail: 'never-used' })
    expect(blob.type).toBe('image/jpeg'); expect(blob.size).toBe(jpeg.length)
    expect(fetch).toHaveBeenCalledWith(localPath(), expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }))
  })
  it('bounds unknown-length reads as bytes arrive and cancels an oversized stream', async () => {
    const oversized = response([new Uint8Array(CAMERA_MAX_BYTES), jpeg])
    fetch.mockResolvedValue(oversized)
    await expect(cameraPhotoBlob({ webPath: localPath() })).rejects.toMatchObject({ code: 'CAMERA_PHOTO_TOO_LARGE' })
    expect(oversized.reader.cancel).toHaveBeenCalledOnce()
  })
  it.each([
    [{ 'content-length': String(CAMERA_MAX_BYTES + 1) }, {}, 'CAMERA_PHOTO_TOO_LARGE'],
    [{ 'content-length': '0' }, {}, 'CAMERA_PHOTO_TOO_LARGE'],
    [{ 'content-length': '12' }, {}, 'CAMERA_READ_FAILED'],
    [{ 'content-type': 'image/png' }, {}, 'CAMERA_INVALID_PHOTO'],
    [{}, { ok: false }, 'CAMERA_READ_FAILED'],
    [{}, { redirected: true }, 'CAMERA_READ_FAILED'],
    [{}, { url: 'https://remote.invalid/photo.jpg' }, 'CAMERA_READ_FAILED'],
    [{}, { body: null }, 'CAMERA_READ_FAILED'],
  ])('rejects invalid response headers/options %o %o', async (headers, extras, code) => {
    fetch.mockResolvedValue(response([jpeg], headers, extras))
    await expect(cameraPhotoBlob({ webPath: localPath() })).rejects.toMatchObject({ code })
  })
  it.each([{ chunks: [] }, { chunks: [new Uint8Array([1, 2, 3, 4, 5])] }, { chunks: [jpeg.slice(0, -2)] }])('rejects empty/non-JPEG/truncated bytes', async ({ chunks }) => {
    fetch.mockResolvedValue(response(chunks))
    await expect(cameraPhotoBlob({ webPath: localPath() })).rejects.toThrow()
  })
  it('fails closed on offline file read failure, without network or thumbnail fallback', async () => {
    fetch.mockRejectedValue(new Error('offline'))
    await expect(cameraPhotoBlob({ webPath: localPath(), thumbnail: '/9j/' })).rejects.toMatchObject({ code: 'CAMERA_READ_FAILED' })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('aborts a stalled local read after the bounded deadline', async () => {
    vi.useFakeTimers()
    const stalled = response()
    fetch.mockImplementation(async (_url, { signal }) => {
      stalled.reader.read.mockImplementation(() => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
      return stalled
    })
    const result = expect(cameraPhotoBlob({ webPath: localPath() })).rejects.toMatchObject({ code: 'CAMERA_READ_FAILED' })
    await vi.advanceTimersByTimeAsync(15001)
    await result
    expect(stalled.reader.cancel).toHaveBeenCalledOnce()
  })
})
