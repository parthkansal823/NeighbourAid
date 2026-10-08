import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider, useI18n } from '../utils/i18n'
import AlertCard from './AlertCard'

const mocks = vi.hoisted(() => ({ user: null, get: vi.fn(), patch: vi.fn(), post: vi.fn(), translate: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get, patch: mocks.patch, post: mocks.post } }))
vi.mock('../utils/translate', () => ({ translateText: mocks.translate }))
vi.mock('./Toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('./HelpRelay', () => ({ default: ({ onChanged }) => <button type="button" onClick={() => { void onChanged() }}>Refresh relay snapshot</button> }))
vi.mock('./AutoDispatch', () => ({ default: () => null }))
const alert = { id: 'synthetic-alert', category: 'power', urgency: 'LOW', status: 'open', description: 'Synthetic community report', language: 'en', created_at: '2026-10-01T12:00:00Z', reporter_id: 'reporter', location: { type: 'Point', coordinates: [76, 30] } }
function ReaderControls() {
  const { setLang, setAutoTranslate } = useI18n()
  return <><button type="button" onClick={() => setLang('pa')}>Read in Punjabi</button><button type="button" onClick={() => setAutoTranslate(false)}>Pause automatic translations</button></>
}
const tree = (data, onUpdate) => <MemoryRouter><I18nProvider><ReaderControls /><AlertCard alert={data} onUpdate={onUpdate} /></I18nProvider></MemoryRouter>
const mount = (data = alert, onUpdate = vi.fn()) => render(tree(data, onUpdate))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.get.mockReset().mockResolvedValue({ data: alert })
  mocks.patch.mockReset().mockResolvedValue({ data: { ...alert, status: 'resolved', outcome: 'volunteer_reported_resolved' } })
  mocks.translate.mockReset().mockResolvedValue('Synthetic translation')
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { vi.restoreAllMocks() })

