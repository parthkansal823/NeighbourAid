import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapDemoSession, createDemoAdapter } from './mockApi'

const NOW = Date.parse('2026-10-06T00:00:00Z')
const hours = (amount) => new Date(NOW + amount * 3_600_000).toISOString()
const USER = 'demo-volunteer-1'
function setup(extra = {}) {
  const job = {
    id: 'tap', title: 'Kitchen tap repair', kind: 'plumber', requester_id: 'owner',
    contact: 'demo private contact', offers: [{ worker_id: USER, worker_name: 'Ananya Parth', price: 500 }],
    status: 'open', created_at: hours(-2), expires_at: hours(2), ...extra,
  }
  const state = { user: { id: USER, name: 'Ananya Parth' }, help: [job] }
  const adapter = createDemoAdapter(state)
  const request = (action, method = 'patch', data, params) => adapter({ url: `/api/help/tap${action ? `/${action}` : ''}`, method, data, params })
  return { job, state, adapter, request }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('static demo preferred windows', () => {
  it('persists flexible null fields with a posted-only recorded timeline', async () => {
    const { adapter } = setup()
    const { data } = await adapter({ url: '/api/help/', method: 'post', data: { title: 'Repair laptop Wi-Fi', kind: 'tech' } })
    expect(data.schedule_start).toBeNull()
    expect(data.schedule_end).toBeNull()
    expect(data.timeline).toEqual([{ event: 'posted', at: hours(0) }])
    expect(data.expires_at).toBe(hours(14 * 24))
  })

  it('normalizes aware times to UTC and expires an open request at the preferred end', async () => {
    const { adapter, state } = setup()
    const { data } = await adapter({ url: '/api/help/', method: 'post', data: {
      title: 'Repair kitchen tap', kind: 'plumber', schedule_start: '2026-10-07T15:30:00+05:30', schedule_end: '2026-10-07T17:30:00+05:30',
    } })
    expect(data.schedule_start).toBe('2026-10-07T10:00:00.000Z')
    expect(data.schedule_end).toBe('2026-10-07T12:00:00.000Z')
    expect(data.expires_at).toBe(data.schedule_end)
    expect(state.help[0].schedule_start).toBe(data.schedule_start)
  })

  it.each([
    { schedule_start: hours(4) },
    { schedule_end: hours(4) },
    { schedule_start: '2026-10-07T10:00', schedule_end: hours(48) },
    { schedule_start: 'bad', schedule_end: hours(4) },
    { schedule_start: hours(0), schedule_end: hours(4) },
    { schedule_start: hours(8), schedule_end: hours(7) },
    { schedule_start: hours(8), schedule_end: hours(33) },
    { schedule_start: hours(14 * 24), schedule_end: hours(14 * 24 + 1) },
    { schedule_start: '', schedule_end: '' },
  ])('rejects an invalid window before changing demo state: %j', async (schedule) => {
    const { state, adapter } = setup()
    const before = JSON.stringify(state.help)
    await expect(adapter({ url: '/api/help/', method: 'post', data: { title: 'Repair laptop', ...schedule } }))
      .rejects.toMatchObject({ response: { status: 422 } })
    expect(JSON.stringify(state.help)).toBe(before)
  })

  it('does not allow a caller to forge old work milestones or owner identity at creation', async () => {
    const { adapter } = setup()
    const { data } = await adapter({ url: '/api/help/', method: 'post', data: {
      title: 'Repair laptop', requester_id: 'other', accepted_worker_id: 'attacker',
      accepted_at: hours(-1), work_started_at: hours(-1), done_at: hours(-1),
      status: 'done', timeline: [{ event: 'done', at: hours(-1) }],
    } })
    expect(data.requester_id).toBe(USER)
    expect(data.status).toBe('open')
    expect(data.accepted_worker_id).toBeNull()
    expect(data.timeline.map((entry) => entry.event)).toEqual(['posted'])
  })
})

describe('static demo private timelines and work lifecycle', () => {
  it('omits private fields publicly and for an unaccepted bidder without mutating the source', async () => {
    const { job, adapter } = setup({ accepted_at: hours(-1), timeline: [{ event: 'accepted', at: hours(-1) }] })
    const before = JSON.stringify(job)
    const near = await adapter({ url: '/api/help/near' })
    for (const key of ['contact', 'offers', 'timeline', 'accepted_at']) expect(near.data[0]).not.toHaveProperty(key)
    const mine = await adapter({ url: '/api/help/mine' })
    expect(mine.data.offered[0]).not.toHaveProperty('contact')
    expect(mine.data.offered[0]).not.toHaveProperty('timeline')
    expect(JSON.stringify(job)).toBe(before)
  })

  it('returns only actual times to participants and no invented acceptance for legacy rows', async () => {
    const { adapter } = setup({ status: 'accepted', accepted_worker_id: USER })
    const { data } = await adapter({ url: '/api/help/mine' })
    expect(data.offered[0].contact).toBe('demo private contact')
    expect(data.offered[0].timeline).toEqual([{ event: 'posted', at: hours(-2) }])
    expect(data.offered[0]).not.toHaveProperty('accepted_at')
  })

  it('accepts only an existing offer as the owner and refreshes retention beyond the original window', async () => {
    const { job, state, request } = setup()
    await expect(request('accept', 'patch', null, { worker_id: USER })).rejects.toMatchObject({ response: { status: 403 } })
    state.user = { id: 'owner', name: 'Demo owner' }
    await expect(request('accept', 'patch', null, { worker_id: 'missing' })).rejects.toMatchObject({ response: { status: 404 } })
    const { data } = await request('accept', 'patch', null, { worker_id: USER })
    expect(data.timeline.map((entry) => entry.event)).toEqual(['posted', 'accepted'])
    expect(data.accepted_at).toBe(hours(0))
    expect(job.expires_at).toBe(hours(14 * 24))
    await expect(request('accept', 'patch', null, { worker_id: USER })).rejects.toMatchObject({ response: { status: 409 } })
  })

  it('keeps start accepted and repeated worker starts preserve the first timestamp', async () => {
    const { job, request } = setup({ status: 'accepted', accepted_worker_id: USER, accepted_at: hours(-1) })
    const first = await request('start')
    expect(first.data.status).toBe('accepted')
    expect(first.data.timeline.map((entry) => entry.event)).toEqual(['posted', 'accepted', 'started'])
    vi.setSystemTime(NOW + 60_000)
    const again = await request('start')
    expect(again.data.work_started_at).toBe(first.data.work_started_at)
    expect(again.data.timeline).toEqual(first.data.timeline)
    expect(job.expires_at).toBe(hours(2)) // Starting alone does not extend retention.
  })

  it.each(['open', 'done', 'cancelled'])('refuses a start in %s without writing timestamps', async (status) => {
    const { job, request } = setup({ status, accepted_worker_id: USER })
    await expect(request('start')).rejects.toMatchObject({ response: { status: 409 } })
    expect(job.work_started_at).toBeUndefined()
  })

  it('does not permit another bidder or the owner to start on behalf of the worker', async () => {
    const { state, request } = setup({ status: 'accepted', accepted_worker_id: USER })
    for (const id of ['owner', 'other-worker']) {
      state.user = { id }
      await expect(request('start')).rejects.toMatchObject({ response: { status: 403 } })
    }
  })

  it.each(['open', 'accepted'])('lets only the owner complete %s and does not fake a start', async (status) => {
    const { job, state, request } = setup({ status, accepted_worker_id: USER })
    await expect(request('done')).rejects.toMatchObject({ response: { status: 403 } })
    state.user = { id: 'owner' }
    const first = await request('done')
    expect(first.data.status).toBe('done')
    expect(first.data.timeline.map((entry) => entry.event)).toEqual(['posted', 'done'])
    expect(first.data.expires_at).toBe(hours(14 * 24))
    vi.setSystemTime(NOW + 60_000)
    const again = await request('done')
    expect(again.data.done_at).toBe(first.data.done_at)
    expect(job.done_at).toBe(first.data.done_at)
    expect(again.data.expires_at).toBe(first.data.expires_at)
  })

  it('cannot transform a cancelled record into a new completion', async () => {
    const { job, state, request } = setup({ status: 'cancelled', cancelled_at: hours(-1) })
    state.user = { id: 'owner' }
    await expect(request('done')).rejects.toMatchObject({ response: { status: 409 } })
    expect(job.status).toBe('cancelled')
    expect(job.done_at).toBeUndefined()
  })

  it('retains cancellation history for the accepted participant and refreshes expiry', async () => {
    const { job, state, adapter, request } = setup({ status: 'accepted', accepted_worker_id: USER, accepted_at: hours(-1) })
    state.user = { id: 'owner' }
    const withdrawn = await request('', 'delete')
    expect(withdrawn.data.status).toBe('cancelled')
    expect(job.expires_at).toBe(hours(14 * 24))
    state.user = { id: USER }
    const mine = await adapter({ url: '/api/help/mine' })
    expect(mine.data.offered[0].timeline.map((entry) => entry.event)).toEqual(['posted', 'accepted', 'cancelled'])
    await expect(request('start')).rejects.toMatchObject({ response: { status: 409 } })
  })

  it('deletes an open request with no offers and rejects closed withdrawals', async () => {
    const { state, request } = setup({ offers: [] })
    state.user = { id: 'owner' }
    expect((await request('', 'delete')).data.status).toBe('deleted')
    expect(state.help).toEqual([])
    const closed = setup({ status: 'done' })
    closed.state.user = { id: 'owner' }
    await expect(closed.request('', 'delete')).rejects.toMatchObject({ response: { status: 409 } })
  })

  it('omits expired open jobs and refuses expired starts, quotes, acceptance and repeated completion', async () => {
    const { job, state, adapter, request } = setup({ expires_at: hours(-1) })
    expect((await adapter({ url: '/api/help/near' })).data).toEqual([])
    await expect(request('offers', 'post', { price: 500 })).rejects.toMatchObject({ response: { status: 409 } })
    state.user = { id: 'owner' }
    await expect(request('accept', 'patch', null, { worker_id: USER })).rejects.toMatchObject({ response: { status: 409 } })
    job.status = 'done'
    await expect(request('done')).rejects.toMatchObject({ response: { status: 409 } })
    job.status = 'accepted'; job.accepted_worker_id = USER; state.user = { id: USER }
    await expect(request('start')).rejects.toMatchObject({ response: { status: 409 } })
  })

  it('requires an account for private reads and mutations', async () => {
    const { state, adapter, request } = setup()
    state.user = null
    await expect(adapter({ url: '/api/help/mine' })).rejects.toMatchObject({ response: { status: 401 } })
    await expect(request('start')).rejects.toMatchObject({ response: { status: 401 } })
    await expect(adapter({ url: '/api/help/', method: 'post', data: { title: 'Repair tap' } })).rejects.toMatchObject({ response: { status: 401 } })
  })
})

describe('default fictional Indian profile', () => {
  it('uses Ananya Parth in the profile, authored updates and requester/worker listings', async () => {
    const adapter = createDemoAdapter()
    expect((await adapter({ url: '/api/users/me' })).data).toMatchObject({ id: USER, name: 'Ananya Parth' })
    expect((await adapter({ url: '/api/alerts/demo-alert-01/updates' })).data[1].author_name).toBe('Ananya Parth')
    const mine = (await adapter({ url: '/api/help/mine' })).data
    expect(mine.posted.every((item) => item.requester_name === 'Ananya Parth')).toBe(true)
    expect(JSON.stringify(mine)).not.toContain('Aarav Mehta')
    expect(mine.offered.some((item) => item.status === 'accepted' && item.timeline.some((entry) => entry.event === 'accepted'))).toBe(true)
    expect(mine.posted.some((item) => item.status === 'done' && item.timeline.some((entry) => entry.event === 'started'))).toBe(true)
    expect(mine.posted.some((item) => item.schedule_start && item.schedule_end)).toBe(true)
  })

  it('reload/bootstrap replaces the old display name but preserves volunteer identity', async () => {
    localStorage.setItem('name', 'Aarav Mehta')
    bootstrapDemoSession()
    expect(localStorage.getItem('name')).toBe('Ananya Parth')
    const payload = JSON.parse(atob(localStorage.getItem('token').split('.')[1]))
    expect(payload.sub).toBe(USER)
    expect(payload.role).toBe('volunteer')
    bootstrapDemoSession()
    expect(localStorage.getItem('name')).toBe('Ananya Parth')
    expect((await createDemoAdapter()({ url: '/api/auth/login', method: 'post' })).data.name).toBe('Ananya Parth')
  })
})
