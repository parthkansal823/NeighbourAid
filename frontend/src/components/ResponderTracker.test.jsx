import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../utils/i18n'
import ResponderTracker, { positionState } from './ResponderTracker'

const mocks = vi.hoisted(() => ({ get: vi.fn(), user: { id: 'reporter' } }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="tracker-map">{children}</div>,
  // Real Leaflet tooltips live in a separate pane, not inside the icon.
  Marker: ({ children, position, title, alt, keyboard }) => <div role="button" tabIndex={keyboard ? 0 : -1} title={title} data-alt={alt} data-testid="marker" data-position={JSON.stringify(position)}><span aria-hidden>{children}</span></div>,
  TileLayer: () => null, Tooltip: ({ children }) => <span>{children}</span>,
}))
const now = Date.parse('2026-10-08T00:00:00Z')
const snapshot = {
  responder_name: 'Synthetic volunteer', coordinates: [77, 29], position_state: 'live', sharing_enabled: true,
  sharing_expires_at: '2026-10-08T00:30:00Z', position_updated_at: '2026-10-08T00:00:00Z', position_accuracy_m: null, freshness_seconds: 90,
}
const alert = { id: 'incident', status: 'accepted', accepted_by: 'lead', location: { coordinates: [76, 28] } }
const mount = () => render(<I18nProvider><ResponderTracker alert={alert} /></I18nProvider>)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); mocks.get.mockReset().mockResolvedValue({ data: snapshot }); mocks.user = { id: 'reporter' } })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('responder location consent and freshness', () => {
  it.each([
    [{ sharing_enabled: false }, 'disabled'],
    [{ sharing_expires_at: '2026-10-07T00:00:00Z' }, 'disabled'],
    [{ position_updated_at: '2026-10-07T23:58:30Z' }, 'stale'],
    [{ position_updated_at: null }, 'unavailable'],
    [{ position_state: 'unavailable' }, 'unavailable'],
    [{ coordinates: [1000, 1000] }, 'unavailable'],
    [{ position_updated_at: '2026-10-08T00:01:00Z' }, 'unavailable'],
  ])('never describes an unconsented or unknown snapshot %o as live', (change, expected) => {
    expect(positionState({ ...snapshot, ...change }, now)).toBe(expected)
  })
  it('renders only fresh consented coordinates and never fabricates accuracy', async () => {
    mount()
    await act(async () => {})
    expect(screen.getByText('Fresh position shared with consent.')).toBeVisible()
    expect(screen.getByText(/accuracy not reported/)).toBeInTheDocument()
    expect(screen.getByTestId('tracker-map')).toBeInTheDocument()
    expect(screen.getAllByTestId('marker').map(node => node.dataset.position)).toEqual(['[28,76]', '[29,77]'])
    for (const name of ['Reported incident location', "Volunteer's live shared location"]) {
      const marker = screen.getByRole('button', { name })
      expect(marker).toHaveAttribute('tabindex', '0')
      expect(marker).toHaveAttribute('title', name)
      expect(marker).toHaveAttribute('data-alt', name)
    }
    await act(async () => { vi.advanceTimersByTime(90001) })
    expect(screen.queryByTestId('tracker-map')).not.toBeInTheDocument()
    expect(screen.getByText(/position is stale/)).toBeVisible()
  })
  it('never uses the saved home position or legacy live boolean without explicit consent', async () => {
    mocks.get.mockResolvedValue({ data: { coordinates: [77, 29], live: true, responder_name: 'Legacy response' } })
    mount()
    await act(async () => {})
    expect(screen.queryByTestId('tracker-map')).not.toBeInTheDocument()
    expect(screen.getByText(/sharing is off or has expired/)).toBeVisible()
  })
  it('keeps map tiles optional in text-first mode', async () => {
    localStorage.setItem('neighbouraid:text-first', '1')
    mount()
    await act(async () => {})
    expect(screen.queryByTestId('tracker-map')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load responder map' }))
    expect(screen.getByTestId('tracker-map')).toBeVisible()
  })
  it('clears the old snapshot on a failed refresh and stops polling after unmount', async () => {
    const view = mount()
    await act(async () => {})
    mocks.get.mockRejectedValue(new Error('Offline'))
    await act(async () => { vi.advanceTimersByTime(8000) })
    expect(screen.queryByTestId('tracker-map')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No position is shown')
    view.unmount()
    const count = mocks.get.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(mocks.get).toHaveBeenCalledTimes(count)
  })
})
