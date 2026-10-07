import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '../utils/i18n'
import NotificationReadiness from './NotificationReadiness'

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
    expect(screen.getByRole('heading', { name: 'Background alerts are ready' })).toBeInTheDocument()
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
    expect(screen.queryByRole('heading', { name: 'Background alerts are ready' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /turn off background alerts/i })).toBeEnabled()
  })

  it('explains the foreground-only fallback on unsupported devices', () => {
    renderReadiness({ pushSupported: false, permission: 'unsupported' })
    expect(screen.getByRole('heading', { name: 'Live alerts are active in this app' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()
  })
})
