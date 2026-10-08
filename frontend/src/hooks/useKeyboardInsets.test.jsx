import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useKeyboardInsets from './useKeyboardInsets'

const mocks = vi.hoisted(() => ({ native: vi.fn(), available: vi.fn(), listen: vi.fn(), hide: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native, isPluginAvailable: mocks.available } }))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: mocks.listen, hide: mocks.hide } }))

let viewport, callbacks, removers
function Harness() {
  const state = useKeyboardInsets()
  return <><input aria-label="Report" /><output>{JSON.stringify(state)}</output></>
}
const state = () => JSON.parse(screen.getByRole('status').textContent)
const resize = height => act(() => { viewport.height = height; viewport.dispatchEvent(new Event('resize')) })
const settle = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.native.mockReturnValue(false)
  mocks.available.mockReturnValue(true)
  mocks.hide.mockResolvedValue(undefined)
  callbacks = new Map()
  removers = []
  mocks.listen.mockImplementation((name, callback) => {
    callbacks.set(name, callback)
    const remove = vi.fn().mockResolvedValue(undefined)
    removers.push(remove)
    return Promise.resolve({ remove })
  })
  viewport = new EventTarget()
  Object.assign(viewport, { height: 800, offsetTop: 0, scale: 1 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('innerWidth', 390)
})
afterEach(() => vi.unstubAllGlobals())

