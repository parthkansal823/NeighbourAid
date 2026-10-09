import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import { I18nProvider } from '../utils/i18n'
import { createDemoAdapter } from '../demo/mockApi'
import * as geo from '../utils/geo'
import VolunteerFeed from './VolunteerFeed'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'volunteer-1', role: 'volunteer' }, token: 'test-token' },
  get: vi.fn(), socket: vi.fn(), toast: vi.fn(), notify: vi.fn(), speak: vi.fn(),
  notifications: {}, unsubscribe: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get } }))
vi.mock('../hooks/useWebSocket', () => ({ useVolunteerSocket: mocks.socket }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: mocks.toast }) }))
vi.mock('../components/RelayInbox', () => ({ default: () => null }))
vi.mock('../hooks/useNotifications', () => ({
  useNotifications: () => ({ permission: 'granted', pushSupported: false, notify: mocks.notify, ...mocks.notifications }),
}))
vi.mock('../hooks/useVoiceAlert', () => ({
  useVoiceAlert: () => ({ supported: false, speak: mocks.speak }),
  ttsLocaleFor: () => 'en-IN',
}))
// Exercise the feed's real onUpdate path without unrelated card resource fetches.
vi.mock('../components/AlertCard', () => ({
  default: ({ alert, onUpdate }) => (
    <article data-testid={`card-${alert.id}`}>
      <p>{alert.description}</p>
      <button type="button" onClick={() => onUpdate({ ...alert, status: 'accepted', accepted_by: 'volunteer-1' })}>
        Accept {alert.id}
      </button>
      <button type="button" onClick={() => onUpdate({ ...alert, status: 'resolved' })}>
        Resolve {alert.id}
      </button>
    </article>
  ),
}))

const rows = [
  { id: 'open', category: 'power', urgency: 'LOW', status: 'open', description: 'Street lights out', address: 'Park gate' },
  { id: 'mine', category: 'flood', urgency: 'HIGH', status: 'accepted', accepted_by: 'volunteer-1', description: 'Kitchen water rising' },
  { id: 'other', category: 'flood', urgency: 'HIGH', status: 'accepted', accepted_by: 'volunteer-2', description: 'Another task' },
  { id: 'unassigned', category: 'flood', urgency: 'HIGH', status: 'accepted', description: 'Unassigned task' },
  { id: 'critical-open', category: 'medical', urgency: 'CRITICAL', status: 'open', description: 'Emergency at station' },
  { id: 'critical-mine', category: 'fire', urgency: 'CRITICAL', status: 'accepted', accepted_by: 'volunteer-1', description: 'Emergency in building' },
  { id: 'critical-other', category: 'accident', urgency: 'CRITICAL', status: 'accepted', accepted_by: 'volunteer-2', description: 'Emergency on road' },
  { id: 'resolved', category: 'medical', urgency: 'CRITICAL', status: 'resolved', description: 'Old emergency' },
]
const cardIds = () => screen.queryAllByTestId(/^card-/).map((card) => card.getAttribute('data-testid').slice(5)).sort()
const socketOptions = () => mocks.socket.mock.calls.at(-1)[0]
const defaultGeolocation = {
  getCurrentPosition: navigator.geolocation.getCurrentPosition.getMockImplementation(),
  watchPosition: navigator.geolocation.watchPosition.getMockImplementation(),
}

function mount() {
  return render(<MemoryRouter><I18nProvider><VolunteerFeed /></I18nProvider></MemoryRouter>)
}

