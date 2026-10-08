import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DeliveryReceipts from './DeliveryReceipts'

const mocks = vi.hoisted(() => ({
  auth: { user: null },
  listPending: vi.fn(), listReceipts: vi.fn(), cancelPending: vi.fn(), canReadQueuedAlert: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../utils/offlineQueue', () => ({
  listPending: mocks.listPending, listReceipts: mocks.listReceipts,
  cancelPending: mocks.cancelPending, canReadQueuedAlert: mocks.canReadQueuedAlert,
  OFFLINE_QUEUE_EVENT: 'offline-queue:changed',
}))

const pending = [
  { id: 1, accountId: 'alice', anonymous: false, created_at: 1000, attempts: 2,
    deliveryState: 'needs_review', payload: { description: 'Alice private report' } },
  { id: 2, accountId: 'bob', anonymous: false, created_at: 1000, attempts: 0,
    payload: { description: 'Bob private report' } },
  { id: 3, accountId: null, anonymous: true, created_at: 1000, attempts: 0,
    payload: { description: 'Anonymous device report' } },
]
const receipts = [
  { id: 'alice-submission', accountId: 'alice', anonymous: false, alertId: 'alice-alert', received_at: 2000 },
  { id: 'bob-submission', accountId: 'bob', anonymous: false, alertId: 'bob-alert', received_at: 2000 },
  { id: 'anon-submission', accountId: null, anonymous: true, alertId: 'anon-alert', received_at: 2000 },
]
const ownedReceipts = accountId => receipts.filter(row => row.anonymous || (accountId && row.accountId === accountId))
const view = () => <MemoryRouter><DeliveryReceipts /></MemoryRouter>

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function openReceipts() {
  await userEvent.click(await screen.findByRole('button', { name: /Delivery receipts/ }))
  return screen.getByRole('dialog', { name: 'Delivery receipts' })
}

beforeEach(() => {
  mocks.auth.user = { id: 'alice' }
  mocks.listPending.mockResolvedValue(pending)
  mocks.listReceipts.mockImplementation(async accountId => ownedReceipts(accountId))
  mocks.canReadQueuedAlert.mockImplementation((row, accountId) => row.anonymous || Boolean(accountId && row.accountId === accountId))
  mocks.cancelPending.mockResolvedValue(false)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  mocks.auth.user = null
})

describe('delivery receipt account privacy', () => {
  it('shows only the current account and device-anonymous rows and receipt links', async () => {
    render(view())
    const dialog = await openReceipts()
    expect(within(dialog).getByText('Alice private report')).toBeInTheDocument()
    expect(within(dialog).getByText('Anonymous device report')).toBeInTheDocument()
    expect(within(dialog).queryByText('Bob private report')).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/alert/alice-alert', '/alert/anon-alert'])
    expect(mocks.listReceipts).toHaveBeenCalledWith('alice')
    expect(mocks.canReadQueuedAlert).toHaveBeenCalledWith(pending[1], 'alice')
  })

  it.each(['bob', null])('immediately clears Alice private modal content when account becomes %s, before IndexedDB resolves', async accountId => {
    const rendered = render(view())
    await openReceipts()
    expect(screen.getByText('Alice private report')).toBeInTheDocument()
    const delayedPending = deferred(), delayedReceipts = deferred()
    mocks.listPending.mockReturnValueOnce(delayedPending.promise)
    mocks.listReceipts.mockReturnValueOnce(delayedReceipts.promise)
    mocks.auth.user = accountId ? { id: accountId } : null
    rendered.rerender(view())

    // These assertions intentionally run before resolving either storage read.
    const dialog = screen.getByRole('dialog', { name: 'Delivery receipts' })
    expect(within(dialog).queryByText('Alice private report')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    expect(within(dialog).getByText('No receipts for this account on this device.')).toBeInTheDocument()
    expect(mocks.listReceipts).toHaveBeenLastCalledWith(accountId)

    await act(async () => {
      delayedPending.resolve(pending)
      delayedReceipts.resolve(ownedReceipts(accountId))
      await Promise.all([delayedPending.promise, delayedReceipts.promise])
    })
    expect(screen.queryByText('Alice private report')).not.toBeInTheDocument()
    expect(screen.getByText('Anonymous device report')).toBeInTheDocument()
    if (accountId) expect(screen.getByText('Bob private report')).toBeInTheDocument()
    else expect(screen.queryByText('Bob private report')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).not.toContain('/alert/alice-alert')
  })

  it('does not restore private Alice rows when an old account read resolves after Bob data', async () => {
    const rendered = render(view())
    await openReceipts()
    const oldPending = deferred(), oldReceipts = deferred()
    mocks.listPending.mockReturnValueOnce(oldPending.promise)
    mocks.listReceipts.mockReturnValueOnce(oldReceipts.promise)
    act(() => window.dispatchEvent(new Event('offline-queue:changed')))
    mocks.auth.user = { id: 'bob' }
    rendered.rerender(view())
    await screen.findByText('Bob private report')
    await act(async () => {
      oldPending.resolve(pending)
      oldReceipts.resolve(ownedReceipts('alice'))
      await Promise.all([oldPending.promise, oldReceipts.promise])
    })
    expect(screen.queryByText('Alice private report')).not.toBeInTheDocument()
    expect(screen.getByText('Bob private report')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/alert/bob-alert', '/alert/anon-alert'])
  })
})

describe('delivery receipt truthful states and cancellation', () => {
  it('never cancels a saved report without confirmation', async () => {
    window.confirm.mockReturnValue(false)
    render(view())
    const dialog = await openReceipts()
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel saved report' })[0])
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('already received by the server is not withdrawn'))
    expect(mocks.cancelPending).not.toHaveBeenCalled()
    expect(screen.getByText('Alice private report')).toBeInTheDocument()
  })

  it('reports a false cancellation truthfully rather than claiming success or withdrawal', async () => {
    render(view())
    const dialog = await openReceipts()
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel saved report' })[0])
    expect(mocks.cancelPending).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('status')).toHaveTextContent('already delivered or requires its original account')
    expect(screen.queryByText('Saved report cancelled on this device.')).not.toBeInTheDocument()
    expect(screen.getByText('Alice private report')).toBeInTheDocument()
  })

  it('confirms cancellation only on this device and refreshes the stored rows', async () => {
    mocks.cancelPending.mockResolvedValue(true)
    render(view())
    const dialog = await openReceipts()
    mocks.listPending.mockResolvedValue(pending.filter(row => row.id !== 1))
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel saved report' })[0])
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(mocks.cancelPending).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Saved report cancelled on this device.')
    await waitFor(() => expect(screen.queryByText('Alice private report')).not.toBeInTheDocument())
    expect(screen.getByText('Anonymous device report')).toBeInTheDocument()
  })

  it('distinguishes saved, rejected, and server-received states from help arriving', async () => {
    render(view())
    const dialog = await openReceipts()
    expect(within(dialog).getByText(/A receipt is not confirmation that help has arrived/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Automatic retries are paused/)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('heading', { name: 'Saved on device · Delivery unconfirmed' })).toHaveLength(2)
    expect(within(dialog).getAllByRole('heading', { name: 'Server received' })).toHaveLength(2)
    expect(within(dialog).queryByRole('heading', { name: /help.*arrived/i })).not.toBeInTheDocument()
  })
})
