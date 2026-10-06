/**
 * Compress + resize an image File to a JPEG data URL that fits our 300 KB
 * backend cap. Re-encodes at progressively lower quality and scales down
 * until the size is within budget. Returns the data URL (or rejects).
 *
 * Why client-side:
 *   - no object storage in the stack (Mongo only)
 *   - avoids shipping raw 4–6 MB phone photos across mobile data
 *   - lets the preview show instantly without a server roundtrip
 */

const MAX_BYTES = 280_000 // leave a little headroom under the 300 KB server cap
const MAX_EDGE = 1280

function readAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode image'))
      img.onload = () => resolve(img)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function draw(img, scale, quality) {
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

export async function compressImage(file) {
  if (!file) throw new Error('No file')
  if (!/^image\//.test(file.type)) throw new Error('Not an image file')
  const img = await readAsImage(file)

  const maxEdge = Math.max(img.naturalWidth, img.naturalHeight)
  let scale = Math.min(1, MAX_EDGE / maxEdge)
  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42]

  for (const q of qualities) {
    const data = draw(img, scale, q)
    if (data.length <= MAX_BYTES) return data
  }
  for (const s of [0.8, 0.6, 0.45, 0.35]) {
    const data = draw(img, scale * s, 0.6)
    if (data.length <= MAX_BYTES) return data
  }
  throw new Error('Image is too large — try a smaller photo')
}

export function approxKb(dataUrl) {
  return Math.round(dataUrl.length / 1024)
}
