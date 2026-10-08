import { afterEach, describe, expect, it, vi } from 'vitest'
import { approxKb, compressImage } from './photo'

const JPEG_PREFIX = 'data:image/jpeg;base64,'
const SMALL_JPEG = `${JPEG_PREFIX}/9j/FAKE`
const encoded = length => JPEG_PREFIX + 'A'.repeat(length - JPEG_PREFIX.length)
const imageFile = (type = 'image/jpeg') => new File(['image bytes'], 'capture.jpg', { type })

// These dimensions represent browser-decoded orientation, not real camera or
// EXIF behavior (which needs device QA). No image bytes are sent anywhere.
function harness({ width = 800, height = 600, imageMode = 'load', objectURL = true, readerMode = 'load' } = {}) {
  const images = [], readers = [], canvases = []
  const createObjectURL = vi.fn(() => 'blob:photo-test')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: objectURL ? createObjectURL : undefined, revokeObjectURL })
  vi.stubGlobal('Image', class {
    constructor() {
      this.naturalWidth = width
      this.naturalHeight = height
      this.removeAttribute = vi.fn()
      images.push(this)
    }
    set src(value) {
      this.source = value
      if (imageMode === 'throw') throw new Error('decode source rejected')
      if (imageMode === 'never') return
      queueMicrotask(() => imageMode === 'error' ? this.onerror?.() : this.onload?.())
    }
  })
  vi.stubGlobal('FileReader', class {
    constructor() {
      this.readyState = 0
      this.abort = vi.fn(() => { this.readyState = 2 })
      this.readAsDataURL = vi.fn(blob => {
        if (readerMode === 'throw') throw new Error('file read rejected')
        this.readyState = 1
        if (readerMode === 'never') return
        queueMicrotask(() => {
          this.readyState = 2
          this.result = readerMode === 'invalid' ? null : `data:${blob.type};base64,FAKE`
          if (readerMode === 'error') this.onerror?.()
          else this.onload?.()
        })
      })
      readers.push(this)
    }
  })
  const originalCreate = document.createElement.bind(document)
  const create = vi.spyOn(document, 'createElement').mockImplementation((name, ...args) => {
    const element = originalCreate(name, ...args)
    if (name === 'canvas') canvases.push(element)
    return element
  })
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn() }
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(SMALL_JPEG)
  return { images, readers, canvases, ctx, context, encode, create, createObjectURL, revokeObjectURL }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('approxKb serialized upload estimate', () => {
  it('estimates data URL string length including its transport/base64 overhead', () => {
    expect(approxKb(`${JPEG_PREFIX}${'A'.repeat(2048)}`)).toBe(2)
  })
  it.each(['', null, undefined])('returns zero for an absent string: %s', value => {
    expect(approxKb(value)).toBe(0)
  })
})

describe('compressImage input safety', () => {
  it('rejects a missing input', async () => {
    await expect(compressImage(null)).rejects.toThrow('No file')
  })
  it.each([JPEG_PREFIX + 'AAAA', { type: 'image/jpeg', size: 100 }])('rejects prebuilt URIs and non-Blob inputs', async input => {
    await expect(compressImage(input)).rejects.toThrow(/image file, not a URL or text/)
  })
  it('rejects non-image files', async () => {
    await expect(compressImage(new File(['hello'], 'hello.txt', { type: 'text/plain' }))).rejects.toThrow('Not an image file')
  })
  it.each(['image/svg+xml', 'image/gif', 'image/heic', 'image/bmp'])('rejects unsupported type %s before decoding', async type => {
    const mock = harness()
    await expect(compressImage(imageFile(type))).rejects.toThrow('JPEG, PNG, or WebP')
    expect(mock.createObjectURL).not.toHaveBeenCalled()
    expect(mock.images).toHaveLength(0)
  })
  it('rejects empty input before decoding', async () => {
    const mock = harness()
    await expect(compressImage(new Blob([], { type: 'image/jpeg' }))).rejects.toThrow('empty')
    expect(mock.images).toHaveLength(0)
  })
  it('rejects over 20 MiB input before allocating a decoder or canvas', async () => {
    const mock = harness()
    const file = imageFile()
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 })
    await expect(compressImage(file)).rejects.toThrow('too large')
    expect(mock.images).toHaveLength(0)
    expect(mock.canvases).toHaveLength(0)
  })
  it('accepts the exact 20 MiB encoded input boundary', async () => {
    const mock = harness()
    const file = imageFile()
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 })
    await expect(compressImage(file)).resolves.toBe(SMALL_JPEG)
    expect(mock.createObjectURL).toHaveBeenCalledWith(file)
  })
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s Files and reencodes only JPEG', async type => {
    const mock = harness()
    await expect(compressImage(imageFile(type))).resolves.toBe(SMALL_JPEG)
    expect(mock.encode).toHaveBeenCalledWith('image/jpeg', 0.82)
  })
  it('accepts an internal Blob without adding a gallery input', async () => {
    harness()
    await expect(compressImage(new Blob(['capture'], { type: 'image/jpeg' }))).resolves.toBe(SMALL_JPEG)
  })
})

