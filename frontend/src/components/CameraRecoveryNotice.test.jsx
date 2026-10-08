import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CameraRecoveryNotice from './CameraRecoveryNotice'

const mocks = vi.hoisted(() => ({
  native: true, user: null, read: vi.fn(), recover: vi.fn(), candidate: vi.fn(), add: vi.fn(), remove: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.add } }))
vi.mock('../utils/nativeCamera', () => ({ hasNativeCamera: () => mocks.native }))
vi.mock('../utils/cameraRecovery', () => ({
  CAMERA_RECOVERY_EVENT: 'camera-recovery:changed', readCameraRecovery: mocks.read, recoverCameraResult: mocks.recover,
  cameraRestorationCandidate: mocks.candidate,
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))

const view = (path = '/') => <MemoryRouter initialEntries={[path]}><CameraRecoveryNotice /></MemoryRouter>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.native = true
  mocks.user = null
  mocks.read.mockResolvedValue(null)
  mocks.recover.mockResolvedValue(null)
  mocks.candidate.mockResolvedValue('boot-camera-session')
  mocks.add.mockResolvedValue({ remove: mocks.remove })
})

describe('native camera recovery notice', () => {
  it('does not install a native listener or read saved camera drafts on the website', () => {
    mocks.native = false
    render(view())
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('offers only explicit draft review, without exposing text, photos, location or automatic navigation', async () => {
    mocks.read.mockResolvedValue({ id: 'session', draft: { description: 'Private incident text' }, photo: { webPath: '/private-photo' } })
    render(view())
    expect(await screen.findByRole('complementary', { name: 'Unsent camera draft' })).toHaveTextContent('has not been sent')
    expect(screen.getByRole('link', { name: 'Review saved draft' })).toHaveAttribute('href', '/post-alert')
    expect(screen.queryByText('Private incident text')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('hides a previous account synchronously and ignores its late IndexedDB reply', async () => {
    mocks.user = { id: 'account-a' }
    mocks.read.mockResolvedValueOnce({ id: 'a' })
    const mounted = render(view())
    await screen.findByRole('complementary')
    let resolve
    mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    mocks.user = { id: 'account-b' }
    mounted.rerender(view())
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    mocks.user = { id: 'account-c' }
    mocks.read.mockResolvedValueOnce(null)
    mounted.rerender(view())
    await act(async () => resolve({ id: 'private-b' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('handles restored results at app scope and removes the exact listener on unmount', async () => {
    const mounted = render(view('/post-alert'))
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith('appRestoredResult', expect.any(Function)))
    const event = { pluginId: 'Camera', methodName: 'takePhoto', success: true, data: {} }
    await act(async () => mocks.add.mock.calls[0][1](event))
    expect(mocks.recover).toHaveBeenCalledWith(event, 'boot-camera-session')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    mounted.unmount()
    expect(mocks.remove).toHaveBeenCalledOnce()
    mocks.add.mock.calls[0][1](event)
    expect(mocks.recover).toHaveBeenCalledOnce()
  })

  it('removes a listener that resolves after unmount and tolerates unavailable storage', async () => {
    let resolve
    mocks.add.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    mocks.read.mockRejectedValue(new Error('Unavailable'))
    const mounted = render(view())
    await waitFor(() => expect(mocks.add).toHaveBeenCalledOnce())
    mounted.unmount()
    await act(async () => resolve({ remove: mocks.remove }))
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it('refreshes on restoration without showing stale answers from an earlier refresh', async () => {
    let resolve
    mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(view())
    mocks.read.mockResolvedValueOnce({ id: 'new-camera' })
    await act(async () => window.dispatchEvent(new Event('camera-recovery:changed')))
    await screen.findByRole('complementary')
    await act(async () => resolve(null))
    expect(screen.getByRole('complementary')).toBeVisible()
  })

  it('does not bind a boot with no pending camera to a subsequently created session', async () => {
    mocks.candidate.mockResolvedValueOnce(null)
    render(view())
    await waitFor(() => expect(mocks.add).toHaveBeenCalledOnce())
    mocks.candidate.mockResolvedValue('newer-session')
    const event = { pluginId: 'Camera', methodName: 'takePhoto', success: true, data: {} }
    await act(async () => mocks.add.mock.calls[0][1](event))
    expect(mocks.candidate).toHaveBeenCalledOnce()
    expect(mocks.recover).toHaveBeenCalledWith(event, null)
  })

  it('expires an always-visible notice at its TTL boundary', async () => {
    vi.useFakeTimers()
    try {
      mocks.read.mockResolvedValueOnce({ id: 'expiring', expiresAt: Date.now() + 100 })
      render(view())
      await act(async () => {})
      expect(screen.getByRole('complementary')).toBeVisible()
      mocks.read.mockResolvedValueOnce(null)
      await act(async () => vi.advanceTimersByTimeAsync(100))
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
})
