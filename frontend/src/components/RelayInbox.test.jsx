import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RelayInbox from './RelayInbox'

const mocks = vi.hoisted(() => ({ auth: {}, get: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get } }))
vi.mock('./HelpRelay', () => ({ default: ({ alert }) => <div data-testid="relay-control">Control for {alert.id}</div> }))
const offers = [
  { id: 'offered', category: 'medical', status: 'accepted', handoff_offered_to_me: true },
  { id: 'distant-task', category: 'fire', status: 'accepted', accepted_by: 'volunteer' },
  { id: 'nearby-task', category: 'flood', status: 'accepted', accepted_by: 'volunteer' },
]
let client
const tree = () => <QueryClientProvider client={client}><MemoryRouter><RelayInbox visibleAlertIds={['nearby-task']} /></MemoryRouter></QueryClientProvider>
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.auth = { user: { id: 'volunteer', role: 'volunteer' }, token: 'test-token' }
  mocks.get.mockReset().mockResolvedValue({ data: offers })
})
afterEach(() => { client.clear() })
describe('account-isolated relay inbox', () => {
  it('shows named offers and distant assigned tasks independently of nearby GPS, without duplicates', async () => {
    render(tree())
    await screen.findByRole('region', { name: 'Your relay tasks' })
    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/coordination/mine', { signal: expect.any(AbortSignal) })
    expect(screen.getByRole('link', { name: 'medical report' })).toHaveAttribute('href', '/alert/offered')
    expect(screen.getByRole('link', { name: 'fire report' })).toHaveAttribute('href', '/alert/distant-task')
    expect(screen.queryByRole('link', { name: 'flood report' })).not.toBeInTheDocument()
  })
  it('labels a cached failed refresh and removes acknowledgement controls until fresh', async () => {
    render(tree())
    await screen.findByRole('region', { name: 'Your relay tasks' })
    mocks.get.mockRejectedValue(new Error('Offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['coordination-inbox', 'volunteer'] }) })
    await screen.findByText(/Cached offers, not current/)
    expect(screen.queryByTestId('relay-control')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'medical report' })).toBeVisible()
  })
  it('never exposes another account’s cached inbox during account change', async () => {
    const view = render(tree())
    await screen.findByRole('link', { name: 'medical report' })
    mocks.auth = { user: { id: 'new-volunteer', role: 'volunteer' }, token: 'new-token' }
    mocks.get.mockImplementation(() => new Promise(() => {}))
    view.rerender(tree())
    expect(screen.queryByRole('link', { name: 'medical report' })).not.toBeInTheDocument()
    expect(client.getQueryData(['coordination-inbox', 'new-volunteer'])).toBeUndefined()
  })
  it('clears private cached offers immediately on forbidden response', async () => {
    render(tree())
    await screen.findByRole('link', { name: 'medical report' })
    mocks.get.mockRejectedValue({ response: { status: 403 } })
    await act(async () => { await client.invalidateQueries({ queryKey: ['coordination-inbox', 'volunteer'] }) })
    await screen.findByText(/Your relay tasks could not refresh/)
    expect(screen.queryByRole('link', { name: 'medical report' })).not.toBeInTheDocument()
  })
  it('makes no private request for signed-out/reporting-only viewers', () => {
    mocks.auth = { user: null }
    render(tree())
    expect(mocks.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
