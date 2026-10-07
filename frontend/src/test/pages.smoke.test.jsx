/** Render every route in both shells with a memory-only API. No real calls. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { createDemoAdapter } from '../demo/mockApi'

const mocks = vi.hoisted(() => ({ native: false, user: null, adapter: null }))
vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: mocks.user, token: 'synthetic-test-token', logout: vi.fn(), login: vi.fn() }),
}))
vi.mock('../utils/runtime', () => ({
  isNativeApp: () => mocks.native,
  apiUrl: (path) => path,
  websocketOrigin: () => 'ws://example.invalid',
}))
vi.mock('../utils/api', () => ({ default: {
  get: (url, config) => mocks.adapter({ method: 'get', url, ...config }),
  post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
} }))
vi.mock('../components/AppUpdateNotice', () => ({ default: () => null }))
vi.mock('../hooks/useServerStatus', () => ({ useServerStatus: () => ({ state: 'online' }) }))
vi.mock('../hooks/useWebSocket', () => ({ useVolunteerSocket: () => undefined }))
vi.mock('../components/MapView', () => ({ default: () => <div data-testid="map-surface" /> }))
vi.mock('../utils/offlineQueue', async (original) => ({ ...(await original()), listPending: async () => [] }))

beforeEach(() => { mocks.adapter = createDemoAdapter(); mocks.user = null })

const pages = [
  ['/', null, /Your neighbour needs help/],
  ['/login', null, /Welcome back/],
  ['/register', null, /Create account/],
  ['/post-alert', null, /Report a Crisis/],
  ['/map', null, null],
  ['/help', null, /Neighbourhood help/],
  ['/safety', null, /Safety Check-ins/],
  ['/resources', null, /Community Resources/],
  ['/news', null, /Crisis news/],
  ['/my-alerts', 'reporter', /My Alerts/],
  ['/volunteer', 'volunteer', /Volunteer Feed/],
  ['/profile', 'volunteer', /Your profile/],
  ['/alert/demo-alert-01', null, /^medical$/i],
]

describe.each([false, true])('page smoke, native=%s', (native) => {
  it.each(pages)('renders %s with an accessible main region', async (path, role, heading) => {
    mocks.native = native
    mocks.user = role ? { id: 'demo-volunteer-1', role, name: 'Synthetic tester' } : null
    window.history.replaceState({}, '', path)
    const { container } = render(<App />)
    if (heading) expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    else if (path === '/map') expect(await screen.findByTestId('map-surface')).toBeInTheDocument()
    else await waitFor(() => expect(container.querySelector('#main-content h1')).not.toBeNull())
    expect(container.querySelector('#main-content')).toBeInTheDocument()
    expect(container.querySelector('.native-app') !== null).toBe(native)
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
    expect(container.querySelector('a[href="/"]')).toBeInTheDocument()
  })
})
