import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import OfficialAdvisories from './OfficialAdvisories'
import { activeAdvisories, advisoryLink } from '../utils/advisories'
const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../utils/api', () => ({ default: api }))
const item = { cap_identifier: '42', area: 'Test district', headline: 'Test flood warning', language: 'en-IN', expires_at: new Date(Date.now() + 60000).toISOString(), link: 'https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=42' }
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: { status: 'available', items: [] } }) })
const mount = () => render(<MemoryRouter><I18nProvider><OfficialAdvisories /></I18nProvider></MemoryRouter>)
describe('official warnings without an all-clear claim', () => {
  it('an empty snapshot does not say the user is safe', async () => {
    mount()
    expect(await screen.findByText(/does not mean your area is safe/)).toBeInTheDocument()
  })
  it('a failed request displays actionable unavailability', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    mount()
    expect(await screen.findByText(/not an all-clear/)).toBeInTheDocument()
  })
  it('keeps government instructions separate from general precautions', async () => {
    api.get.mockResolvedValue({ data: { status: 'available', items: [{ ...item, instruction: 'Original authority words', certainty: 'Possible' }], partial: true } })
    mount()
    expect(await screen.findByText('Original authority words')).toBeInTheDocument()
    expect(screen.getByText('Possible')).toBeInTheDocument()
    expect(screen.getByText(/not local evacuation orders/)).toBeInTheDocument()
    expect(screen.getByText(/Only part of the feed/)).toBeInTheDocument()
  })
  it('excludes expired and malicious links client-side too', () => {
    expect(activeAdvisories([{ ...item, expires_at: '2000-01-01' }, { ...item, link: 'https://evil.test/x' }], 'en')).toEqual([])
    expect(advisoryLink(item.link + '&redirect=x')).toBeNull()
  })
  it('shows a warning once in the preferred original language', () => {
    const hindi = { ...item, language: 'hi-IN', headline: 'मूल संदेश' }
    expect(activeAdvisories([item, hindi], 'hi')).toEqual([hindi])
  })
})
