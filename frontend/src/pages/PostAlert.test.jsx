import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import PostAlert from './PostAlert'
import { allowScreenNavigation } from '../utils/androidBack'

const state = vi.hoisted(() => ({
  user: null,
  api: { get: vi.fn(), post: vi.fn() },
  toast: vi.fn(),
  enqueue: vi.fn(),
  complete: vi.fn(),
  background: vi.fn(),
  review: vi.fn(),
  cancelPending: vi.fn(),
  pending: vi.fn(),
  accountId: vi.fn(),
  compress: vi.fn(),
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
vi.mock('../utils/photo', () => ({ compressImage: state.compress, approxKb: () => 1 }))
vi.mock('../utils/offlineQueue', () => ({
  OFFLINE_QUEUE_EVENT: 'test-offline-queue',
  enqueueAlert: state.enqueue,
  completeDelivery: state.complete,
  requestBackgroundFlush: state.background,
  markPendingForReview: state.review,
  cancelPending: state.cancelPending,
  needsDeliveryReview: error => [400, 403, 422].includes(error?.response?.status),
  getCurrentAccountId: state.accountId,
  listPending: state.pending,
}))
vi.mock('../components/VoiceReportAssistant', () => ({ default: ({ onApply, onClose }) => (
  <section role="dialog" aria-label="Voice assistant">
    <button type="button" onClick={() => onApply({ category: 'fire', description: 'Smoke is coming from the building.' })}>Use reviewed draft</button>
    <button type="button" onClick={onClose}>Close assistant</button>
  </section>
) }))
vi.mock('../components/LiveCamera', () => ({ default: ({ onClose, onCapture }) => (
  <section role="dialog" aria-label="Camera"><button type="button" onClick={onClose}>Close camera</button><button type="button" onClick={() => onCapture('data:image/jpeg;base64,FAKE')}>Capture test photo</button></section>
) }))

function LocationMarker() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

const mount = () => render(<MemoryRouter initialEntries={['/post-alert']}><I18nProvider><PostAlert /><LocationMarker /></I18nProvider></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.voice.listening = false
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  state.api.get.mockResolvedValue({ data: { address: 'Test sector' } })
  state.api.post.mockResolvedValue({ data: { id: 'test-alert' } })
  state.pending.mockResolvedValue([])
  state.enqueue.mockResolvedValue(12)
  state.complete.mockResolvedValue(undefined)
  state.review.mockResolvedValue(undefined)
  state.accountId.mockReturnValue('test-account')
  state.compress.mockResolvedValue('data:image/jpeg;base64,COMPRESSED')
  navigator.geolocation.getCurrentPosition.mockImplementation((onSuccess) => onSuccess({
    coords: { latitude: 30.7333, longitude: 76.7794 },
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
    }), { skipAuth: true, headers: { 'X-Anonymous-Client-ID': expect.any(String) } }))
    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent('/alert/test-alert'))
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
    }), { anonymous: true, accountId: null, anonymousClientId: expect.any(String), requestSync: false }))
    expect(state.accountId).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved offline' }))
    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent(/^\/$/))
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
    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent('/my-alerts'))
  })
})

describe('report navigation protection', () => {
  it('allows leaving an untouched form without prompting for its automatic GPS fix', () => {
    mount()
    expect(allowScreenNavigation()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('keeps the current draft when leaving is cancelled and allows an explicit discard', async () => {
    const user = userEvent.setup()
    const view = mount()
    const description = screen.getByRole('textbox', { name: /^Description/ })
    await user.type(description, 'A person needs urgent medical help.')
    expect(allowScreenNavigation()).toBe(false)
    expect(window.confirm).toHaveBeenCalledWith('This report has not been sent. Leave this screen and discard your changes?')
    expect(description).toHaveValue('A person needs urgent medical help.')
    window.confirm.mockReturnValue(true)
    expect(allowScreenNavigation()).toBe(true)
    view.unmount()
    expect(allowScreenNavigation()).toBe(true)
  })

  it('protects changed category, practice drill, and active voice input even before text', async () => {
    const user = userEvent.setup()
    state.user = { id: 'test-account', role: 'reporter' }
    const view = mount()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'fire')
    expect(allowScreenNavigation()).toBe(false)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'medical')
    expect(allowScreenNavigation()).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: /This is a practice drill/ }))
    expect(allowScreenNavigation()).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: /This is a practice drill/ }))
    state.voice.listening = true
    view.rerender(<MemoryRouter initialEntries={['/post-alert']}><I18nProvider><PostAlert /><LocationMarker /></I18nProvider></MemoryRouter>)
    expect(allowScreenNavigation()).toBe(false)
  })

  it('blocks leaving while submitting without offering to discard an in-flight report', async () => {
    const user = userEvent.setup()
    let resolve
    state.api.post.mockImplementation(() => new Promise(done => { resolve = done }))
    mount()
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'A person needs urgent medical help.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    window.confirm.mockReturnValue(true)
    expect(allowScreenNavigation()).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()
    await act(async () => { resolve({ data: { id: 'accepted-alert' } }) })
    expect(screen.getByTestId('current-route')).toHaveTextContent('/alert/accepted-alert')
    expect(allowScreenNavigation()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('returns to the discard confirmation after a server rejects an unsent report', async () => {
    const user = userEvent.setup()
    state.api.post.mockRejectedValue({ response: { status: 400, data: { detail: 'Invalid report' } } })
    mount()
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'A person needs urgent medical help.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid report'))
    expect(allowScreenNavigation()).toBe(false)
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(screen.getByTestId('current-route')).toHaveTextContent('/post-alert')
  })

  it('does not prompt to discard a report already saved to the offline queue', async () => {
    const user = userEvent.setup()
    state.api.post.mockRejectedValue({ code: 'ERR_NETWORK' })
    mount()
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'A person needs urgent medical help.')
    await user.click(screen.getByRole('button', { name: 'Post Alert Now' }))
    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent(/^\/$/))
    expect(allowScreenNavigation()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('blocks leaving during photo processing, then protects the attached photo draft', async () => {
    const user = userEvent.setup()
    let resolve
    state.compress.mockImplementation(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['synthetic'], { type: 'image/jpeg' }) }))
    mount()
    await user.click(screen.getByRole('button', { name: /Take photo/i }))
    await user.click(screen.getByRole('button', { name: 'Capture test photo' }))
    await waitFor(() => expect(state.compress).toHaveBeenCalledOnce())
    expect(allowScreenNavigation()).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()
    await act(async () => { resolve('data:image/jpeg;base64,COMPRESSED') })
    expect(allowScreenNavigation()).toBe(false)
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument()
  })
})
