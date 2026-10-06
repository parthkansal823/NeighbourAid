import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import NativeHeader from './NativeHeader'
import MobileNav from './MobileNav'
import EmergencyDialer from './EmergencyDialer'
import NativeHome from './NativeHome'

const mocks = vi.hoisted(() => ({ user: null, logout: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks }))
const wrap = (ui) => <MemoryRouter><I18nProvider>{ui}</I18nProvider></MemoryRouter>
beforeEach(() => { mocks.user = null; vi.clearAllMocks() })
afterEach(() => vi.unstubAllGlobals())

describe('Android shell', () => {
  it('has emergency and language controls without focusable hidden menu links', async () => {
    const open = vi.fn(), user = userEvent.setup()
    render(wrap(<NativeHeader onOpenEmergency={open} />))
    expect(screen.queryByRole('navigation', { name: 'More navigation' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /emergency numbers/i }))
    expect(open).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('link', { name: 'Safety' })).toHaveAttribute('href', '/safety')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'More navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
  })

  it('keeps public reporting and gives a volunteer the respond tab', () => {
    const { rerender } = render(wrap(<MobileNav native />))
    expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute('href', '/post-alert')
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    mocks.user = { role: 'volunteer' }
    rerender(wrap(<MobileNav native />))
    expect(screen.getByRole('link', { name: 'Respond' })).toHaveAttribute('href', '/volunteer')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
  })

  it('hides tabs only while an app form is editing with a resized viewport', () => {
    const viewport = new EventTarget()
    viewport.height = 800
    vi.stubGlobal('visualViewport', viewport)
    render(wrap(<><input aria-label="Name" /><MobileNav native /></>))
    const nav = screen.getByRole('navigation')
    screen.getByLabelText('Name').focus()
    expect(nav).not.toHaveAttribute('hidden')
    act(() => { viewport.height = 480; viewport.dispatchEvent(new Event('resize')) })
    expect(nav).toHaveAttribute('hidden')
    act(() => { screen.getByLabelText('Name').blur() })
    expect(nav).not.toHaveAttribute('hidden')
  })

  it('retains the existing website tabs and does not hide them for native keyboard logic', () => {
    const viewport = new EventTarget()
    viewport.height = 800
    vi.stubGlobal('visualViewport', viewport)
    render(wrap(<><input aria-label="Name" /><MobileNav /></>))
    expect(screen.getByRole('link', { name: 'Report Crisis' })).toHaveAttribute('href', '/post-alert')
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveClass('lg:hidden', 'backdrop-blur', 'z-40')
    screen.getByLabelText('Name').focus()
    act(() => { viewport.height = 480; viewport.dispatchEvent(new Event('resize')) })
    expect(nav).not.toHaveAttribute('hidden')
  })

  it('shows useful home actions without fake statistics when the server is unavailable', () => {
    render(wrap(<NativeHome heroPrimary={{ to: '/post-alert', label: 'Report', tone: 'bg-red-600' }} stats={null} />))
    expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute('href', '/post-alert')
    expect(screen.getByRole('link', { name: /Neighbourhood help/ })).toHaveAttribute('href', '/help')
    expect(screen.queryByText('Active alerts')).not.toBeInTheDocument()
  })

  it('shows only the real counts supplied by the stats endpoint', () => {
    render(wrap(<NativeHome heroPrimary={{ to: '/volunteer', label: 'Respond', tone: 'bg-orange-500 text-black' }} stats={{ active_alerts: 7, critical_open: 2 }} />))
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('opens the dialer deliberately, traps focus and restores focus on Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Open numbers</button><EmergencyDialer native open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} /></>
    }
    const user = userEvent.setup()
    render(wrap(<Harness />))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="tel:"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open numbers' }))
    const dialog = screen.getByRole('dialog')
    expect(document.body.style.overflow).toBe('hidden')
    const close = within(dialog).getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toHaveAttribute('href', 'tel:1098')
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(close).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('button', { name: 'Open numbers' })).toHaveFocus()
  })
})
