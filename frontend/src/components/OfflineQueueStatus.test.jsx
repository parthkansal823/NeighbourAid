import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import 'fake-indexeddb/auto'
import axios from 'axios'
import OfflineQueueStatus, { postQueuedAlert } from './OfflineQueueStatus'
import { enqueueAlert, listPending, removePending } from '../utils/offlineQueue'

const { toast, t, auth } = vi.hoisted(() => ({ toast: vi.fn(), t: (key) => key, auth: { user: null } }))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('./Toast', () => ({ useToast: () => ({ push: toast }) }))
vi.mock('../utils/i18n', () => ({ useI18n: () => ({ t }) }))

function signIn(accountId) {
  const token = `header.${btoa(JSON.stringify({ sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`
  localStorage.setItem('token', token)
  return token
}

afterEach(async () => {
  for (const row of await listPending()) await removePending(row.id)
  vi.restoreAllMocks()
  vi.clearAllMocks()
  auth.user = null
})

describe('queued alert delivery and status', () => {
  it('sends an anonymous report through the public endpoint even while signed in', async () => {
    signIn('alice')
    await enqueueAlert({ description: 'anonymous' }, { anonymous: true })
    axios.post.mockResolvedValue({})
    render(<OfflineQueueStatus />)
    await waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(axios.post).toHaveBeenCalledWith('/api/alerts/anonymous', { description: 'anonymous' }, { timeout: 20000, headers: {} })
    expect(await listPending()).toHaveLength(0)
  })

  it('offers a manual retry after a server failure without a new online event', async () => {
    await enqueueAlert({ description: 'saved' }, { anonymous: true })
    axios.post.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValueOnce({})
    render(<OfflineQueueStatus />)
    await waitFor(() => expect(axios.post).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry now' })).toBeEnabled())
    expect(screen.getByRole('status')).toHaveTextContent('Reports waiting to send: 1')
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(await listPending()).toHaveLength(0)
  })

  it('explains when the original account is required and never sends as a different account', async () => {
    signIn('alice')
    await enqueueAlert({ description: 'alice report' }, { accountId: 'alice' })
    signIn('bob')
    render(<OfflineQueueStatus />)
    expect(await screen.findByRole('status')).toHaveTextContent('original account')
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeDisabled()
    expect(axios.post).not.toHaveBeenCalled()
    expect(await listPending()).toHaveLength(1)
  })

  it('shows saved reports offline and resumes delivery on reconnect', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await enqueueAlert({ description: 'offline' }, { anonymous: true })
    axios.post.mockResolvedValue({})
    render(<OfflineQueueStatus />)
    expect(await screen.findByRole('status')).toHaveTextContent('reconnect')
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeDisabled()
    expect(axios.post).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(await listPending()).toHaveLength(0)
  })

  it('resumes an attributed report when its original account signs back in', async () => {
    await enqueueAlert({ description: 'alice report' }, { accountId: 'alice' })
    axios.post.mockResolvedValue({})
    const { rerender } = render(<OfflineQueueStatus />)
    expect(await screen.findByRole('status')).toHaveTextContent('original account')
    const token = signIn('alice')
    auth.user = { id: 'alice' }
    rerender(<OfflineQueueStatus />)
    await waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(axios.post).toHaveBeenCalledWith('/api/alerts/', { description: 'alice report' }, {
      timeout: 20000, headers: { Authorization: `Bearer ${token}` },
    })
    expect(await listPending()).toHaveLength(0)
  })

  it('pins credentials to the original account and does not log out a new account after an old 401', async () => {
    const aliceToken = signIn('alice')
    let reject
    axios.post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const delivery = postQueuedAlert({ description: 'alice report' }, { anonymous: false, accountId: 'alice' })
    const assertion = expect(delivery).rejects.toMatchObject({ response: { status: 401 } })
    const bobToken = signIn('bob')
    reject({ response: { status: 401 } })
    await assertion
    expect(axios.post).toHaveBeenCalledWith('/api/alerts/', expect.any(Object), {
      timeout: 20000, headers: { Authorization: `Bearer ${aliceToken}` },
    })
    expect(localStorage.getItem('token')).toBe(bobToken)
  })

  it('refuses a changed account before issuing any attributed request', async () => {
    signIn('bob')
    await expect(postQueuedAlert({}, { anonymous: false, accountId: 'alice' })).rejects.toThrow('Original reporting account')
    expect(axios.post).not.toHaveBeenCalled()
  })
})
