import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enableUpdateNotifications, listenForUpdateTap, notifyAppUpdate, openAppUpdate } from './updateNotification'

const mocks = vi.hoisted(() => ({
  native: vi.fn(() => true), permission: vi.fn(), request: vi.fn(), schedule: vi.fn(),
  channel: vi.fn(), listen: vi.fn(), launch: vi.fn(),
}))
vi.mock('./runtime', () => ({ isNativeApp: mocks.native }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  checkPermissions: mocks.permission, requestPermissions: mocks.request,
  schedule: mocks.schedule, createChannel: mocks.channel, addListener: mocks.listen,
} }))
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: mocks.launch } }))

const update = { versionCode: 42, versionName: 'build-42', downloadUrl: 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-42/app-release.apk' }
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.native.mockReturnValue(true)
  mocks.permission.mockResolvedValue({ display: 'granted' })
  mocks.request.mockResolvedValue({ display: 'granted' })
  mocks.schedule.mockResolvedValue({ notifications: [] })
  mocks.launch.mockResolvedValue({ completed: true })
})

describe('native update notification', () => {
  it('never prompts for permission automatically', async () => {
    mocks.permission.mockResolvedValue({ display: 'prompt' })
    expect(await notifyAppUpdate(update, 'Update', 'build-42')).toBe(false)
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('prompts only on explicit opt-in', async () => {
    expect(await enableUpdateNotifications()).toBe(true)
    expect(mocks.request).toHaveBeenCalledOnce()
  })
  it('notifies once per release and does not install anything silently', async () => {
    expect(await notifyAppUpdate(update, 'Update', 'build-42')).toBe(true)
    expect(await notifyAppUpdate(update, 'Update', 'build-42')).toBe(false)
    expect(mocks.schedule).toHaveBeenCalledOnce()
    expect(mocks.launch).not.toHaveBeenCalled()
  })
  it('does not mark an unsuccessful schedule as delivered', async () => {
    mocks.schedule.mockRejectedValueOnce(new Error('OS unavailable'))
    await expect(notifyAppUpdate(update, 'Update', 'build-42')).rejects.toThrow()
    expect(localStorage.getItem('neighbouraid-notified-release')).toBeNull()
    expect(await notifyAppUpdate(update, 'Update', 'build-42')).toBe(true)
  })
  it('revalidates a notification tap URL', async () => {
    await listenForUpdateTap()
    const listener = mocks.listen.mock.calls[0][1]
    listener({ notification: { id: 1900000001, extra: { downloadUrl: 'https://evil.com/app-release.apk' } } })
    await Promise.resolve()
    expect(mocks.launch).not.toHaveBeenCalled()
    listener({ notification: { id: 1900000001, extra: { downloadUrl: update.downloadUrl } } })
    await Promise.resolve()
    expect(mocks.launch).toHaveBeenCalledWith({ url: update.downloadUrl })
  })
  it('does not launch arbitrary assets or run on the web', async () => {
    expect(await openAppUpdate(update.downloadUrl.replace('app-release.apk', 'virus.apk'))).toBe(false)
    mocks.native.mockReturnValue(false)
    expect(await notifyAppUpdate(update, 'Update', 'build-42')).toBe(false)
    expect(await enableUpdateNotifications()).toBe(false)
    expect(await openAppUpdate(update.downloadUrl)).toBe(false)
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
