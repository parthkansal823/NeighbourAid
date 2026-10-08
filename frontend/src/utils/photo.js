/**
 * Compress an image Blob/File to JPEG, preserving its decoded aspect ratio.
 * The backend cap counts the serialized data URL, not binary JPEG bytes.
 * Reencoding removes source EXIF metadata; it does not prove authenticity.
 *
 * Why client-side:
 *   - no object storage in the stack (Mongo only)
 *   - avoids shipping raw 4–6 MB phone photos across mobile data
 *   - lets the preview show instantly without a server roundtrip
 */

const MAX_BYTES = 280_000 // serialized ASCII characters, below the 300000-character server cap
const MAX_EDGE = 1280
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_INPUT_PIXELS = 24_000_000
const DECODE_TIMEOUT_MS = 15_000
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function readAsImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let reader
    let objectUrl
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      img.onload = img.onerror = null
      img.removeAttribute('src')
      if (reader) {
        reader.onload = reader.onerror = null
        if (reader.readyState === 1) reader.abort()
      }
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl) } catch { /* Best-effort resource cleanup. */ }
      }
    }
    const fail = message => { dispose(); reject(new Error(message)) }
    const timer = setTimeout(() => fail('Photo took too long to decode. Try a smaller image.'), DECODE_TIMEOUT_MS)
    img.onerror = () => fail('Could not decode image. Try another photo.')
    img.onload = () => { clearTimeout(timer); resolve({ img, dispose }) }
    const setSource = source => {
      try { img.src = source } catch { fail('Could not decode image. Try another photo.') }
    }
    try {
      if (typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function') {
        objectUrl = URL.createObjectURL(file)
        setSource(objectUrl)
      } else {
        // The encoded input cap bounds this fallback's extra data-URL
        // allocation. Modern browsers/WebViews can decode the blob directly.
        reader = new FileReader()
        reader.onerror = () => fail('Could not read file. Try another photo.')
        reader.onload = () => {
          if (typeof reader.result !== 'string' || !reader.result.startsWith('data:')) {
            fail('Could not read file. Try another photo.')
            return
          }
          setSource(reader.result)
        }
        reader.readAsDataURL(file)
      }
    } catch { fail('Could not read file. Try another photo.') }
  })
}

export async function compressImage(file) {
  if (!file) throw new Error('No file')
  if (!(file instanceof Blob)) throw new Error('Choose an image file, not a URL or text')
  if (!/^image\//i.test(file.type)) throw new Error('Not an image file')
  if (!SUPPORTED_TYPES.has(file.type.toLowerCase())) throw new Error('Use a JPEG, PNG, or WebP photo')
  if (!file.size) throw new Error('Image file is empty')
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image file is too large. Choose a photo up to 20 MB.')
  const { img, dispose } = await readAsImage(file)
  let canvas
  try {
    const width = img.naturalWidth, height = img.naturalHeight
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error('Could not decode image dimensions. Try another photo.')
    }
    // Check decoded dimensions before canvas allocation. Decoding itself is
    // browser-managed; this cannot bound a browser decoder's memory.
    if (width * height > MAX_INPUT_PIXELS) throw new Error('Photo resolution is too large. Choose a photo up to 24 megapixels.')

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Photo processing is unavailable in this browser')
    const draw = factor => {
      const w = Math.max(1, Math.round(width * scale * factor))
      const h = Math.max(1, Math.round(height * scale * factor))
      canvas.width = w
      canvas.height = h
      try {
        // Transparent PNG/WebP should acquire white, not black JPEG pixels.
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
      } catch { throw new Error('Could not process image. Try another photo.') }
    }
    const encode = quality => {
      let data
      try { data = canvas.toDataURL('image/jpeg', quality) }
      catch { throw new Error('Could not encode image. Try another photo.') }
      if (typeof data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]/.test(data)) {
        throw new Error('JPEG photo processing is not supported in this browser')
      }
      return data.length <= MAX_BYTES ? data : null
    }

    draw(1)
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const data = encode(quality)
      if (data) return data
    }
    for (const factor of [0.8, 0.6, 0.45, 0.35]) {
      draw(factor)
      const data = encode(0.6)
      if (data) return data
    }
    throw new Error('Image is too large — try a smaller photo')
  } finally {
    // Reuse one bounded canvas, then release its buffer and decoded blob URL.
    if (canvas) { canvas.width = 0; canvas.height = 0 }
    dispose()
  }
}

/** Approximate serialized upload KiB, not decoded/binary image size. */
export function approxKb(dataUrl) {
  return Math.round((typeof dataUrl === 'string' ? dataUrl.length : 0) / 1024)
}
