import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AndroidUpdateAction from './AndroidUpdateAction'
import { I18nProvider } from '../utils/i18n'

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), install: vi.fn(), cancel: vi.fn() }))
vi.mock('../utils/androidUpdate', async original => ({ ...(await original()),
  startDirectUpdate: mocks.start, directUpdateStatus: mocks.status, installDirectUpdate: mocks.install, cancelDirectUpdate: mocks.cancel,
}))
const update = { versionCode: 42, versionName: 'build-42', downloadUrl: 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-42/app-release.apk' }
const renderAction = (candidate = update) => render(<I18nProvider><AndroidUpdateAction update={candidate} /></I18nProvider>)
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  mocks.status.mockResolvedValue({ state: 'idle' })
  mocks.start.mockResolvedValue({ state: 'downloading', percent: 10, versionCode: 42 })
  mocks.install.mockResolvedValue({ state: 'installer' })
  mocks.cancel.mockResolvedValue(undefined)
})

describe('direct Android update', () => {
  it('does not download or install before a user action', async () => {
    renderAction()
    await act(async () => {})
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('downloads inside the app and then opens the user-confirmed installer', async () => {
    renderAction()
    await act(async () => {})
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42 })
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce())
    expect(mocks.start).toHaveBeenCalledWith(update)
    expect(screen.getByText(/Confirm the update in the Android installer/)).toBeInTheDocument()
  })
  it('recovers a completed download without silently installing it', async () => {
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42 })
    renderAction()
    expect(await screen.findByRole('button', { name: 'Install update' })).toBeInTheDocument()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
  })
  it('shows progress and cancels only the updater download', async () => {
    mocks.status.mockResolvedValue({ state: 'paused', percent: 36, versionCode: 42 })
    renderAction()
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '36')
    expect(screen.getByRole('button', { name: 'Cancel download' })).toHaveClass('app-secondary-button')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument()
  })
  it.each([[135, 100], [-25, 0]])('keeps out-of-range download progress readable (%s%%)', async (reported, displayed) => {
    mocks.status.mockResolvedValue({ state: 'downloading', percent: reported, versionCode: 42 })
    renderAction()
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', String(displayed))
    expect(screen.getByRole('status')).toHaveTextContent(`${displayed}%`)
  })
  it('guides the permission step and lets the user retry installation', async () => {
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42 })
    mocks.install.mockResolvedValueOnce({ state: 'permission' })
    renderAction()
    await userEvent.click(await screen.findByRole('button', { name: 'Install update' }))
    expect(screen.getByText(/Allow installs from NeighbourAid/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Install update' }))
    expect(mocks.install).toHaveBeenCalledTimes(2)
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('blocks a signer mismatch without uninstalling or claiming success', async () => {
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42 })
    mocks.install.mockRejectedValue(Object.assign(new Error('Wrong key'), { code: 'SIGNATURE_MISMATCH' }))
    renderAction()
    await userEvent.click(await screen.findByRole('button', { name: 'Install update' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('saved data have not been changed')
    expect(screen.queryByText(/^Updated successfully$/)).not.toBeInTheDocument()
  })
  it.each(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'])('lets the user discard a %s failure and download a fresh APK', async code => {
    const candidate = { ...update, sha256: 'a'.repeat(64), expectedSize: 4096 }
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42, checksumAvailable: true })
    mocks.install.mockRejectedValueOnce(Object.assign(new Error('Integrity mismatch'), { code }))
    renderAction(candidate)
    await userEvent.click(await screen.findByRole('button', { name: 'Install update' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('checksum or file-size check')
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was installed')
    expect(screen.queryByText(/Confirm the update in the Android installer/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Discard downloaded APK' }))
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard downloaded APK' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled()

    mocks.status.mockResolvedValue({ state: 'downloading', percent: 10, versionCode: 42, checksumAvailable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(candidate)
    expect(await screen.findByRole('button', { name: 'Cancel download' })).toBeEnabled()
    expect(mocks.install).toHaveBeenCalledOnce() // Never retry the discarded APK.
  })
  it('reports a resumed legacy download without checksum even when the latest release advertises one', async () => {
    mocks.status.mockResolvedValue({ state: 'ready', versionCode: 42, checksumAvailable: false, checksumVerified: false })
    renderAction({ ...update, sha256: 'a'.repeat(64), expectedSize: 4096 })
    expect(await screen.findByRole('button', { name: 'Install update' })).toBeInTheDocument()
    expect(screen.getByText(/This download does not include a checksum/)).toBeInTheDocument()
    expect(screen.queryByText(/^SHA-256, package, version and signing key are checked before installation\.$/)).not.toBeInTheDocument()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
  })
  it('does not open the installer after the update UI unmounts', async () => {
    let finish
    mocks.start.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = renderAction()
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    view.unmount()
    await act(async () => finish({ state: 'ready', versionCode: 42 }))
    expect(mocks.install).not.toHaveBeenCalled()
  })
})
