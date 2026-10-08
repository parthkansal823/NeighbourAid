import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '../utils/i18n'
import NotificationReadiness from './NotificationReadiness'
const platform = vi.hoisted(() => ({ native: false }))
vi.mock('../utils/runtime', () => ({ isNativeApp: () => platform.native }))
beforeEach(() => { platform.native = false })

const defaults = {
  connected: true,
  permission: 'default',
  pushSupported: true,
  pushEnabled: false,
  busy: false,
  result: 'idle',
  onEnable: vi.fn(),
  onDisable: vi.fn(),
}

function renderReadiness(overrides = {}) {
  return render(<I18nProvider><NotificationReadiness {...defaults} {...overrides} /></I18nProvider>)
}

describe('NotificationReadiness', () => {
  it('offers an explicit enable action when background delivery is available', async () => {
    const onEnable = vi.fn()
    renderReadiness({ onEnable })
    expect(screen.getByRole('heading', { name: 'Stay reachable for nearby emergencies' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }))
    expect(onEnable).toHaveBeenCalledOnce()
  })

  it('names the ready state and gives the person a reversible control', async () => {
    const onDisable = vi.fn()
    renderReadiness({ pushEnabled: true, onDisable })
    expect(screen.getByRole('heading', { name: 'Browser push subscription active' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /turn off background alerts/i }))
    expect(onDisable).toHaveBeenCalledOnce()
  })

  it('does not promise background delivery when permission is blocked', () => {
    renderReadiness({ permission: 'denied' })
    expect(screen.getByRole('heading', { name: 'Notifications are blocked' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()
  })

  it('makes a failed setup retryable', () => {
    renderReadiness({ result: 'failed' })
    expect(screen.getByRole('heading', { name: 'Could not enable background alerts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows an unsuccessful turn-off result and preserves the retry control', () => {
    renderReadiness({ pushEnabled: true, result: 'unsubscribe-failed' })
    expect(screen.getByRole('heading', { name: 'Could not turn off background alerts' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Browser push subscription active' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /turn off background alerts/i })).toBeEnabled()
  })

  it('explains the foreground-only fallback on unsupported devices', () => {
    renderReadiness({ pushSupported: false, permission: 'unsupported' })
    expect(screen.getByRole('heading', { name: 'Live alerts while this app is open' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()
  })
  it('keeps a reconnecting live feed distinct from enabled background notifications', () => {
    renderReadiness({ connected: false, pushEnabled: true })
    expect(screen.getByRole('heading', { name: 'Browser push subscription active' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting')
  })

  it('disables notification changes while the explicit request is pending', () => {
    renderReadiness({ busy: true })
    expect(screen.getByRole('button', { name: 'Enabling…' })).toBeDisabled()
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')
  })
  it('never claims native emergency push delivery because browser PushManager happens to exist', () => {
    platform.native = true
    renderReadiness({ pushSupported: true, pushEnabled: true, permission: 'granted', result: 'ready' })
    expect(screen.getByRole('heading', { name: 'Live alerts while this app is open' })).toBeInTheDocument()
    expect(screen.getByText(/Local update notices are separate/)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('gives revoked permission priority over a retained subscription', () => {
    renderReadiness({ permission: 'denied', pushEnabled: true, result: 'ready' })
    expect(screen.getByRole('heading', { name: 'Notifications are blocked' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Browser push subscription active' })).not.toBeInTheDocument()
  })
})
