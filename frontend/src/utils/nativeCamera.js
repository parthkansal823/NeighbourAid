import { Capacitor } from '@capacitor/core'
import { Camera, EncodingType, MediaType } from '@capacitor/camera'

export const CAMERA_MAX_BYTES = 8 * 1024 * 1024

function cameraError(code, message) { return Object.assign(new Error(message), { code }) }
function hasControls(value) { return Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) }
function isNativeAndroid() {
  try { return typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' }
  catch { return false }
}

/** Never invoke the Camera plugin's web implementation: it can open a picker. */
export function hasNativeCamera() {
  try { return isNativeAndroid() && Capacitor.isPluginAvailable('Camera') && typeof Camera.takePhoto === 'function' }
  catch { return false }
}

/** Keep only a full-resolution local WebView path, never thumbnails or EXIF. */
export function validateNativePhoto(result) {
  if (!isNativeAndroid()) throw cameraError('CAMERA_UNAVAILABLE', 'The Android device camera is unavailable.')
  const raw = result?.webPath
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\s\\]/.test(raw) || hasControls(raw) ||
      (result.type !== undefined && result.type !== MediaType.Photo)) {
    throw cameraError('CAMERA_INVALID_PHOTO', 'The camera did not return a valid local photo.')
  }
  let url, path
  try {
    url = new URL(raw, window.location.origin)
    path = decodeURIComponent(url.pathname)
  } catch { throw cameraError('CAMERA_INVALID_PHOTO', 'The camera did not return a valid local photo.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin ||
      url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#') ||
      !/^\/_capacitor_(?:file|content)_\/.+/.test(path) || path.includes('\\') || hasControls(path) || /%2e|%2f|%5c/i.test(path) ||
      path.split('/').some(part => part === '..' || part === '.') || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(raw)) {
    throw cameraError('CAMERA_INVALID_PHOTO', 'The camera did not return a valid local photo.')
  }
  return { webPath: url.href }
}

export async function takeNativePhoto() {
  if (!hasNativeCamera()) throw cameraError('CAMERA_UNAVAILABLE', 'The Android device camera is unavailable.')
  return validateNativePhoto(await Camera.takePhoto({
    encodingType: EncodingType.JPEG, quality: 85, targetWidth: 1280, targetHeight: 1280,
    correctOrientation: true, editable: 'no', saveToGallery: false, includeMetadata: false,
  }))
}

export function isCameraCancelled(error) {
  return ['OS-PLUG-CAMR-0006', 'OS-PLUG-CAMR-0013', 'CAMERA_CANCELLED', 'CANCELLED'].includes(error?.code)
}

/** Read the original photo locally. The byte limit is enforced while streaming,
 * not after allocating an unbounded blob. The caller still compresses/reviews it. */
export async function cameraPhotoBlob(result) {
  const { webPath } = validateNativePhoto(result)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let reader
  try {
    const response = await fetch(webPath, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok || response.redirected || (response.url && response.url !== webPath)) {
      throw cameraError('CAMERA_READ_FAILED', 'The saved camera photo is no longer available. Take a new photo.')
    }
    const mime = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (mime && !['image/jpeg', 'image/jpg', 'application/octet-stream'].includes(mime)) {
      throw cameraError('CAMERA_INVALID_PHOTO', 'The camera photo is not a JPEG image.')
    }
    const lengthHeader = response.headers?.get('content-length')
    const expected = lengthHeader == null ? null : Number(lengthHeader)
    if (expected !== null && (!Number.isSafeInteger(expected) || expected <= 0 || expected > CAMERA_MAX_BYTES)) {
      throw cameraError('CAMERA_PHOTO_TOO_LARGE', 'The camera photo is too large or empty. Take a new photo.')
    }
    if (!response.body?.getReader) throw cameraError('CAMERA_READ_FAILED', 'The camera photo could not be read safely. Take a new photo.')
    reader = response.body.getReader()
    const chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw cameraError('CAMERA_READ_FAILED', 'The camera photo could not be read safely.')
      size += value.byteLength
      if (size > CAMERA_MAX_BYTES) throw cameraError('CAMERA_PHOTO_TOO_LARGE', 'The camera photo is too large. Take a new photo.')
      if (value.byteLength) chunks.push(value)
    }
    if (!size || (expected !== null && size !== expected)) throw cameraError('CAMERA_READ_FAILED', 'The camera photo is incomplete. Take a new photo.')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    if (size < 5 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[size - 2] !== 0xff || bytes[size - 1] !== 0xd9) {
      throw cameraError('CAMERA_INVALID_PHOTO', 'The camera photo is not a complete JPEG image.')
    }
    return new Blob([bytes], { type: 'image/jpeg' })
  } catch (error) {
    try { await reader?.cancel() } catch { /* Best effort after a failed read. */ }
    if (error?.code?.startsWith('CAMERA_')) throw error
    throw cameraError('CAMERA_READ_FAILED', 'The saved camera photo could not be read. Take a new photo.')
  } finally { clearTimeout(timer); reader?.releaseLock?.() }
}
