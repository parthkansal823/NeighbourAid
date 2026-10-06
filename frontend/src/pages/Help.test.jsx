import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import Help, { RequestCard, RequestForm } from './Help'
import { I18nProvider } from '../utils/i18n'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'owner' }, token: 'owner-token' },
  get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), toast: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: mocks.toast }) }))
vi.mock('../utils/geo', () => ({ getBrowseLocation: async () => ({ coords: [77.209, 28.6139] }) }))

const posted = '2026-10-06T05:00:00Z'
const accepted = '2026-10-06T06:00:00Z'
const started = '2026-10-06T07:00:00Z'
const base = {
  id: 'job', kind: 'plumber', title: 'Kitchen tap repair', description: 'Bring a washer',
  requester_id: 'owner', status: 'accepted', accepted_worker_id: 'worker', offer_count: 1,
  contact: 'private phone', timeline: [{ event: 'posted', at: posted }, { event: 'accepted', at: accepted }],
}
const wrap = (children) => <I18nProvider>{children}</I18nProvider>
const mount = () => render(wrap(<Help />))
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok }); return { promise, resolve } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-06T00:00:00Z'))
  mocks.auth = { user: { id: 'owner' }, token: 'owner-token' }
  mocks.get.mockReset().mockImplementation(async (url) => ({ data: url.endsWith('/mine') ? { posted: [base], offered: [] } : [] }))
  mocks.post.mockReset().mockResolvedValue({ data: {} })
  mocks.patch.mockReset().mockResolvedValue({ data: {} })
})
afterEach(() => vi.restoreAllMocks())

async function fillForm() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Ask for help' }))
  await user.type(screen.getByLabelText('What do you need'), 'Leaking kitchen tap')
  return user
}

