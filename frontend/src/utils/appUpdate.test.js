import { describe, expect, it, vi } from 'vitest'
import { latestAppUpdate, RELEASES_API, updateFromRelease } from './appUpdate'

const downloadUrl = 'https://github.com/parthkansal823/NeighbourAid/releases/download/android-12/app-release.apk'
const releaseUrl = 'https://github.com/parthkansal823/NeighbourAid/releases/tag/android-12'
function release(overrides = {}) {
  return {
    body: '<!-- neighbouraid-update:{"versionCode":12,"versionName":"build-12"} -->',
    html_url: releaseUrl,
    assets: [{ name: 'app-release.apk', state: 'uploaded', size: 4096, browser_download_url: downloadUrl }],
    ...overrides,
  }
}

describe('Android release metadata', () => {
  it('offers only a newer uploaded APK from this repository', () => {
    expect(updateFromRelease(release(), 11)).toEqual({ versionCode: 12, versionName: 'build-12', downloadUrl, releaseUrl })
    expect(updateFromRelease(release(), 12)).toBeNull()
    expect(updateFromRelease(release(), 13)).toBeNull()
  })

  it.each([{ draft: true }, { prerelease: true }, { body: '' }, { body: {} }, { assets: {} }, { assets: [null] }])(
    'ignores incomplete or unpublished releases: %j', (overrides) => {
      expect(updateFromRelease(release(overrides), 1)).toBeNull()
    },
  )

  it.each([null, {}, { versionCode: 0, versionName: 'zero' }, { versionCode: 3.5, versionName: 'fraction' },
    { versionCode: 2100000001, versionName: 'overflow' }, { versionCode: 12, versionName: ' ' }])(
    'rejects invalid version metadata: %j', (metadata) => {
      expect(updateFromRelease(release({ body: `<!-- neighbouraid-update:${JSON.stringify(metadata)} -->` }), 1)).toBeNull()
    },
  )

  it.each(['https://evil.test/app-release.apk', 'http://github.com/parthkansal823/NeighbourAid/releases/download/a/app-release.apk',
    'https://github.com.evil.test/parthkansal823/NeighbourAid/releases/download/a/app-release.apk',
    'https://github.com/other/repo/releases/download/a/app-release.apk', `${downloadUrl}?redirect=evil`,
    `${downloadUrl}#fragment`, downloadUrl.replace('app-release.apk', 'other.apk')])(
    'rejects untrusted or unexpected downloads: %s', (url) => {
      const item = release().assets[0]
      expect(updateFromRelease(release({ assets: [{ ...item, browser_download_url: url }] }), 1)).toBeNull()
    },
  )

  it('requires a complete nonempty asset and a matching repository release page', () => {
    const item = release().assets[0]
    for (const change of [{ size: 0 }, { state: 'starter' }, { name: 'app-debug.apk' }]) {
      expect(updateFromRelease(release({ assets: [{ ...item, ...change }] }), 1)).toBeNull()
    }
    expect(updateFromRelease(release({ html_url: 'https://evil.test/release' }), 1)).toBeNull()
  })
})

describe('public update check', () => {
  it('sends no session token or cookies to GitHub', async () => {
    localStorage.setItem('token', 'private-account-token')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => release() })
    expect(await latestAppUpdate(1, fetchImpl)).toMatchObject({ versionCode: 12 })
    expect(fetchImpl).toHaveBeenCalledWith(RELEASES_API, expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' },
    }))
  })

  it.each([403, 404, 429])('quietly ignores an unavailable public release (%s)', async (status) => {
    expect(await latestAppUpdate(1, async () => ({ status, ok: false }))).toBeNull()
  })

  it('reports an outage to the nonblocking caller', async () => {
    await expect(latestAppUpdate(1, async () => ({ status: 503, ok: false }))).rejects.toThrow('Could not check')
  })
})
