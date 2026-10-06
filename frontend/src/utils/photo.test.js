import { describe, expect, it } from 'vitest'
import { approxKb, compressImage } from './photo'

describe('approxKb', () => {
  it('estimates kilobytes from a data URL string length', () => {
    const data = 'data:image/jpeg;base64,' + 'A'.repeat(2048)
    expect(approxKb(data)).toBeGreaterThanOrEqual(2)
    expect(approxKb(data)).toBeLessThan(4)
  })

  it('returns 0 for an empty string', () => {
    expect(approxKb('')).toBe(0)
  })
})

describe('compressImage', () => {
  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toThrow(/Not an image/)
  })

  it('rejects when no file is supplied', async () => {
    await expect(compressImage(null)).rejects.toThrow(/No file/)
  })

  it('returns a JPEG data URL for a small image (uses canvas stub)', async () => {
    const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' })
    const out = await compressImage(file)
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
  })
})
