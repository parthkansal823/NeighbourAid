import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startDirectUpdate } from './androidUpdate'

const mocks = vi.hoisted(() => ({ platform: vi.fn(), available: vi.fn(), start: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: mocks.platform, isPluginAvailable: mocks.available } }))
vi.mock('@neighbouraid/app-updater', () => ({ NeighbourAidUpdater: { startDownload: mocks.start } }))
// Android CI supplies VERSION_CODE from its ever-increasing run number.
// A fixed future version eventually becomes an old update and fails before
// the bridge guard is exercised. Keep the fixture newer than this build.
const nextVersionCode = __APP_BUILD__.versionCode + 1
const update = { versionCode: nextVersionCode, downloadUrl: `https://github.com/parthkansal823/NeighbourAid/releases/download/android-${nextVersionCode}/app-release.apk` }
beforeEach(() => { vi.clearAllMocks(); mocks.platform.mockReturnValue('android'); mocks.available.mockReturnValue(true) })
describe('Android updater bridge guard', () => {
  it('starts only the trusted newer update', async () => {
    await startDirectUpdate(update)
    expect(mocks.start).toHaveBeenCalledWith({ url: update.downloadUrl, versionCode: nextVersionCode })
  })
  it('rejects untrusted URLs and non-newer versions', async () => {
    await expect(startDirectUpdate({ ...update, downloadUrl: 'https://evil.test/app-release.apk' })).rejects.toThrow()
    await expect(startDirectUpdate({ ...update, versionCode: __APP_BUILD__.versionCode })).rejects.toThrow()
    await expect(startDirectUpdate({ ...update, versionCode: __APP_BUILD__.versionCode - 1 })).rejects.toThrow()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('cannot use the installer on web or an APK missing the plugin', async () => {
    mocks.platform.mockReturnValue('web')
    await expect(startDirectUpdate(update)).rejects.toMatchObject({ code: 'UPDATER_MISSING' })
    mocks.platform.mockReturnValue('android'); mocks.available.mockReturnValue(false)
    await expect(startDirectUpdate(update)).rejects.toMatchObject({ code: 'UPDATER_MISSING' })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
