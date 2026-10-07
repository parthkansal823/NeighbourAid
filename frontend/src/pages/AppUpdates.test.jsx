import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppUpdates from './AppUpdates'
import { I18nProvider } from '../utils/i18n'

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  platform: vi.fn(),
  latest: vi.fn(),
  enableNotifications: vi.fn(),
  notify: vi.fn(),
  open: vi.fn(),
}))

vi.mock('@capacitor/core', async original => {
  const actual = await original()
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: mocks.platform } }
})
vi.mock('../utils/runtime', () => ({ isNativeApp: mocks.native }))
vi.mock('../utils/appUpdate', () => ({ latestAppUpdate: mocks.latest }))
vi.mock('../utils/updateNotification', () => ({
  enableUpdateNotifications: mocks.enableNotifications,
  notifyAppUpdate: mocks.notify,
  openAppUpdate: mocks.open,
}))
vi.mock('../components/AndroidUpdateAction', () => ({
  default: () => <button type="button">Update now</button>,
}))

const update = {
  versionCode: __APP_BUILD__.versionCode + 1,
  versionName: 'next-signed-release',
  downloadUrl: 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-next/app-release.apk',
}
const renderPage = () => render(<I18nProvider><AppUpdates /></I18nProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.native.mockReturnValue(true)
  mocks.platform.mockReturnValue('android')
  mocks.latest.mockResolvedValue(update)
  mocks.enableNotifications.mockResolvedValue(true)
  mocks.notify.mockResolvedValue(true)
  mocks.open.mockResolvedValue(true)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('AppUpdates', () => {
  it('does not offer APK controls or check for releases on the website', () => {
    mocks.native.mockReturnValue(false)
    renderPage()
    expect(screen.getByRole('heading', { name: 'App updates' })).toBeInTheDocument()
    expect(screen.getByText(/website receives updates automatically/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mocks.latest).not.toHaveBeenCalled()
  })

  it('shows checking feedback and disables repeated checks until it completes', async () => {
    let finish
    mocks.latest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates')
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
    await act(async () => finish(null))
    expect(screen.getByRole('status')).toHaveTextContent('latest signed release')
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled()
  })

  it('separates the installed version from the available release and its update action', async () => {
    renderPage()
    expect(await screen.findByText('New version: next-signed-release')).toBeInTheDocument()
    expect(screen.getByText(__APP_BUILD__.versionName)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toHaveClass('app-secondary-button')
    expect(mocks.latest).toHaveBeenCalledWith(__APP_BUILD__.versionCode, fetch, { reportUnavailable: true })
  })

  it('offers a usable retry when the phone was offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Could not check updates')
    expect(mocks.latest).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByRole('button', { name: 'Update now' })).toBeInTheDocument()
  })

  it('recovers from an unavailable release service without claiming the app is current', async () => {
    mocks.latest.mockRejectedValueOnce(new Error('Service unavailable'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not check updates'))
    expect(screen.queryByText('You have the latest signed release.')).not.toBeInTheDocument()
    mocks.latest.mockResolvedValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('latest signed release'))
  })

  it('requests notification permission only after the explicit action and shows pending feedback', async () => {
    let finish
    mocks.enableNotifications.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    renderPage()
    await screen.findByRole('button', { name: 'Update now' })
    expect(mocks.enableNotifications).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Enable update notifications' }))
    expect(screen.getByRole('button', { name: 'Enabling…' })).toBeDisabled()
    await act(async () => finish(false))
    expect(screen.getByRole('status')).toHaveTextContent('Notifications are off')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('notifies about the available update only after permission was granted', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Update now' })
    await userEvent.click(screen.getByRole('button', { name: 'Enable update notifications' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(update, 'A new version is ready', update.versionName))
    expect(screen.getByRole('status')).toHaveTextContent('Notifications enabled')
  })
})
