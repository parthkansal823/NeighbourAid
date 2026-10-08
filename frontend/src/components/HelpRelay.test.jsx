import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '../utils/i18n'
import HelpRelay from './HelpRelay'

const mocks = vi.hoisted(() => ({ auth: {}, get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), coordination: {} }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete } }))
const alert = { id: 'incident', status: 'accepted', reporter_id: 'reporter', accepted_by: 'lead', category: 'medical' }
let client
const mount = (data = alert, onChanged) => render(<QueryClientProvider client={client}><I18nProvider><HelpRelay alert={data} onChanged={onChanged} /></I18nProvider></QueryClientProvider>)
const lead = () => screen.findByRole('button', { name: 'Share location for 30 minutes' })
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  mocks.auth = { user: { id: 'lead', role: 'volunteer' }, token: 'test-token' }
  mocks.coordination = {
    alert_id: 'incident', status: 'accepted', lead_id: 'lead', progress: null,
    can_manage: true, can_share_location: true, can_handoff: true, can_confirm_safe: false, can_accept_handoff: false,
    backup: { requested: false, offers: [] }, handoff: null, location_sharing: { enabled: false, expires_at: null },
  }
  mocks.get.mockReset().mockImplementation(async () => ({ data: structuredClone(mocks.coordination) }))
  mocks.post.mockReset().mockImplementation(async () => ({ data: structuredClone(mocks.coordination) }))
  mocks.patch.mockReset().mockImplementation(async (_path, body) => {
    if ('enabled' in body) mocks.coordination.location_sharing = { enabled: body.enabled, expires_at: '2099-01-01T00:00:00Z' }
    if (body.progress) mocks.coordination.progress = body.progress
    return { data: structuredClone(mocks.coordination) }
  })
  mocks.delete.mockReset().mockResolvedValue({ data: mocks.coordination })
})
afterEach(() => { client.clear(); vi.restoreAllMocks() })

