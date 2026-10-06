import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../utils/i18n'
import DoctorReviewPanel from './DoctorReviewPanel'
const mock = vi.hoisted(() => ({ user: { id: 'requester' }, get: vi.fn(), post: vi.fn(), remove: vi.fn() }))
vi.mock('../utils/api', () => ({ default: { get: mock.get, post: mock.post, delete: mock.remove } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
vi.mock('./VoiceInput', () => ({ default: () => <p>Voice draft only</p> }))
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem('lang', 'en'); mock.user = { id: 'requester' }
  mock.get.mockImplementation(async url => ({ data: url.endsWith('/status') ? { accepting_requests: true } : url.endsWith('/me') ? { can_review: false } : [] }))
  mock.post.mockResolvedValue({ data: {} }); mock.remove.mockResolvedValue({ data: {} })
})
function open() { render(<I18nProvider><DoctorReviewPanel /></I18nProvider>); fireEvent.click(screen.getByText('Private clinician review (not for emergencies)')) }
it('requires the adult-self sharing consent, does not auto-send or advertise completed review', async () => {
  open()
  const input = screen.getByRole('textbox', { name: /Your non-emergency question/ })
  fireEvent.change(input, { target: { value: 'How can I arrange a non-urgent local assessment?' } })
  const send = screen.getByRole('button', { name: 'Request private review' })
  expect(send).toBeDisabled(); expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.click(send)
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/api/medical-review/requests', expect.objectContaining({ consent: true, adult_self: true, not_emergency: true })))
  expect(screen.queryByText('Clinician response received')).not.toBeInTheDocument()
})
it('keeps submission disabled without an enrolled clinician and never shows an ordinary user the desk', async () => {
  mock.get.mockImplementation(async url => ({ data: url.endsWith('/status') ? { accepting_requests: false } : url.endsWith('/me') ? { can_review: false } : [] }))
  open()
  expect(await screen.findByText(/No approved clinician is enrolled/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Request private review' })).toBeDisabled()
  expect(screen.queryByText('Clinician review desk')).not.toBeInTheDocument()
})
it('renders a pending request as not verified, with no invented doctor identity', async () => {
  mock.get.mockImplementation(async url => ({ data: url.endsWith('/status') ? { accepting_requests: true } : url.endsWith('/me') ? { can_review: false } : [{ id: 'request', question: 'A private non-urgent question', status: 'claimed', response: null }] }))
  open()
  expect(await screen.findByText('Review pending — not verified')).toBeInTheDocument()
  expect(screen.queryByText('Clinician response received')).not.toBeInTheDocument()
  expect(mock.post).not.toHaveBeenCalled()
})
