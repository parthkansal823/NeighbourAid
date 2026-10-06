import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeShareAlert, publicAlertUrl } from './nativeShare'
const mocks = vi.hoisted(() => ({ native: vi.fn(), share: vi.fn(), canShare: vi.fn() }))
vi.mock('./runtime', () => ({ isNativeApp: mocks.native }))
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share, canShare: mocks.canShare } }))
beforeEach(() => { vi.clearAllMocks(); mocks.native.mockReturnValue(true); mocks.canShare.mockResolvedValue({ value: true }) })
describe('Android public-link sharing', () => {
  it('does not give friends a localhost WebView link', () => {
    expect(publicAlertUrl('case-1')).toBe('https://neighbouraid.kansalp-parth.workers.dev/alert/case-1')
  })
  it('shares only the public link, with no private report fields', async () => {
    expect(await nativeShareAlert('case-1')).toBe(true)
    expect(mocks.share).toHaveBeenCalledWith({ title: 'NeighbourAid alert', url: publicAlertUrl('case-1'), dialogTitle: 'Share alert link' })
    expect(mocks.share.mock.calls[0][0]).not.toHaveProperty('text')
  })
  it('leaves the existing browser sharing flow alone', async () => {
    mocks.native.mockReturnValue(false)
    expect(await nativeShareAlert('case-1')).toBe(false)
    expect(mocks.share).not.toHaveBeenCalled()
  })
})
