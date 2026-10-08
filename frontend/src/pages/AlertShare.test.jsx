import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import AlertShare from './AlertShare'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../components/FirstAidGuide', () => ({ default: () => <button>First aid</button> }))
const alert = { id: 'case', category: 'power', urgency: 'LOW', status: 'resolved', outcome: 'expired_unconfirmed', description: 'Synthetic report description', location: { coordinates: [77, 29] }, photo_count: 1 }
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockReset().mockResolvedValue({ data: alert }) })
const mount = () => render(<MemoryRouter initialEntries={['/alert/case']}><I18nProvider><Routes><Route path="/alert/:id" element={<AlertShare />} /></Routes></I18nProvider></MemoryRouter>)
describe('public alert snapshot provenance and low-data photos', () => {
  it('qualifies an expired closure instead of claiming someone is safe', async () => {
    mount()
    await screen.findByText('Synthetic report description')
    expect(screen.getByText('Closed after expiry; safety not confirmed')).toBeVisible()
    expect(screen.getByText('Closed', { exact: true })).toBeVisible()
    expect(screen.queryByText('Reporter confirmed safe')).not.toBeInTheDocument()
  })
  it('omits base64 photos from text-first reads and fetches them only on explicit choice', async () => {
    localStorage.setItem('neighbouraid:text-first', '1')
    mocks.get.mockImplementation(async path => ({ data: path.endsWith('/photos') ? { photos: ['data:image/jpeg;base64,SYNTHETIC'] } : alert }))
    mount()
    await screen.findByText('Synthetic report description')
    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/case', { params: { include_photos: false } })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load report photos' }))
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/alerts/case/photos'))
    expect(await screen.findByRole('img', { name: 'evidence 1' })).toBeVisible()
  })
})