describe('Help preferred window form', () => {
  it('posts flexible times as null and retains the normal location payload', async () => {
    mount()
    await screen.findByRole('heading', { name: base.title })
    const user = await fillForm()
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('From')).toHaveAccessibleDescription(/device’s timezone/)
    expect(screen.getByLabelText('From')).toHaveClass('min-h-11', 'min-w-0')
    await user.click(screen.getByRole('button', { name: 'Post request' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/help/', expect.objectContaining({
      schedule_start: null, schedule_end: null, location: { type: 'Point', coordinates: [77.209, 28.6139] },
    })))
  })

  it('converts local inputs to UTC and never transmits the local wall-clock strings', async () => {
    mount()
    await screen.findByRole('heading', { name: base.title })
    const user = await fillForm()
    const first = '2026-10-07T10:00'
    const last = '2026-10-07T12:00'
    fireEvent.change(screen.getByLabelText('From'), { target: { value: first } })
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: last } })
    await user.click(screen.getByRole('button', { name: 'Post request' }))
    expect(mocks.post).toHaveBeenCalledWith('/api/help/', expect.objectContaining({
      schedule_start: new Date(first).toISOString(), schedule_end: new Date(last).toISOString(),
    }))
  })

  it('validates a partial window before calling the API and keeps all entered values', async () => {
    mount()
    await screen.findByRole('heading', { name: base.title })
    const user = await fillForm()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-07T10:00' } })
    await user.click(screen.getByRole('button', { name: 'Post request' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Fill in both times, or leave both blank.')
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-07T10:00')
    expect(screen.getByLabelText('What do you need')).toHaveValue('Leaking kitchen tap')
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('keeps the preferred times on a server rejection so a user can correct them', async () => {
    mocks.post.mockRejectedValue({ response: { data: { detail: 'Window has expired' } } })
    mount()
    await screen.findByRole('heading', { name: base.title })
    const user = await fillForm()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-07T10:00' } })
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '2026-10-07T12:00' } })
    await user.click(screen.getByRole('button', { name: 'Post request' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ variant: 'error', title: 'Window has expired' }))
    expect(screen.getByLabelText('Until')).toHaveValue('2026-10-07T12:00')
    expect(screen.getByRole('button', { name: 'Post request' })).toBeEnabled()
  })

  it('has explicit input labels and no axe violations in the compact form', async () => {
    const view = render(wrap(<RequestForm coords={{ lat: 28.6, lng: 77.2 }} onDone={vi.fn()} />))
    expect((await axe(view.container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })
})

function card(item = base, viewerId = 'worker', props = {}) {
  return render(wrap(<ul><RequestCard item={item} viewerId={viewerId} busy="" {...props} /></ul>))
}

describe('Help work history and actions', () => {
  it('shows only supplied events and gives the accepted worker the start action', async () => {
    const onStart = vi.fn()
    card(base, 'worker', { onStart })
    const history = screen.getByRole('region', { name: 'Work timeline' })
    expect(within(history).getAllByRole('listitem')).toHaveLength(2)
    expect(within(history).queryByText('Work started')).not.toBeInTheDocument()
    expect(screen.getByText('private phone')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Mark work started' })
    expect(button).toHaveClass('tap')
    await userEvent.click(button)
    expect(onStart).toHaveBeenCalledWith('job')
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  it('does not show contact/history or work actions to another bidder or signed-out viewer', () => {
    const view = card(base, 'other-bidder')
    expect(screen.queryByText('private phone')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Work timeline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(wrap(<ul><RequestCard item={base} viewerId={null} /></ul>))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('retains owner completion/withdraw while not offering the worker start action to the owner', () => {
    card(base, 'owner')
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark work started' })).not.toBeInTheDocument()
  })

  it.each(['done', 'cancelled'])('has no work actions on a %s job', (status) => {
    const view = card({ ...base, status }, 'owner')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(wrap(<ul><RequestCard item={{ ...base, status }} viewerId="worker" /></ul>))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not infer history on old accepted rows, and keeps missing schedules flexible', () => {
    card({ ...base, timeline: undefined, accepted_at: undefined }, 'worker')
    expect(screen.getByText('Time is flexible')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByText('Offer accepted')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark work started' })).toBeInTheDocument()
  })

  it('omits invalid timeline times and hides the start action after an actual start', () => {
    card({ ...base, timeline: [...base.timeline, { event: 'started', at: started }, { event: 'done', at: 'bad' }] })
    expect(screen.getByText('Work started')).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
    expect(screen.queryByText('Marked done')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark work started' })).not.toBeInTheDocument()
  })

  it('uses a wrapping local-time schedule with the source UTC values in time elements', () => {
    const item = { ...base, schedule_start: '2026-10-07T04:30:00Z', schedule_end: '2026-10-07T06:30:00Z' }
    const view = card(item)
    const first = view.container.querySelector(`time[datetime="${item.schedule_start}"]`)
    expect(first).toHaveTextContent('2026')
    expect(first.parentElement).toHaveClass('flex-wrap', 'break-words')
    expect(screen.getByText(/Preferred time, not a confirmed booking/)).toBeInTheDocument()
  })

  it('calls start then reloads the recorded timeline and removes the start button', async () => {
    mocks.auth = { user: { id: 'worker' }, token: 'worker-token' }
    let item = base
    mocks.get.mockImplementation(async (url) => ({ data: url.endsWith('/mine') ? { posted: [], offered: [item] } : [] }))
    mocks.patch.mockImplementation(async () => {
      item = { ...base, work_started_at: started, timeline: [...base.timeline, { event: 'started', at: started }] }
      return { data: item }
    })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Mark work started' }))
    expect(mocks.patch).toHaveBeenCalledWith('/api/help/job/start')
    await screen.findByText('Work started')
    expect(screen.queryByRole('button', { name: 'Mark work started' })).not.toBeInTheDocument()
  })
})

describe('Help account-isolated loads', () => {
  it('clears private data and open forms synchronously at logout', async () => {
    const view = mount()
    await screen.findByText('private phone')
    await fillForm()
    const pending = deferred()
    mocks.get.mockReturnValue(pending.promise)
    mocks.auth = { user: null, token: null }
    view.rerender(wrap(<Help />))
    expect(screen.queryByText('private phone')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Work timeline' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('What do you need')).not.toBeInTheDocument()
  })

  it('discards a late private mine response after changing accounts', async () => {
    const late = deferred()
    mocks.get.mockImplementation((url) => url.endsWith('/mine') ? late.promise : Promise.resolve({ data: [] }))
    const view = mount()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/help/mine'))
    mocks.auth = { user: { id: 'next-user' }, token: 'next-token' }
    mocks.get.mockImplementation(async (url) => ({ data: url.endsWith('/mine') ? { posted: [], offered: [] } : [] }))
    view.rerender(wrap(<Help />))
    await screen.findByText('Nothing nearby yet')
    await act(async () => late.resolve({ data: { posted: [base], offered: [] } }))
    expect(screen.queryByText(base.title)).not.toBeInTheDocument()
    expect(screen.queryByText('private phone')).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('does not start an old-account mine load when nearby resolves after logout', async () => {
    const late = deferred()
    mocks.get.mockReturnValue(late.promise)
    const view = mount()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1))
    mocks.auth = { user: null, token: null }
    mocks.get.mockResolvedValue({ data: [] })
    view.rerender(wrap(<Help />))
    await screen.findByText('Nothing nearby yet')
    await act(async () => late.resolve({ data: [base] }))
    expect(mocks.get).not.toHaveBeenCalledWith('/api/help/mine')
    expect(screen.queryByText('private phone')).not.toBeInTheDocument()
  })
})