describe('private help relay', () => {
  it('keeps location sharing off until an explicit reversible 30-minute consent action', async () => {
    const user = userEvent.setup(), invalidate = vi.spyOn(client, 'invalidateQueries')
    mount()
    await lead()
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/incident/coordination', { signal: expect.any(AbortSignal) })
    await user.click(await lead())
    await screen.findByRole('button', { name: 'Stop sharing location' })
    expect(mocks.patch).toHaveBeenCalledWith('/api/alerts/incident/location-sharing', { enabled: true, duration_minutes: 30 })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coordination', 'lead', 'incident'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coordination-inbox', 'lead'] })
    await user.click(screen.getByRole('button', { name: 'Stop sharing location' }))
    await lead()
    expect(mocks.patch).toHaveBeenLastCalledWith('/api/alerts/incident/location-sharing', { enabled: false, duration_minutes: 30 })
  })

  it('reports travel progress as a volunteer report rather than confirmed arrival', async () => {
    mount()
    await lead()
    fireEvent.click(screen.getByRole('button', { name: "I'm on the way" }))
    expect(await screen.findByText('Volunteer reports: on the way')).toBeInTheDocument()
    expect(mocks.patch).toHaveBeenCalledWith('/api/alerts/incident/progress', { progress: 'on_the_way' })
  })

  it('lets the reporter request backup and confirm safe, but never share the lead location or assign a handoff', async () => {
    mocks.auth.user = { id: 'reporter', role: 'reporter' }
    Object.assign(mocks.coordination, { can_share_location: false, can_handoff: false, can_confirm_safe: true })
    mount()
    await screen.findByRole('button', { name: 'I am safe now' })
    expect(screen.queryByRole('button', { name: 'Share location for 30 minutes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "I've arrived" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Backup and handoff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Request backup help' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/alerts/incident/backup', { needed_skills: [], note: '' }))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'I am safe now' }))
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('allows backup offers without private coordination reads or acquiring the lead role', async () => {
    mocks.auth.user = { id: 'backup', role: 'volunteer' }
    const user = userEvent.setup()
    mount({ ...alert, backup_requested: true, backup_needed_skills: ['cpr'] })
    await user.type(screen.getByRole('textbox', { name: 'Offer note (optional)' }), 'I can assist')
    await user.click(screen.getByRole('button', { name: 'Offer backup help' }))
    expect(await screen.findByRole('button', { name: 'Help offered' })).toBeDisabled()
    expect(mocks.post).toHaveBeenCalledWith('/api/alerts/incident/backup/offer', { note: 'I can assist' })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Accept lead handoff' })).not.toBeInTheDocument()
  })

  it('offers handoff only to returned backup candidates, without transferring leadership early', async () => {
    const user = userEvent.setup()
    mocks.coordination.backup = { requested: true, offers: [{ volunteer_id: 'backup', name: 'Available volunteer', note: 'Synthetic offer' }] }
    mocks.post.mockImplementation(async (_path, payload) => {
      mocks.coordination.handoff = { id: 'offer-token', to_volunteer_id: payload.volunteer_id, expires_at: '2099-01-01T00:00:00Z' }
      return { data: structuredClone(mocks.coordination) }
    })
    mount()
    await lead()
    await user.click(screen.getByRole('button', { name: 'Backup and handoff' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Offer lead role to' }), 'backup')
    await user.click(screen.getByRole('button', { name: 'Offer lead handoff' }))
    await screen.findByText(/Handoff is awaiting/)
    expect(mocks.post).toHaveBeenCalledWith('/api/alerts/incident/handoff', { volunteer_id: 'backup' })
    expect(mocks.coordination.lead_id).toBe('lead')
    expect(screen.getByRole('button', { name: 'Share location for 30 minutes' })).toBeInTheDocument()
  })

  it('requires named recipient acknowledgement and leaves consent off on acceptance', async () => {
    mocks.auth.user = { id: 'backup', role: 'volunteer' }
    Object.assign(mocks.coordination, { can_manage: false, can_share_location: false, can_handoff: false, can_accept_handoff: true, handoff: { id: 'offer-token' } })
    mocks.post.mockImplementation(async () => {
      Object.assign(mocks.coordination, { lead_id: 'backup', can_manage: true, can_share_location: true, can_accept_handoff: false, handoff: null })
      return { data: structuredClone(mocks.coordination) }
    })
    mount({ ...alert, handoff_offered_to_me: true })
    await screen.findByRole('button', { name: 'Accept lead handoff' })
    expect(mocks.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Accept lead handoff' }))
    await lead()
    expect(mocks.post).toHaveBeenCalledWith('/api/alerts/incident/handoff/accept', { handoff_id: 'offer-token' })
    expect(screen.queryByRole('button', { name: 'Stop sharing location' })).not.toBeInTheDocument()
  })

  it('labels retained data as cached and disables changes after a refresh failure', async () => {
    mount()
    await lead()
    mocks.get.mockRejectedValue(new Error('Offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['coordination', 'lead', 'incident'] }) })
    await screen.findByText(/Cached, not current/)
    expect(screen.getByRole('button', { name: 'Share location for 30 minutes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
  it('lets the current lead cancel an offered handoff without losing responsibility', async () => {
    mocks.coordination.handoff = { id: 'offer-token', to_volunteer_id: 'backup' }
    mocks.delete.mockImplementation(async () => { mocks.coordination.handoff = null; return { data: structuredClone(mocks.coordination) } })
    mount()
    await lead()
    fireEvent.click(screen.getByRole('button', { name: 'Backup and handoff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel handoff offer' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel handoff offer' })).not.toBeInTheDocument())
    expect(mocks.delete).toHaveBeenCalledWith('/api/alerts/incident/handoff', undefined)
    expect(mocks.coordination.lead_id).toBe('lead')
  })
  it('lets the named recipient decline without becoming lead or enabling sharing', async () => {
    mocks.auth.user = { id: 'backup', role: 'volunteer' }
    Object.assign(mocks.coordination, { can_manage: false, can_share_location: false, can_accept_handoff: true, handoff: { id: 'offer-token' } })
    mocks.post.mockResolvedValue({ data: { declined: true, alert_id: 'incident' } })
    mount({ ...alert, handoff_offered_to_me: true })
    await screen.findByRole('button', { name: 'Decline handoff' })
    fireEvent.click(screen.getByRole('button', { name: 'Decline handoff' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Lead handoff declined')
    expect(mocks.post).toHaveBeenCalledWith('/api/alerts/incident/handoff/decline', { handoff_id: 'offer-token' })
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('removes private controls immediately after a forbidden refresh, not just on account changes', async () => {
    mocks.coordination.backup = { requested: true, offers: [{ volunteer_id: 'backup', name: 'Private candidate', note: 'Private note' }] }
    mount()
    await lead()
    fireEvent.click(screen.getByRole('button', { name: 'Backup and handoff' }))
    expect(screen.getByText('Private note')).toBeVisible()
    mocks.get.mockRejectedValue({ response: { status: 403, data: { detail: 'Lead changed' } } })
    await act(async () => { await client.invalidateQueries({ queryKey: ['coordination', 'lead', 'incident'] }) })
    await screen.findByText('Lead changed')
    expect(screen.queryByText('Private note')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share location for 30 minutes' })).not.toBeInTheDocument()
  })

  it('cancels unused private reads and never automatically retries a failed mutation', async () => {
    const view = mount()
    await lead()
    mocks.patch.mockRejectedValue(new Error('Offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Share location for 30 minutes' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('Offline')
    expect(mocks.patch).toHaveBeenCalledOnce()
    view.unmount()
    let signal
    mocks.get.mockImplementation((_path, options) => { signal = options.signal; return new Promise(() => {}) })
    const pending = mount()
    pending.unmount()
    expect(signal.aborted).toBe(true)
  })
})
