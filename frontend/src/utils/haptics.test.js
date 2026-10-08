import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { haptic } from './haptics'

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  available: vi.fn(),
  impact: vi.fn(),
  notification: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.native, isPluginAvailable: mocks.available },
}))
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mocks.impact, notification: mocks.notification },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.native.mockReturnValue(false)
  mocks.available.mockReturnValue(false)
  mocks.impact.mockResolvedValue(undefined)
  mocks.notification.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

const nativeBridge = () => {
  mocks.native.mockReturnValue(true)
  mocks.available.mockReturnValue(true)
}

// The native operation is intentionally fire-and-forget. Drain its rejection
// handler before checking whether the original browser pattern was retried.
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

describe('web haptics compatibility', () => {
  it('passes the requested pattern to the device when supported', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic([10, 20, 30])).toBe(true)
    expect(vibrate).toHaveBeenCalledWith([10, 20, 30])
    expect(mocks.available).not.toHaveBeenCalled()
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
  })

  it('keeps the default short pulse and a rejected browser request synchronous', () => {
    const vibrate = vi.fn(() => false)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic()).toBe(false)
    expect(vibrate).toHaveBeenCalledWith(12)
  })

  it('degrades safely when vibration is unavailable', () => {
    vi.stubGlobal('navigator', {})
    expect(haptic()).toBe(false)
  })

  it('swallows browser vibration errors', () => {
    vi.stubGlobal('navigator', { vibrate: vi.fn(() => { throw new Error('Blocked') }) })
    expect(haptic(10)).toBe(false)
  })

  it('works offline without relying on a network or native bridge', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { onLine: false, vibrate })
    expect(haptic(22)).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(22)
    expect(mocks.impact).not.toHaveBeenCalled()
  })

  it('is safe during server rendering without window or navigator', () => {
    nativeBridge()
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(haptic()).toBe(false)
    expect(mocks.native).not.toHaveBeenCalled()
    expect(mocks.impact).not.toHaveBeenCalled()
  })
})

describe('native plugin-first haptics', () => {
  it('does not vibrate when the helper is imported or before an explicit call', async () => {
    nativeBridge()
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    vi.resetModules()
    await import('./haptics')
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it.each([
    [8, 'LIGHT'],
    [10, 'LIGHT'],
    [12, 'LIGHT'],
    [22, 'MEDIUM'],
    [50, 'HEAVY'],
    [[10, 100, 30], 'MEDIUM'],
  ])('uses a native %s pulse without also vibrating through the browser', async (pattern, style) => {
    nativeBridge()
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic(pattern)).toBe(true)
    expect(mocks.available).toHaveBeenCalledWith('Haptics')
    expect(mocks.impact).toHaveBeenCalledWith({ style })
    await settle()
    expect(vibrate).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
  })

  it.each([
    [[12, 32, 28], 'SUCCESS'],
    [[12, 28, 20], 'SUCCESS'],
    [[35, 60, 70], 'WARNING'],
    [70, 'ERROR'],
  ])('preserves the semantic feedback for %s', async (pattern, type) => {
    nativeBridge()
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic(pattern)).toBe(true)
    expect(mocks.notification).toHaveBeenCalledWith({ type })
    await settle()
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('uses a light default impact even when browser vibration is unavailable', () => {
    nativeBridge()
    vi.stubGlobal('navigator', {})
    expect(haptic()).toBe(true)
    expect(mocks.impact).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('uses browser fallback when an older APK is missing the plugin', () => {
    mocks.native.mockReturnValue(true)
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic([12, 32, 28])).toBe(true)
    expect(vibrate).toHaveBeenCalledWith([12, 32, 28])
    expect(mocks.notification).not.toHaveBeenCalled()
  })

  it('returns false if neither the native plugin nor browser fallback exists', () => {
    mocks.native.mockReturnValue(true)
    vi.stubGlobal('navigator', {})
    expect(haptic()).toBe(false)
    expect(mocks.impact).not.toHaveBeenCalled()
  })

  it('falls back synchronously if the native operation throws', () => {
    nativeBridge()
    mocks.impact.mockImplementation(() => { throw new Error('Bridge unavailable') })
    const vibrate = vi.fn(() => false)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic(22)).toBe(false)
    expect(vibrate).toHaveBeenCalledWith(22)
  })

  it.each(['impact', 'notification'])('catches %s rejection and retries the original browser pattern', async (method) => {
    nativeBridge()
    mocks[method].mockRejectedValue(new Error('Native feedback failed'))
    const pattern = method === 'impact' ? 12 : [35, 60, 70]
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    const result = haptic(pattern)
    expect(result).toBe(true)
    expect(result).not.toBeInstanceOf(Promise)
    expect(vibrate).not.toHaveBeenCalled()
    await settle()
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(pattern)
  })

  it('contains native rejection even if browser fallback also throws', async () => {
    nativeBridge()
    mocks.notification.mockRejectedValue(new Error('Bridge unavailable'))
    const vibrate = vi.fn(() => { throw new Error('Browser vibration denied') })
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic([35, 60, 70])).toBe(true)
    await settle()
    expect(vibrate).toHaveBeenCalledOnce()
  })

  it('contains native rejection if no fallback exists', async () => {
    nativeBridge()
    mocks.impact.mockRejectedValue(new Error('Bridge unavailable'))
    vi.stubGlobal('navigator', {})
    expect(haptic()).toBe(true)
    await settle()
  })

  it('falls back when the Capacitor availability probe fails', () => {
    mocks.native.mockReturnValue(true)
    mocks.available.mockImplementation(() => { throw new Error('Broken registry') })
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic(10)).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(10)
    expect(mocks.impact).not.toHaveBeenCalled()
  })

  it.each([[0], [[]], [[0]], [[0, 30, 0]]])('does not convert cancellation pattern %s into native impact feedback', (pattern) => {
    nativeBridge()
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    expect(haptic(pattern)).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(pattern)
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
  })
})
