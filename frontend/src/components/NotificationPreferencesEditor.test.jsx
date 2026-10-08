import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '../utils/i18n'
import NotificationPreferencesEditor, { DEFAULT_NOTIFICATION_PREFERENCES } from './NotificationPreferencesEditor'

const mocks = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('../utils/api', () => ({ default: { patch: mocks.patch } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.patch.mockImplementation(async (_path, payload) => ({ data: { notification_preferences: payload.notification_preferences } }))
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { vi.restoreAllMocks() })
const mount = props => render(<I18nProvider><NotificationPreferencesEditor {...props} /></I18nProvider>)
describe('explicit account notification filters', () => {
  it('uses server-compatible defaults without requesting OS permission or saving automatically', () => {
    mount()
    expect(screen.getByRole('checkbox', { name: /Show detailed browser push previews/ })).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Maximum matching radius (km)' })).toHaveValue(25)
    expect(screen.getByText(/do not enable phone permissions/)).toBeVisible()
    expect(mocks.patch).not.toHaveBeenCalled()
  })
  it('requires explicit consent for detailed lock-screen previews, and can turn them back off', () => {
    mount()
    const preview = screen.getByRole('checkbox', { name: /Show detailed browser push previews/ })
    fireEvent.click(preview)
    expect(preview).not.toBeChecked()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Anyone who can see your lock screen'))
    window.confirm.mockReturnValue(true)
    fireEvent.click(preview)
    expect(preview).toBeChecked()
    fireEvent.click(preview)
    expect(preview).not.toBeChecked()
    expect(window.confirm).toHaveBeenCalledTimes(2)
    expect(mocks.patch).not.toHaveBeenCalled()
  })
  it('saves one bounded account preference payload only after Save', async () => {
    const user = userEvent.setup(), onSaved = vi.fn()
    mount({ onSaved })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum matching radius (km)' }), { target: { value: '10' } })
    await user.click(screen.getByRole('checkbox', { name: /^fire$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Use my registered skills/ }))
    expect(mocks.patch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save notification preferences' }))
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/api/users/me/profile', { notification_preferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES, categories: ['fire'], skill_matching: false, radius_km: 10,
    } }))
    expect(onSaved).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('does not enable device permissions or guarantee delivery')
  })
  it('does not send invalid radius or claim a failed server write was saved', async () => {
    mount()
    const radius = screen.getByRole('spinbutton', { name: 'Maximum matching radius (km)' })
    fireEvent.change(radius, { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }))
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 25')
    expect(mocks.patch).not.toHaveBeenCalled()
    fireEvent.change(radius, { target: { value: '15' } })
    mocks.patch.mockRejectedValue({ response: { data: { detail: 'Preference save failed' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Preference save failed')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