describe('truthful, text-first emergency cards', () => {
  it('shows a closed report with provenance rather than implying the reporter is safe', () => {
    mount({ ...alert, status: 'resolved', outcome: 'expired_unconfirmed' })
    expect(screen.getByText('Closed')).toBeVisible()
    expect(screen.getByText('Closed after expiry; safety not confirmed')).toBeVisible()
    expect(screen.queryByText('Reporter confirmed safe')).not.toBeInTheDocument()
  })
  it('requires explicit confirmation before a volunteer reports resolved', async () => {
    mocks.user = { id: 'lead', role: 'volunteer' }
    const onUpdate = vi.fn()
    mount({ ...alert, status: 'accepted', accepted_by: 'lead' }, onUpdate)
    fireEvent.click(screen.getByRole('button', { name: 'Report resolved' }))
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('not a confirmation that the reporter is safe'))
    window.confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Report resolved' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(mocks.patch).toHaveBeenCalledWith('/api/alerts/synthetic-alert/resolve')
  })
  it('keeps inline photos hidden in text-first mode and closes the photo dialog with Escape', () => {
    localStorage.setItem('neighbouraid:text-first', '1')
    mount({ ...alert, photos: ['data:image/png;base64,SYNTHETIC'], photo_count: 1 })
    expect(screen.queryByRole('img', { name: 'evidence 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View 1 photo' }))
    expect(screen.getByRole('img', { name: 'evidence 1' })).toBeVisible()
    screen.getByRole('button', { name: 'Open photo 1' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1' }))
    expect(screen.getByRole('dialog', { name: 'Report photo' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open photo 1' })).toHaveFocus()
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it('shows a recoverable lazy-photo fetch error instead of silently hiding it', async () => {
    mocks.get.mockRejectedValue(new Error('Synthetic photo download failed'))
    mount({ ...alert, photo_count: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'View 1 photo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic photo download failed')
    expect(screen.getByRole('button', { name: 'View 1 photo' })).toBeEnabled()
  })
  it('does not send machine-translation text until the reader agrees to the disclosure', async () => {
    mount({ ...alert, description: 'यह परीक्षण रिपोर्ट है', language: 'hi' })
    fireEvent.click(screen.getByRole('button', { name: 'Translate to EN' }))
    expect(mocks.translate).not.toHaveBeenCalled()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('this text is sent to Google'))
    window.confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Translate to EN' }))
    expect(await screen.findByText('Synthetic translation')).toBeVisible()
    expect(screen.getByText(/Machine translation may be wrong/)).toBeVisible()
  })
  it('does not redownload report photos during relay refresh in text-first mode', async () => {
    localStorage.setItem('neighbouraid:text-first', '1')
    const onUpdate = vi.fn()
    mount(alert, onUpdate)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh relay snapshot' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(alert))
    expect(mocks.get).toHaveBeenCalledWith('/api/alerts/synthetic-alert', { params: { include_photos: false } })
  })
  it('clears a previous report translation immediately when the source text changes', async () => {
    window.confirm.mockReturnValue(true)
    const data = { ...alert, description: 'यह पहली परीक्षण रिपोर्ट है', language: 'hi' }
    const view = mount(data)
    fireEvent.click(screen.getByRole('button', { name: 'Translate to EN' }))
    await screen.findByText('Synthetic translation')
    const changed = { ...data, description: 'यह दूसरी परीक्षण रिपोर्ट है' }
    view.rerender(tree(changed, vi.fn()))
    expect(screen.getByText(changed.description)).toBeVisible()
    expect(screen.queryByText('Synthetic translation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translate to EN' })).toBeEnabled()
  })
  it('never labels a previous reader-language translation as the newly chosen language', async () => {
    window.confirm.mockReturnValue(true)
    const data = { ...alert, description: 'यह परीक्षण रिपोर्ट है', language: 'hi' }
    mount(data)
    fireEvent.click(screen.getByRole('button', { name: 'Translate to EN' }))
    await screen.findByText('Synthetic translation')
    fireEvent.click(screen.getByRole('button', { name: 'Read in Punjabi' }))
    expect(screen.getByText(data.description)).toBeVisible()
    expect(screen.queryByText('Synthetic translation')).not.toBeInTheDocument()
    mocks.translate.mockResolvedValue('Synthetic Punjabi translation')
    fireEvent.click(screen.getByRole('button', { name: 'Translate to PA' }))
    expect(await screen.findByText('Synthetic Punjabi translation')).toBeVisible()
    expect(mocks.translate).toHaveBeenLastCalledWith(data.description, 'pa', 'hi')
  })
  it('ignores an old in-flight manual result after the report identity changes', async () => {
    window.confirm.mockReturnValue(true)
    let finish
    mocks.translate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const data = { ...alert, description: 'यह पहली परीक्षण रिपोर्ट है', language: 'hi' }
    const view = mount(data)
    fireEvent.click(screen.getByRole('button', { name: 'Translate to EN' }))
    expect(screen.getByRole('button', { name: 'translating…' })).toBeDisabled()
    const changed = { ...data, description: 'यह नई परीक्षण रिपोर्ट है' }
    view.rerender(tree(changed, vi.fn()))
    await act(async () => { finish('Old synthetic result'); await Promise.resolve() })
    expect(screen.getByText(changed.description)).toBeVisible()
    expect(screen.queryByText('Old synthetic result')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Translate to EN' })).toBeEnabled()
  })
  it('cancels the rendered auto-translation state when the reader withdraws automatic consent', async () => {
    localStorage.setItem('autoTranslate', '1')
    let finish
    mocks.translate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const data = { ...alert, description: 'यह परीक्षण रिपोर्ट है', language: 'hi' }
    mount(data)
    expect(screen.getByRole('button', { name: 'translating…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic translations' }))
    expect(screen.getByRole('button', { name: 'Translate to EN' })).toBeEnabled()
    await act(async () => { finish('Unwanted automatic result'); await Promise.resolve() })
    expect(screen.getByText(data.description)).toBeVisible()
    expect(screen.queryByText('Unwanted automatic result')).not.toBeInTheDocument()
  })
})
