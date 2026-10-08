import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareAlert from './ShareAlert'

const mocks = vi.hoisted(() => ({ nativeShare: vi.fn(), toast: vi.fn() }))
vi.mock('../utils/nativeShare', () => ({ nativeShareAlert: mocks.nativeShare, publicAlertUrl: id => `https://example.test/alert/${id}` }))
vi.mock('./Toast', () => ({ useToast: () => ({ push: mocks.toast }) }))
const alert = { id: 'case', description: 'Sensitive synthetic description', address: 'Private test location', responder_phone: 'synthetic-phone', responder_position: [1, 2] }
const open = async () => { render(<ShareAlert alert={alert} />); await userEvent.click(screen.getByRole('button', { name: 'Share' })) }
beforeEach(() => { vi.clearAllMocks(); mocks.nativeShare.mockResolvedValue(false) })
afterEach(() => { vi.restoreAllMocks() })

describe('privacy-conscious alert sharing', () => {
  it('reviews the public link before any native/web sharing or QR network image', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'Share public alert link' })).toBeInTheDocument()
    expect(screen.getByText(/Anyone with this link/)).toBeVisible()
    expect(mocks.nativeShare).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Public link' })).toHaveValue('https://example.test/alert/case')
  })
  it('shares only the URL, never crisis text, address or private fields', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Choose an app' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'NeighbourAid alert', url: 'https://example.test/alert/case' }))
    expect(screen.getByRole('link', { name: 'WhatsApp' }).href).not.toContain('Sensitive')
    expect(new URL(screen.getByRole('link', { name: 'WhatsApp' }).href).searchParams.get('text')).toBe('https://example.test/alert/case')
    delete navigator.share
  })
  it('loads a third-party QR only after the user chooses it and explains its recipient', async () => {
    await open()
    expect(screen.getByText(/QR generation sends/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Generate QR code' }))
    expect(screen.getByRole('img', { name: 'QR code for the public alert link' })).toHaveAttribute('src', expect.stringContaining('api.qrserver.com'))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('status')).toHaveTextContent('QR service unavailable')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled()
  })
})
