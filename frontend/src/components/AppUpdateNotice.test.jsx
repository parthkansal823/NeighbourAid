import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AppUpdateNotice from './AppUpdateNotice'
import en from '../i18n/en'

const { isNativeApp, latestAppUpdate, hasReleaseUpdateChannel, listenForUpdateTap, notifyAppUpdate } = vi.hoisted(() => ({
  isNativeApp: vi.fn(), latestAppUpdate: vi.fn(), hasReleaseUpdateChannel: vi.fn(),
  listenForUpdateTap: vi.fn(), notifyAppUpdate: vi.fn(),
}))
vi.mock('../utils/runtime', () => ({ isNativeApp }))
vi.mock('../utils/appUpdate', () => ({ latestAppUpdate }))
vi.mock('../utils/updateChannel', () => ({ hasReleaseUpdateChannel }))
vi.mock('../utils/androidUpdate', () => ({ UPDATE_CHECK_EVENT: 'neighbouraid:check-update', UPDATE_RESULT_EVENT: 'neighbouraid:update-result' }))
vi.mock('./AndroidUpdateAction', () => ({
  default: () => <button type="button" data-update-primary>Update now</button>,
}))
vi.mock('../utils/updateNotification', () => ({
  enableUpdateNotifications: vi.fn().mockResolvedValue(true),
  listenForUpdateTap,
  notifyAppUpdate,
  openAppUpdate: vi.fn().mockResolvedValue(true),
}))
const translate = key => en[key]
vi.mock('../utils/i18n', () => ({ useI18n: () => ({ t: translate }) }))

const update = { versionCode: 12, versionName: 'build-12', downloadUrl: 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-12/app-release.apk' }
const renderNotice = () => render(<MemoryRouter><AppUpdateNotice /></MemoryRouter>)
beforeEach(() => {
  isNativeApp.mockReturnValue(true)
  hasReleaseUpdateChannel.mockReturnValue(true)
  latestAppUpdate.mockResolvedValue(update)
  listenForUpdateTap.mockResolvedValue(null)
  notifyAppUpdate.mockResolvedValue(false)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs() })

describe('app update prompt', () => {
  it('does not activate APK updates in a demo even with release-channel metadata', () => {
    vi.stubEnv('MODE', 'demo')
    renderNotice()
    expect(latestAppUpdate).not.toHaveBeenCalled()
    expect(listenForUpdateTap).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not compare a local Android Studio build with signed releases', async () => {
    hasReleaseUpdateChannel.mockReturnValue(false)
    renderNotice()
    act(() => {
      window.dispatchEvent(new Event('neighbouraid:check-update'))
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {})
    expect(latestAppUpdate).not.toHaveBeenCalled()
    expect(listenForUpdateTap).not.toHaveBeenCalled()
    expect(notifyAppUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('defers the update modal while someone is reporting an emergency', async () => {
    render(<MemoryRouter initialEntries={['/post-alert']}><AppUpdateNotice /></MemoryRouter>)
    await waitFor(() => expect(latestAppUpdate).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('does not check for APKs on the website', () => {
    isNativeApp.mockReturnValue(false)
    renderNotice()
    expect(latestAppUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens a focused update screen as soon as a release is found', async () => {
    renderNotice()
    expect(await screen.findByRole('dialog')).toHaveTextContent('build-12')
    expect(screen.getByRole('link', { name: /view update details/i })).toHaveAttribute('href', '/app-updates')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update now' })).toHaveFocus())
  })

  it('dismisses this release but still shows a future one', async () => {
    const view = renderNotice()
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem('neighbouraid-dismissed-release')).toBe('12')
    view.unmount()
    const same = renderNotice()
    await waitFor(() => expect(latestAppUpdate).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    same.unmount()
    latestAppUpdate.mockResolvedValue({ ...update, versionCode: 13, versionName: 'build-13' })
    renderNotice()
    expect(await screen.findByRole('dialog')).toHaveTextContent('build-13')
  })

  it('waits offline and checks when the phone reconnects', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderNotice()
    expect(latestAppUpdate).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('fails quietly and retries on a later foreground event', async () => {
    latestAppUpdate.mockRejectedValueOnce(new Error('offline'))
    renderNotice()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(latestAppUpdate).toHaveBeenCalledTimes(2)
  })

  it('throttles repeated foreground events after a successful check', async () => {
    renderNotice()
    await screen.findByRole('dialog')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
    })
    expect(latestAppUpdate).toHaveBeenCalledOnce()
  })

  it('a manual check bypasses throttling and restores a dismissed release', async () => {
    localStorage.setItem('neighbouraid-dismissed-release', '12')
    renderNotice()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('neighbouraid:check-update')))
    expect(await screen.findByRole('dialog')).toHaveTextContent('build-12')
    expect(latestAppUpdate).toHaveBeenCalledTimes(2)
  })

  it('lets someone leave the prompt with Escape', async () => {
    renderNotice()
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
