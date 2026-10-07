import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AppUpdateNotice from './AppUpdateNotice'
import en from '../i18n/en'

const { isNativeApp, latestAppUpdate } = vi.hoisted(() => ({ isNativeApp: vi.fn(), latestAppUpdate: vi.fn() }))
vi.mock('../utils/runtime', () => ({ isNativeApp }))
vi.mock('../utils/appUpdate', () => ({ latestAppUpdate }))
vi.mock('../utils/androidUpdate', () => ({ UPDATE_CHECK_EVENT: 'neighbouraid:check-update', UPDATE_RESULT_EVENT: 'neighbouraid:update-result' }))
vi.mock('../utils/updateNotification', () => ({
  enableUpdateNotifications: vi.fn().mockResolvedValue(true),
  listenForUpdateTap: vi.fn().mockResolvedValue(null),
  notifyAppUpdate: vi.fn().mockResolvedValue(false),
  openAppUpdate: vi.fn().mockResolvedValue(true),
}))
const translate = key => en[key]
vi.mock('../utils/i18n', () => ({ useI18n: () => ({ t: translate }) }))

const update = { versionCode: 12, versionName: 'build-12', downloadUrl: 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-12/app-release.apk' }
const renderNotice = () => render(<MemoryRouter><AppUpdateNotice /></MemoryRouter>)
beforeEach(() => {
  isNativeApp.mockReturnValue(true)
  latestAppUpdate.mockResolvedValue(update)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('nonblocking app update notice', () => {
  it('does not check for APKs on the website', () => {
    isNativeApp.mockReturnValue(false)
    renderNotice()
    expect(latestAppUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a compact route into the dedicated in-app update screen', async () => {
    renderNotice()
    expect(await screen.findByRole('link')).toHaveAttribute('href', '/app-updates')
    expect(screen.getByRole('status')).toHaveTextContent('build-12')
  })

  it('dismisses this release but still shows a future one', async () => {
    const view = renderNotice()
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem('neighbouraid-dismissed-release')).toBe('12')
    view.unmount()
    const same = renderNotice()
    await waitFor(() => expect(latestAppUpdate).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    same.unmount()
    latestAppUpdate.mockResolvedValue({ ...update, versionCode: 13, versionName: 'build-13' })
    renderNotice()
    expect(await screen.findByRole('status')).toHaveTextContent('build-13')
  })

  it('waits offline and checks when the phone reconnects', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderNotice()
    expect(latestAppUpdate).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('fails quietly and retries on a later foreground event', async () => {
    latestAppUpdate.mockRejectedValueOnce(new Error('offline'))
    renderNotice()
    await act(async () => {})
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(latestAppUpdate).toHaveBeenCalledTimes(2)
  })

  it('throttles repeated foreground events after a successful check', async () => {
    renderNotice()
    await screen.findByRole('status')
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
    expect(screen.queryByRole('link', { name: /a new version is ready/i })).not.toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('neighbouraid:check-update')))
    expect(await screen.findByRole('link', { name: /a new version is ready/i })).toHaveAttribute('href', '/app-updates')
    expect(latestAppUpdate).toHaveBeenCalledTimes(2)
  })
})
