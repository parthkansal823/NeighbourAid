import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Link, useLocation } from 'react-router-dom'
import useAndroidBackButton from './useAndroidBackButton'
import { ANDROID_KEYBOARD_DISMISS_EVENT, registerScreenNavigationGuard } from '../utils/androidBack'

const native = vi.hoisted(() => ({
  enabled: true, platform: 'android', available: true,
  addListener: vi.fn(), exitApp: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => native.enabled,
  getPlatform: () => native.platform,
  isPluginAvailable: () => native.available,
} }))
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener, exitApp: native.exitApp } }))

function Harness() {
  useAndroidBackButton()
  const location = useLocation()
  return <><output data-testid="route">{location.pathname}{location.search}{location.hash}</output><Link to="/map">Map</Link><Link to="/post-alert">Report</Link></>
}
const mount = (strict = false) => render(strict
  ? <StrictMode><BrowserRouter><Harness /></BrowserRouter></StrictMode>
  : <BrowserRouter><Harness /></BrowserRouter>)
const callbacks = []
const handles = []
const cleanups = []

beforeEach(() => {
  native.enabled = true
  native.platform = 'android'
  native.available = true
  native.exitApp.mockReset()
  callbacks.length = 0
  handles.length = 0
  window.history.replaceState({ idx: 0 }, '', '/')
  native.addListener.mockReset().mockImplementation((_name, callback) => {
    callbacks.push(callback)
    const handle = { remove: vi.fn().mockResolvedValue(undefined) }
    handles.push(handle)
    return Promise.resolve(handle)
  })
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})
const back = async (index = callbacks.length - 1, event = { canGoBack: true }) => {
  await act(async () => { callbacks[index](event) })
}

describe('Android hardware back', () => {
  it.each([
    ['website', false, 'web', true],
    ['iOS', true, 'ios', true],
    ['an APK missing the plugin', true, 'android', false],
  ])('does not register native listeners on %s', (_name, enabled, platform, available) => {
    Object.assign(native, { enabled, platform, available })
    const events = vi.fn()
    window.addEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, events)
    cleanups.push(() => window.removeEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, events))
    mount()
    expect(native.addListener).not.toHaveBeenCalled()
    expect(events).not.toHaveBeenCalled()
    expect(native.exitApp).not.toHaveBeenCalled()
  })

  it('uses BrowserRouter history, reads the latest route, and never exits at Home', async () => {
    mount()
    fireEvent.click(screen.getByRole('link', { name: 'Map' }))
    expect(window.history.state.idx).toBe(1)
    await back()
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/))
    await back()
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
    expect(native.addListener).toHaveBeenCalledOnce()
    expect(native.addListener).toHaveBeenCalledWith('backButton', expect.any(Function))
    expect(native.exitApp).not.toHaveBeenCalled()
  })

  it.each([0, undefined, '4', -1])('uses Home fallback for an unsafe history index %s', async (idx) => {
    window.history.replaceState({ idx }, '', '/alert/test-alert')
    mount()
    // BrowserRouter initializes a missing index to zero; both cases are safe.
    await back()
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
    expect(native.exitApp).not.toHaveBeenCalled()
  })

  it('uses replace-to-Home when the native view cannot go back', async () => {
    mount()
    fireEvent.click(screen.getByRole('link', { name: 'Map' }))
    await back(0, { canGoBack: false })
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
    expect(window.history.state.idx).toBe(1)
  })

  it('clears a Home search/hash rather than leaving a deep-linked screen state', async () => {
    window.history.replaceState({ idx: 0 }, '', '/?category=fire#details')
    mount()
    await back()
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
  })

  it('dismisses the top overlay before keyboard, guards, or route navigation', async () => {
    window.history.replaceState({ idx: 0 }, '', '/map')
    mount()
    const closeLower = vi.fn(), closeTop = vi.fn(), keyboard = vi.fn(), guard = vi.fn(() => true)
    cleanups.push(registerScreenNavigationGuard(guard))
    window.addEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, keyboard)
    cleanups.push(() => window.removeEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, keyboard))
    render(<><section role="dialog" aria-modal="true" style={{ zIndex: 40 }}><button aria-label="Close" onClick={closeLower}>Close lower</button></section><section role="dialog" aria-modal="true" style={{ zIndex: 50 }}><button aria-label="Close camera" onClick={closeTop}>Close top</button></section></>)
    await back()
    expect(closeTop).toHaveBeenCalledOnce()
    expect(closeLower).not.toHaveBeenCalled()
    expect(keyboard).not.toHaveBeenCalled()
    expect(guard).not.toHaveBeenCalled()
    expect(screen.getByTestId('route')).toHaveTextContent('/map')
  })

  it('lets the keyboard consume back before considering an unsent report', async () => {
    window.history.replaceState({ idx: 0 }, '', '/post-alert')
    mount()
    const keyboard = vi.fn(event => event.preventDefault())
    const guard = vi.fn(() => false)
    cleanups.push(registerScreenNavigationGuard(guard))
    window.addEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, keyboard)
    cleanups.push(() => window.removeEventListener(ANDROID_KEYBOARD_DISMISS_EVENT, keyboard))
    await back()
    expect(keyboard).toHaveBeenCalledOnce()
    expect(keyboard.mock.calls[0][0].cancelable).toBe(true)
    expect(guard).not.toHaveBeenCalled()
    expect(screen.getByTestId('route')).toHaveTextContent('/post-alert')
  })

  it('respects the same synchronous guard used by native header and tab links', async () => {
    window.history.replaceState({ idx: 0 }, '', '/post-alert')
    mount()
    const guard = vi.fn().mockReturnValue(false)
    cleanups.push(registerScreenNavigationGuard(guard))
    await back()
    expect(screen.getByTestId('route')).toHaveTextContent('/post-alert')
    guard.mockReturnValue(true)
    await back()
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
  })

  it('removes a native handle that resolves after unmount, with stale callbacks inert', async () => {
    let resolve
    native.addListener.mockImplementation((_name, callback) => {
      callbacks.push(callback)
      return new Promise(done => { resolve = done })
    })
    const view = mount()
    view.unmount()
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    await back()
    expect(dispatch).not.toHaveBeenCalled()
    const handle = { remove: vi.fn().mockResolvedValue(undefined) }
    await act(async () => { resolve(handle) })
    expect(handle.remove).toHaveBeenCalledOnce()
  })

  it('cleans up both StrictMode subscriptions without an active stale callback', async () => {
    const view = mount(true)
    await act(async () => {})
    expect(native.addListener).toHaveBeenCalledTimes(2)
    expect(handles[0].remove).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('link', { name: 'Report' }))
    await back(0)
    expect(screen.getByTestId('route')).toHaveTextContent('/post-alert')
    await back(1, { canGoBack: false })
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/)
    view.unmount()
    expect(handles[1].remove).toHaveBeenCalledOnce()
  })

  it('handles unavailable native registration and rejected cleanup without crashing', async () => {
    native.addListener.mockRejectedValueOnce(new Error('Old APK'))
    const first = mount()
    await act(async () => {})
    first.unmount()
    const remove = vi.fn().mockRejectedValue(new Error('Already removed'))
    native.addListener.mockResolvedValueOnce({ remove })
    const second = mount()
    await act(async () => {})
    second.unmount()
    await act(async () => {})
    expect(remove).toHaveBeenCalledOnce()
    expect(native.exitApp).not.toHaveBeenCalled()
  })
})
