import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '../utils/i18n'
import Profile from './Profile'

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get, patch: mocks.patch } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }))

const volunteer = {
  name: 'Test volunteer', email: 'volunteer@example.com', role: 'volunteer',
  skills: ['cpr'], has_vehicle: true, emergency_contacts: [], phone: '',
  location: { coordinates: [76.7794, 30.7333] }, created_at: '2026-01-01T12:00:00Z',
}

describe('responsive profile settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation((path) => Promise.resolve({
      data: path.endsWith('/stats') ? { role: 'volunteer', accepted: 2, in_progress: 1, resolved: 1 } : volunteer,
    }))
    mocks.patch.mockResolvedValue({ data: { ...volunteer, phone: '1234567890' } })
  })

  it('groups the settings accessibly and exposes named volunteer controls', async () => {
    const { container } = render(<I18nProvider><Profile /></I18nProvider>)
    await screen.findByText('volunteer@example.com')
    expect(screen.getByRole('navigation', { name: 'Your profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CPR trained' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('checkbox', { name: 'I have a vehicle I can use' })).toBeChecked()
    expect(container.querySelector('#identity')).toBeInTheDocument()
    expect(container.querySelector('#location')).toBeInTheDocument()
    expect(container.querySelector('#contacts')).toBeInTheDocument()
    expect(container.querySelector('#activity')).toBeInTheDocument()
  })

  it('retains explicit saving and announces confirmation without automatic writes', async () => {
    render(<I18nProvider><Profile /></I18nProvider>)
    await screen.findByText('volunteer@example.com')
    expect(mocks.patch).not.toHaveBeenCalled()
    const phone = screen.getByRole('textbox', { name: 'Your phone number' })
    fireEvent.change(phone, { target: { value: '1234567890' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save number' }))
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/api/users/me/profile', { phone: '1234567890' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Phone number saved')
  })
})