describe('useKeyboardInsets', () => {
  it('keeps native-open keyboard state during pinch zoom without mixed-unit padding', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    await settle()
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    viewport.scale = 2
    resize(250)
    expect(state()).toMatchObject({ keyboardOpen: true, bottomInset: 0, viewportHeight: 250 })
  })
  it('removes a listener that resolves after unmount and survives bridge hide/remove failures', async () => {
    mocks.native.mockReturnValue(true)
    let resolve
    mocks.listen.mockImplementationOnce((_name, callback) => {
      callbacks.set('keyboardDidShow', callback)
      return new Promise(done => { resolve = done })
    })
    const { unmount } = render(<Harness />)
    await settle()
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    mocks.hide.mockImplementationOnce(() => { throw new Error('old bridge') })
    const dismiss = new CustomEvent('neighbouraid:keyboard-dismiss', { cancelable: true })
    act(() => window.dispatchEvent(dismiss))
    expect(dismiss.defaultPrevented).toBe(true)
    unmount()
    const remove = vi.fn(() => Promise.reject(new Error('gone')))
    await act(async () => resolve({ remove }))
    expect(remove).toHaveBeenCalledOnce()
  })
  it('uses browser viewport events only on the website', () => {
    render(<Harness />)
    act(() => screen.getByLabelText('Report').focus())
    resize(480)
    expect(state()).toEqual({ keyboardOpen: true, keyboardHeight: 320, bottomInset: 320, viewportHeight: 480 })
    expect(mocks.listen).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--app-keyboard-inset')).toBe('320px')
    act(() => screen.getByLabelText('Report').blur())
    expect(state().keyboardOpen).toBe(false)
  })

  it('does not confuse toolbar resizing, unfocused viewport resizing, or pinch zoom with a keyboard', () => {
    render(<Harness />)
    resize(400)
    expect(state().keyboardOpen).toBe(false)
    resize(800)
    act(() => screen.getByLabelText('Report').focus())
    resize(720)
    expect(state().keyboardOpen).toBe(false)
    viewport.scale = 2
    resize(400)
    expect(state().keyboardOpen).toBe(false)
  })

  it('does not add keyboard padding a second time when the layout viewport resizes', () => {
    render(<Harness />)
    act(() => screen.getByLabelText('Report').focus())
    vi.stubGlobal('innerHeight', 480)
    resize(480)
    expect(state()).toMatchObject({ keyboardOpen: true, bottomInset: 0, viewportHeight: 480 })
  })

  it('does not treat browser orientation change as a keyboard', () => {
    render(<Harness />)
    act(() => screen.getByLabelText('Report').focus())
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 390)
    resize(390)
    expect(state().keyboardOpen).toBe(false)
  })

  it('uses native events when the keyboard overlays an unchanged WebView', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    await settle()
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    expect(state()).toEqual({ keyboardOpen: true, keyboardHeight: 300, bottomInset: 300, viewportHeight: 500 })
    act(() => callbacks.get('keyboardDidHide')())
    expect(state()).toMatchObject({ keyboardOpen: false, bottomInset: 0, viewportHeight: 800 })
  })

  it('uses native events without double-subtracting an already resized WebView', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    await settle()
    vi.stubGlobal('innerHeight', 500)
    viewport.height = 500
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    expect(state()).toMatchObject({ bottomInset: 0, viewportHeight: 500 })
  })

  it('dismisses the keyboard before navigation and never calls native hide on the website', () => {
    render(<Harness />)
    act(() => screen.getByLabelText('Report').focus())
    resize(480)
    const event = new Event('neighbouraid:keyboard-dismiss', { cancelable: true })
    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('Report')).not.toHaveFocus()
    expect(mocks.hide).not.toHaveBeenCalled()
    expect(state().keyboardOpen).toBe(false)
    const second = new Event('neighbouraid:keyboard-dismiss', { cancelable: true })
    act(() => window.dispatchEvent(second))
    expect(second.defaultPrevented).toBe(false)
  })

  it('preserves the visible height when a resized native keyboard stays open during rotation', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    await settle()
    vi.stubGlobal('innerHeight', 500)
    viewport.height = 500
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 320)
    viewport.height = 320
    act(() => window.dispatchEvent(new Event('orientationchange')))
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 200 }))
    expect(state()).toMatchObject({ keyboardOpen: true, keyboardHeight: 200, bottomInset: 0, viewportHeight: 320 })
  })

  it('retains actual occlusion when an overlay-mode native keyboard stays open during rotation', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    await settle()
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 520)
    viewport.height = 520
    act(() => window.dispatchEvent(new Event('orientationchange')))
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 200 }))
    expect(state()).toMatchObject({ keyboardOpen: true, keyboardHeight: 200, bottomInset: 200, viewportHeight: 320 })
  })

  it('catches optional native hide rejection while retaining a blur fallback', async () => {
    mocks.native.mockReturnValue(true)
    mocks.hide.mockRejectedValue(new Error('Bridge unavailable'))
    render(<Harness />)
    await settle()
    act(() => screen.getByLabelText('Report').focus())
    act(() => callbacks.get('keyboardDidShow')({ keyboardHeight: 300 }))
    const event = new Event('neighbouraid:keyboard-dismiss', { cancelable: true })
    act(() => window.dispatchEvent(event))
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.hide).toHaveBeenCalledOnce()
    expect(state().keyboardOpen).toBe(false)
  })

  it('reveals a focused field only when it is outside the usable viewport', () => {
    render(<Harness />)
    const field = screen.getByLabelText('Report')
    field.scrollIntoView = vi.fn()
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ top: 600, bottom: 650 })
    act(() => field.focus())
    resize(480)
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' })
  })

  it('falls back to viewport detection if a native listener is missing or rejected', async () => {
    mocks.native.mockReturnValue(true)
    mocks.listen.mockRejectedValue(new Error('Plugin unavailable'))
    render(<Harness />)
    await settle()
    act(() => screen.getByLabelText('Report').focus())
    resize(480)
    expect(state().keyboardOpen).toBe(true)
  })

  it('skips an absent native keyboard plugin', () => {
    mocks.native.mockReturnValue(true)
    mocks.available.mockReturnValue(false)
    renderHook(() => useKeyboardInsets())
    expect(mocks.listen).not.toHaveBeenCalled()
  })

  it('cleans up owned listeners and restores the previous DOM values', async () => {
    mocks.native.mockReturnValue(true)
    const root = document.documentElement
    root.style.setProperty('--app-keyboard-height', '7px')
    root.setAttribute('data-keyboard-open', 'previous')
    const { unmount } = renderHook(() => useKeyboardInsets())
    await settle()
    unmount()
    expect(removers).toHaveLength(2)
    removers.forEach(remove => expect(remove).toHaveBeenCalledOnce())
    expect(root.style.getPropertyValue('--app-keyboard-height')).toBe('7px')
    expect(root.getAttribute('data-keyboard-open')).toBe('previous')
    root.style.removeProperty('--app-keyboard-height')
    root.removeAttribute('data-keyboard-open')
  })

  it('removes native handles that resolve after unmount', async () => {
    mocks.native.mockReturnValue(true)
    const pending = []
    mocks.listen.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const { unmount } = renderHook(() => useKeyboardInsets())
    unmount()
    const remove = vi.fn().mockResolvedValue(undefined)
    await act(async () => { pending.forEach(resolve => resolve({ remove })); await Promise.resolve() })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(document.documentElement).not.toHaveAttribute('data-keyboard-open')
  })
})
