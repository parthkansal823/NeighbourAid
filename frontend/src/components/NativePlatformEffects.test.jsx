import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Link, useLocation } from 'react-router-dom'
import NativePlatformEffects from './NativePlatformEffects'
import { registerScreenNavigationGuard } from '../utils/androidBack'

const mocks = vi.hoisted(() => ({ native: false, back: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }))
vi.mock('../hooks/useAndroidBackButton', () => ({ default: mocks.back }))
const disposals = []
function Harness() {
  const location = useLocation()
  return <><NativePlatformEffects /><output data-testid="route">{location.pathname}</output><Link to="/map"><span>Map</span></Link><a href="#form">Current form</a><a href="https://example.com" target="_blank" rel="noreferrer">External</a></>
}
beforeEach(() => { mocks.native = true; mocks.back.mockClear(); window.history.replaceState({ idx: 0 }, '', '/post-alert') })
afterEach(() => disposals.splice(0).forEach(dispose => dispose()))
describe('native link draft protection', () => {
  it('captures child clicks before the router and cleans its listener up', () => {
    const check = vi.fn(() => false)
    disposals.push(registerScreenNavigationGuard(check))
    const { unmount } = render(<BrowserRouter><Harness /></BrowserRouter>)
    fireEvent.click(screen.getByText('Map'), { button: 0 })
    expect(check).toHaveBeenCalledOnce()
    expect(screen.getByTestId('route')).toHaveTextContent('/post-alert')
    unmount()
    const anchor = document.createElement('a')
    anchor.href = '/map'
    document.body.append(anchor)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    anchor.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    anchor.remove()
  })
  it('allows a confirmed navigation without changing the route twice', () => {
    disposals.push(registerScreenNavigationGuard(() => true))
    render(<BrowserRouter><Harness /></BrowserRouter>)
    fireEvent.click(screen.getByText('Map'), { button: 0 })
    expect(screen.getByTestId('route')).toHaveTextContent('/map')
  })
  it('does not add native draft confirmation to regular website links', () => {
    mocks.native = false
    const check = vi.fn(() => false)
    disposals.push(registerScreenNavigationGuard(check))
    render(<BrowserRouter><Harness /></BrowserRouter>)
    fireEvent.click(screen.getByText('Map'), { button: 0 })
    expect(screen.getByTestId('route')).toHaveTextContent('/map')
    expect(check).not.toHaveBeenCalled()
  })
  it('ignores hash-only links, modified clicks and external targets', () => {
    const check = vi.fn(() => false)
    disposals.push(registerScreenNavigationGuard(check))
    render(<BrowserRouter><Harness /></BrowserRouter>)
    fireEvent.click(screen.getByText('Current form'), { button: 0 })
    fireEvent.click(screen.getByText('Map'), { button: 0, ctrlKey: true })
    fireEvent.click(screen.getByText('External'), { button: 0 })
    expect(check).not.toHaveBeenCalled()
  })
})
