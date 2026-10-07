import { afterEach, describe, expect, it, vi } from 'vitest'
import { haptic } from './haptics'

afterEach(() => vi.unstubAllGlobals())

describe('haptic', () => {
  it('passes the requested pattern to the device when supported', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic([10, 20, 30])).toBe(true)
    expect(vibrate).toHaveBeenCalledWith([10, 20, 30])
  })

  it('degrades safely when vibration is unavailable', () => {
    vi.stubGlobal('navigator', {})
    expect(haptic()).toBe(false)
  })
})
