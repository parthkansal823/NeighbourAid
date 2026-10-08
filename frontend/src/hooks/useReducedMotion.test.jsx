import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useReducedMotion from './useReducedMotion'

afterEach(() => vi.unstubAllGlobals())

describe('useReducedMotion', () => {
  it('reads and follows live preference changes, then removes its listener', () => {
    const media = new EventTarget()
    media.matches = false
    const remove = vi.spyOn(media, 'removeEventListener')
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result, unmount } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
    expect(result.current).toBe(true)
    act(() => { media.matches = false; media.dispatchEvent(new Event('change')) })
    expect(result.current).toBe(false)
    unmount()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('supports older media-query listener APIs', () => {
    const media = { matches: true, addListener: vi.fn(), removeListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result, unmount } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
    expect(media.addListener).toHaveBeenCalledOnce()
    unmount()
    expect(media.removeListener).toHaveBeenCalledWith(media.addListener.mock.calls[0][0])
  })

  it('degrades without matchMedia rather than crashing', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})