async function loaded() {
  await screen.findByRole('searchbox', { name: 'Search alerts' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth = { user: { id: 'volunteer-1', role: 'volunteer' }, token: 'test-token' }
  mocks.notifications = {}
  mocks.unsubscribe.mockReset()
  mocks.get.mockReset().mockResolvedValue({ data: rows.map((row) => ({ ...row })) })
})

afterEach(() => {
  vi.restoreAllMocks()
  // The shared setup uses vi.fn: restoring spies does not restore an
  // implementation replaced on one of those existing mocks.
  navigator.geolocation.getCurrentPosition.mockImplementation(defaultGeolocation.getCurrentPosition)
  navigator.geolocation.watchPosition.mockImplementation(defaultGeolocation.watchPosition)
})

describe('VolunteerFeed location recovery', () => {
  it('renders the feed at the recovered coordinates after an initial GPS timeout', async () => {
    vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_success, onError) => onError({ code: 3 }))
    const watch = vi.spyOn(navigator.geolocation, 'watchPosition').mockReturnValue(17)
    mount()

    expect(screen.getByText('Location needed')).toBeInTheDocument()
    expect(screen.getByText(/Could not read your location/)).toBeInTheDocument()
    expect(mocks.get).not.toHaveBeenCalled()

    const onPosition = watch.mock.calls[0][0]
    await act(async () => onPosition({ coords: { longitude: 77.209, latitude: 28.6139 } }))

    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/nearby', { params: { lat: 28.6139, lng: 77.209, km: 10 } })
    expect(screen.queryByText('Location needed')).not.toBeInTheDocument()
    expect(screen.queryByText(/Could not read your location/)).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toBeInTheDocument()
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'mine', 'open'])
  })

  it('keeps the location error when both the initial request and watch fail', () => {
    vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_success, onError) => onError({ code: 2 }))
    vi.spyOn(navigator.geolocation, 'watchPosition').mockImplementation((_success, onError) => {
      onError({ code: 2 })
      return 18
    })
    mount()

    expect(screen.getByText('Location needed')).toBeInTheDocument()
    expect(screen.getByText(/Could not read your location, so nearby alerts cannot be found/)).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(socketOptions().coordinates).toBeNull()
  })

  it('preserves the unavailable-GPS message when the browser has no geolocation support', () => {
    vi.spyOn(geo, 'GEOLOCATION_SUPPORTED', 'get').mockReturnValue(false)
    mount()

    expect(screen.getByText('Location needed')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(geo.GEO_UNSUPPORTED_MESSAGE))).toBeInTheDocument()
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(socketOptions().coordinates).toBeNull()
  })
})

describe('VolunteerFeed push controls', () => {
  it('shows a failure and keeps the turn-off action available when unregistering fails', async () => {
    mocks.notifications = { pushSupported: true, pushEnabled: true, unsubscribe: mocks.unsubscribe }
    mocks.unsubscribe.mockResolvedValue('failed')
    mount()
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: /turn off background alerts/i }))
    expect(screen.getByRole('heading', { name: 'Could not turn off background alerts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /turn off background alerts/i })).toBeEnabled()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Could not turn off background alerts' }))
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Background alerts turned off' }))
  })
})

