import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ native: false, setStyle: vi.fn(() => Promise.resolve()) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  SystemBars: { setStyle: mocks.setStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
}))

import useSystemAppearance from './useSystemAppearance'

function Harness() {
  useSystemAppearance()
  return null
}

let media
let listener

beforeEach(() => {
  mocks.native = false
  mocks.setStyle.mockClear()
  listener = undefined
  media = {
    matches: false,
    addEventListener: vi.fn((event, callback) => { if (event === 'change') listener = callback }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('color-scheme')
  vi.unstubAllGlobals()
})

describe('useSystemAppearance', () => {
  it('uses the browser preference and responds when it changes', () => {
    render(<Harness />)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    act(() => { media.matches = true; listener() })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('keeps Android system-bar icons aligned with the chosen theme', () => {
    mocks.native = true
    media.matches = true
    render(<Harness />)
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: 'DARK' })
  })
})