describe('compressImage dimensions and memory bounds', () => {
  it.each([
    [6000, 4000, 1280, 853], // landscape, exactly 24 megapixels
    [4000, 6000, 853, 1280], // browser-decoded portrait orientation
    [320, 240, 320, 240], // no upscaling
    [24000, 1, 1280, 1], // rounding cannot produce a zero-height canvas
  ])('preserves decoded %sx%s geometry as %sx%s', async (width, height, outWidth, outHeight) => {
    const mock = harness({ width, height })
    await compressImage(imageFile())
    expect(mock.ctx.drawImage).toHaveBeenCalledWith(mock.images[0], 0, 0, outWidth, outHeight)
    expect(mock.canvases).toHaveLength(1)
    expect(mock.context).toHaveBeenCalledWith('2d', { alpha: false })
    expect(mock.ctx.fillStyle).toBe('#fff')
    expect(mock.ctx.fillRect).toHaveBeenCalledWith(0, 0, outWidth, outHeight)
    expect(mock.canvases[0].width).toBe(0)
    expect(mock.canvases[0].height).toBe(0)
  })
  it.each([[0, 600], [800, 0], [NaN, 600], [800, Infinity], [800.5, 600]])('rejects invalid decoded dimensions %sx%s before a canvas', async (width, height) => {
    const mock = harness({ width, height })
    await expect(compressImage(imageFile())).rejects.toThrow('dimensions')
    expect(mock.canvases).toHaveLength(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledWith('blob:photo-test')
  })
  it('rejects over 24 megapixels before allocating canvas backing memory', async () => {
    const mock = harness({ width: 6001, height: 4000 })
    await expect(compressImage(imageFile())).rejects.toThrow('24 megapixels')
    expect(mock.canvases).toHaveLength(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('handles a missing 2D context and releases resources', async () => {
    const mock = harness()
    mock.context.mockReturnValue(null)
    await expect(compressImage(imageFile())).rejects.toThrow('unavailable')
    expect(mock.encode).not.toHaveBeenCalled()
    expect(mock.canvases[0].width).toBe(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
})

describe('compressImage bounded serialized JPEG encoding', () => {
  it('accepts exactly 280000 serialized characters including the data URL prefix', async () => {
    const mock = harness()
    mock.encode.mockReturnValue(encoded(280000))
    expect((await compressImage(imageFile())).length).toBe(280000)
    expect(mock.encode).toHaveBeenCalledOnce()
  })
  it('lowers quality when one serialized character exceeds the budget', async () => {
    const mock = harness()
    mock.encode.mockReturnValueOnce(encoded(280001)).mockReturnValueOnce(encoded(280000))
    expect((await compressImage(imageFile())).length).toBe(280000)
    expect(mock.encode.mock.calls.map(([_type, quality]) => quality)).toEqual([0.82, 0.72])
    expect(mock.ctx.drawImage).toHaveBeenCalledOnce()
  })
  it('reuses one canvas and stops after nine encodes with only five redraws', async () => {
    const mock = harness()
    mock.encode.mockReturnValue(encoded(280001))
    await expect(compressImage(imageFile())).rejects.toThrow('try a smaller photo')
    expect(mock.encode.mock.calls.map(([_type, quality]) => quality)).toEqual([0.82, 0.72, 0.62, 0.52, 0.42, 0.6, 0.6, 0.6, 0.6])
    expect(mock.canvases).toHaveLength(1)
    expect(mock.ctx.drawImage.mock.calls.map(([_image, _x, _y, width, height]) => [width, height])).toEqual([[800, 600], [640, 480], [480, 360], [360, 270], [280, 210]])
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
    expect(mock.canvases[0].width).toBe(0)
  })
  it.each([null, 'data:,', JPEG_PREFIX, 'data:image/png;base64,AAAA'])('rejects empty/unsupported encoder output: %s', async output => {
    const mock = harness()
    mock.encode.mockReturnValue(output)
    await expect(compressImage(imageFile())).rejects.toThrow('not supported')
    expect(mock.encode).toHaveBeenCalledOnce()
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('normalizes draw failures and releases the canvas/object URL', async () => {
    const mock = harness()
    mock.ctx.drawImage.mockImplementation(() => { throw new Error('draw failed') })
    await expect(compressImage(imageFile())).rejects.toThrow('Could not process image')
    expect(mock.canvases[0].width).toBe(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('normalizes canvas export errors without returning a raw data URL', async () => {
    const mock = harness()
    mock.encode.mockImplementation(() => { throw new Error('tainted canvas') })
    await expect(compressImage(imageFile())).rejects.toThrow('Could not encode image')
    expect(mock.canvases[0].width).toBe(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
})

describe('compressImage decoder cleanup and fallback', () => {
  it('uses a blob URL instead of base64 FileReader and revokes after success', async () => {
    const mock = harness()
    await compressImage(imageFile())
    expect(mock.images[0].source).toBe('blob:photo-test')
    expect(mock.readers).toHaveLength(0)
    expect(mock.images[0].onload).toBeNull()
    expect(mock.images[0].onerror).toBeNull()
    expect(mock.images[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(mock.revokeObjectURL).toHaveBeenCalledWith('blob:photo-test')
  })
  it.each(['error', 'throw'])('rejects corrupt decode/source errors and revokes: %s', async imageMode => {
    const mock = harness({ imageMode })
    await expect(compressImage(imageFile())).rejects.toThrow('Could not decode image')
    expect(mock.canvases).toHaveLength(0)
    expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('handles object URL creation failure without leaving a pending decode', async () => {
    const mock = harness()
    mock.createObjectURL.mockImplementation(() => { throw new Error('blob URL denied') })
    await expect(compressImage(imageFile())).rejects.toThrow('Could not read file')
    expect(mock.images[0].onload).toBeNull()
    expect(mock.revokeObjectURL).not.toHaveBeenCalled()
  })
  it('uses a bounded FileReader fallback when blob URL support is absent', async () => {
    const mock = harness({ objectURL: false })
    const file = imageFile()
    await expect(compressImage(file)).resolves.toBe(SMALL_JPEG)
    expect(mock.readers[0].readAsDataURL).toHaveBeenCalledWith(file)
    expect(mock.images[0].source).toMatch(/^data:image\/jpeg;base64,/)
    expect(mock.readers[0].onload).toBeNull()
    expect(mock.readers[0].onerror).toBeNull()
    expect(mock.revokeObjectURL).not.toHaveBeenCalled()
  })
  it.each(['error', 'throw', 'invalid'])('rejects fallback file-read failure: %s', async readerMode => {
    const mock = harness({ objectURL: false, readerMode })
    await expect(compressImage(imageFile())).rejects.toThrow('Could not read file')
    expect(mock.canvases).toHaveLength(0)
    expect(mock.readers[0].onload).toBeNull()
  })
  it.each([true, false])('bounds stalled decoding/reading to 15s and cleans up (blob support %s)', async objectURL => {
    const mock = harness({ objectURL, imageMode: 'never', readerMode: 'never' })
    vi.useFakeTimers()
    const assertion = expect(compressImage(imageFile())).rejects.toThrow('too long to decode')
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(mock.images[0].onload).toBeNull()
    expect(mock.images[0].onerror).toBeNull()
    expect(mock.canvases).toHaveLength(0)
    if (objectURL) expect(mock.revokeObjectURL).toHaveBeenCalledOnce()
    else expect(mock.readers[0].abort).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
