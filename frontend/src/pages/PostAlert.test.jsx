import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import PostAlert from './PostAlert'

const state = vi.hoisted(() => ({
  user: null,
  api: { get: vi.fn(), post: vi.fn() },
  toast: vi.fn(),
  enqueue: vi.fn(),
  pending: vi.fn(),
  accountId: vi.fn(),
  voice: {
    supported: true,
    native: false,
    listening: false,
    status: 'idle',
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  },
}))

vi.mock('../utils/api', () => ({ default: state.api }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: state.toast }) }))
vi.mock('../hooks/useVoice', () => ({ useVoice: () => state.voice }))
vi.mock('../utils/offlineQueue', () => ({
  OFFLINE_QUEUE_EVENT: 'test-offline-queue',
  enqueueAlert: state.enqueue,
  getCurrentAccountId: state.accountId,
  listPending: state.pending,
}))
vi.mock('../components/VoiceReportAssistant', () => ({ default: ({ onApply, onClose }) => (
  <section role="dialog" aria-label="Voice assistant">
    <button type="button" onClick={() => onApply({ category: 'fire', description: 'Smoke is coming from the building.' })}>Use reviewed draft</button>
    <button type="button" onClick={onClose}>Close assistant</button>
  </section>
) }))
vi.mock('../components/LiveCamera', () => ({ default: ({ onClose }) => (
  <section role="dialog" aria-label="Camera"><button type="button" onClick={onClose}>Close camera</button></section>
) }))

function LocationMarker() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

const mount = () => render(<MemoryRouter initialEntries={['/post-alert']}><I18nProvider><PostAlert /><LocationMarker /></I18nProvider></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.api.get.mockResolvedValue({ data: { address: 'Test sector' } })
  state.api.post.mockResolvedValue({ data: { id: 'test-alert' } })
  state.pending.mockResolvedValue([])
  state.enqueue.mockResolvedValue(undefined)
  state.accountId.mockReturnValue('test-account')
  navigator.geolocation.getCurrentPosition.mockImplementation((onSuccess) => onSuccess({
    coords: { latitude: 30.7333, longitude: 76.7794 },
  }))
})

describe('simple responsive report form', () => {
  it('offers every category in a native picker and retains visible voice privacy disclosures', async () => {
    const user = userEvent.setup()
    mount()
    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category).toHaveClass('app-field')
    expect(within(category).getAllByRole('option')).toHaveLength(12)
    expect(within(category).getAllByRole('option').map((option) => option.value)).toEqual([
      'medical', 'fire', 'flood', 'accident', 'missing', 'violence', 'animal', 'gas', 'power', 'water', 'structure', 'other',
    ])
    await user.selectOptions(category, 'gas')
    expect(category).toHaveValue('gas')
    expect(screen.getByRole('textbox', { name: /^Description/ })).toHaveClass('app-field')
    expect(screen.getByText(/Your browser sends the audio/)).toBeVisible()
    expect(screen.getByText(/a recording of your voice can identify you/)).toBeVisible()
    expect(state.voice.start).not.toHaveBeenCalled()
  })

  it('posts the selected category anonymously and keeps the public alert destination', async () => {
    const user = userEvent.setup()
    mount()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'fire')
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'Smoke is coming from the building.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    await waitFor(() => expect(state.api.post).toHaveBeenCalledWith('/api/alerts/anonymous', expect.objectContaining({
      category: 'fire',
      description: 'Smoke is coming from the building.',
      location: { type: 'Point', coordinates: [76.7794, 30.7333] },
    }), { skipAuth: true, headers: {} }))
    expect(screen.getByTestId('current-route')).toHaveTextContent('/alert/test-alert')
  })

  it('wraps the location retry and still blocks submission without a real location fix', async () => {
    const user = userEvent.setup()
    navigator.geolocation.getCurrentPosition.mockImplementation((_onSuccess, onError) => onError({ message: 'Location unavailable' }))
    const { container } = mount()
    expect(screen.getByRole('button', { name: 'Post Alert Now' })).toBeDisabled()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toHaveClass('app-secondary-button')
    expect(retry.parentElement).toHaveClass('flex-wrap')
    await user.click(retry)
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByRole('textbox', { name: /^Description/ }), { target: { value: 'A person needs urgent medical help.' } })
    fireEvent.submit(container.querySelector('form'))
    expect(state.api.post).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('set your real location')
  })

  it('preserves reviewed voice drafts and camera access as secondary actions', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Speak' }))
    expect(state.voice.start).toHaveBeenCalledOnce()
    const assistantButton = screen.getByRole('button', { name: 'Report by voice' })
    expect(assistantButton).toHaveClass('app-secondary-button')
    await user.click(assistantButton)
    expect(state.voice.cancel).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Use reviewed draft' }))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('fire')
    expect(screen.getByRole('textbox', { name: /^Description/ })).toHaveValue('Smoke is coming from the building.')
    expect(screen.queryByRole('dialog', { name: 'Voice assistant' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Take photo/i }))
    expect(screen.getByRole('dialog', { name: 'Camera' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close camera' }))
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument()
  })

  it('still queues an anonymous report on network failure without account data', async () => {
    const user = userEvent.setup()
    state.api.post.mockRejectedValue({ code: 'ERR_NETWORK' })
    mount()
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'Smoke is coming from the building.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Smoke is coming from the building.',
    }), { anonymous: true, accountId: null }))
    expect(state.accountId).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved offline' }))
    expect(screen.getByTestId('current-route')).toHaveTextContent('/')
  })

  it('retains signed-in practice drills and authenticated report ownership', async () => {
    const user = userEvent.setup()
    state.user = { id: 'test-account', role: 'reporter' }
    localStorage.setItem('token', 'test-auth-token')
    mount()
    await user.click(screen.getByRole('checkbox', { name: /This is a practice drill/ }))
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'A person needs urgent medical help.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    await waitFor(() => expect(state.api.post).toHaveBeenCalledWith('/api/alerts/', expect.objectContaining({
      is_drill: true,
    }), { skipAuth: false, headers: { Authorization: 'Bearer test-auth-token' } }))
    expect(screen.getByTestId('current-route')).toHaveTextContent('/my-alerts')
  })
})