describe('VolunteerFeed discovery controls', () => {
  it('renders counts, labelled controls and every active critical alert once', async () => {
    mount()
    await loaded()
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'mine', 'open'])
    expect(screen.getByText('5 of 5 alerts shown')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Show alerts' })).toHaveValue('all')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
    expect(screen.getByText('Critical alerts stay visible')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveAccessibleDescription('Critical alerts stay visible')
    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/nearby', { params: { lat: 30.7333, lng: 76.7794, km: 10 } })
  })

  it('combines search and My accepted, preserves critical alerts and resets both controls', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.selectOptions(screen.getByRole('combobox'), 'mine')
    await user.type(screen.getByRole('searchbox'), 'Kitchen')
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'mine'])
    expect(screen.getByText('4 of 5 alerts shown')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'no matching words')
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other'])
    expect(screen.queryByText('No matching alerts')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('combobox')).toHaveValue('all')
    expect(screen.getByText('5 of 5 alerts shown')).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('keeps critical accepted tasks in Open and reacts to acceptance/resolution from cards', async () => {
    const user = userEvent.setup()
    mount()
    await loaded()
    await user.selectOptions(screen.getByRole('combobox'), 'open')
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'open'])
    await user.click(screen.getByRole('button', { name: 'Accept open' }))
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other'])
    await user.click(screen.getByRole('button', { name: 'Accept critical-open' }))
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other'])
    await user.click(screen.getByRole('button', { name: 'Resolve critical-open' }))
    expect(cardIds()).toEqual(['critical-mine', 'critical-other'])
    expect(screen.getByText('2 of 4 alerts shown')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'mine')
    expect(cardIds()).toEqual(['critical-mine', 'critical-other', 'mine', 'open'])
  })

  it('uses only the current account for noncritical accepted tasks after an account change', async () => {
    const view = mount()
    await loaded()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mine' } })
    mocks.auth = { user: { id: 'volunteer-2', role: 'volunteer' }, token: 'other-token' }
    view.rerender(<MemoryRouter><I18nProvider><VolunteerFeed /></I18nProvider></MemoryRouter>)
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'other'])
    mocks.auth = { user: null, token: null }
    view.rerender(<MemoryRouter><I18nProvider><VolunteerFeed /></I18nProvider></MemoryRouter>)
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other'])
    expect(screen.queryByTestId('card-unassigned')).not.toBeInTheDocument()
  })

  it('shows a useful no-match state and clears back to the unfiltered list', async () => {
    const user = userEvent.setup()
    mocks.get.mockResolvedValue({ data: [rows[0]] })
    mount()
    await loaded()
    await user.selectOptions(screen.getByRole('combobox'), 'mine')
    expect(screen.getByText('No matching alerts')).toBeInTheDocument()
    expect(screen.getByText('Try another search or clear the filters.')).toBeInTheDocument()
    expect(screen.getByText('0 of 1 alerts shown')).toBeInTheDocument()
    expect(screen.queryByText('No open alerts nearby. Stay ready.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(cardIds()).toEqual(['open'])
  })

  it('preserves the original no-alert state when no filters are selected', async () => {
    mocks.get.mockResolvedValue({ data: [] })
    mount()
    await loaded()
    expect(screen.getByText('No open alerts nearby. Stay ready.')).toBeInTheDocument()
    expect(screen.getByText('0 of 0 alerts shown')).toBeInTheDocument()
    expect(screen.queryByText('No matching alerts')).not.toBeInTheDocument()
  })

  it('notifies all urgencies while search and My accepted are hiding ordinary arrivals', async () => {
    mount()
    await loaded()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mine' } })
    const onAlert = socketOptions().onAlert
    for (const urgency of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      await act(async () => onAlert({ id: `new-${urgency}`, urgency, status: 'open', category: 'medical', description: 'New report' }))
    }
    expect(mocks.notify).toHaveBeenCalledTimes(4)
    expect(mocks.toast).toHaveBeenCalledTimes(4)
    expect(mocks.speak).toHaveBeenCalledTimes(1)
    for (const urgency of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
        title: `${urgency} · medical`, requireInteraction: urgency === 'CRITICAL',
      }))
    }
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other', 'new-CRITICAL'])
    expect(socketOptions().onAlert).toBe(onAlert)
    await act(async () => onAlert({ ...rows[6], status: 'resolved' }))
    expect(screen.queryByTestId('card-critical-other')).not.toBeInTheDocument()
    expect(mocks.notify).toHaveBeenCalledTimes(4)
  })

  it('uses the same screen and controls with the demo API', async () => {
    mocks.auth = { user: { id: 'demo-volunteer-1', role: 'volunteer' }, token: 'demo-token' }
    const adapter = createDemoAdapter({ alerts: rows.map((row) => ({ ...row })) })
    mocks.get.mockImplementation((url, config) => adapter({ url, ...config }))
    mount()
    await loaded()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mine' } })
    expect(cardIds()).toEqual(['critical-mine', 'critical-open', 'critical-other'])
    expect(screen.getByText('3 of 4 alerts shown')).toBeInTheDocument()
  })

  it('reveals a hidden alert immediately when a live update upgrades it to critical', async () => {
    mount()
    await loaded()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mine' } })
    expect(screen.queryByTestId('card-open')).not.toBeInTheDocument()
    const onAlert = socketOptions().onAlert
    await act(async () => onAlert({ ...rows[0], urgency: 'CRITICAL' }))
    expect(screen.getAllByTestId('card-open')).toHaveLength(1)
    expect(screen.getByText('4 of 5 alerts shown')).toBeInTheDocument()
    await act(async () => onAlert({ ...rows[0], urgency: 'CRITICAL', status: 'accepted', accepted_by: 'volunteer-2' }))
    expect(screen.getAllByTestId('card-open')).toHaveLength(1)
    await act(async () => onAlert(rows[0]))
    expect(screen.queryByTestId('card-open')).not.toBeInTheDocument()
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('removes a live card when the server sends a review restriction frame', async () => {
    mount()
    await loaded()
    expect(screen.getByTestId('card-open')).toBeInTheDocument()
    const onAlert = socketOptions().onAlert
    await act(async () => onAlert({ type: 'alert_restricted', id: 'open', review_status: 'restricted' }))
    expect(screen.queryByTestId('card-open')).not.toBeInTheDocument()
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('localizes controls, counts and category search through the real provider', async () => {
    localStorage.setItem('lang', 'hi')
    mocks.get.mockResolvedValue({ data: [{ ...rows[0], category: 'medical' }] })
    mount()
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'अलर्ट खोजें' })).toBeInTheDocument())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'चिकित्सा' } })
    expect(cardIds()).toEqual(['open'])
    expect(screen.getByText('1 में से 1 अलर्ट दिखाए गए')).toBeInTheDocument()
    expect(screen.getByText('गंभीर अलर्ट हमेशा दिखाई देते हैं')).toBeInTheDocument()
  })

  it('gives search and view controls valid accessible labels and descriptions', async () => {
    const { container } = mount()
    await loaded()
    const result = await axe(container, { runOnly: { type: 'rule', values: ['label', 'select-name', 'aria-valid-attr-value', 'aria-allowed-attr'] } })
    expect(result.violations).toEqual([])
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Critical alerts stay visible')
  })
})
