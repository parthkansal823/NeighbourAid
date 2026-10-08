import { describe, expect, it, vi } from 'vitest'
import { latestAppUpdate, RELEASES_API, trustedUpdateDownload, updateFromRelease } from './appUpdate'

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
    expect(updateFromRelease(release(), 11)).toEqual({ versionCode: 12, versionName: 'build-12', downloadUrl, releaseUrl, expectedSize: 4096, sha256: null })
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
    for (const change of [{ size: 0 }, { size: 101 * 1024 * 1024 }, { state: 'starter' }, { name: 'app-debug.apk' }]) {
      expect(updateFromRelease(release({ assets: [{ ...item, ...change }] }), 1)).toBeNull()
    }
    expect(updateFromRelease(release({ html_url: 'https://evil.test/release' }), 1)).toBeNull()
  })

  it.each(['extra/path', '../android-12', 'android%2F12', 'android..12', '.hidden', 'android-12/other'])('rejects ambiguous release paths: %s', tag => {
    expect(trustedUpdateDownload(downloadUrl.replace('android-12', tag))).toBeNull()
  })

  it('requires the download, release page and optional tag name to match exactly', () => {
    expect(updateFromRelease(release({ html_url: releaseUrl.replace('android-12', 'android-13') }), 1)).toBeNull()
    expect(updateFromRelease(release({ tag_name: 'android-13' }), 1)).toBeNull()
    expect(updateFromRelease(release({ html_url: `${releaseUrl}/other` }), 1)).toBeNull()
    expect(trustedUpdateDownload(`${downloadUrl}?`)).toBeNull()
    expect(trustedUpdateDownload(`${downloadUrl}#`)).toBeNull()
  })

  it('uses GitHub asset SHA-256 and checks CI metadata consistency', () => {
    const sha256 = 'a'.repeat(64)
    const asset = { ...release().assets[0], digest: `sha256:${sha256}` }
    const body = `<!-- neighbouraid-update:${JSON.stringify({ versionCode: 12, versionName: 'build-12', sha256, expectedSize: 4096 })} -->`
    expect(updateFromRelease(release({ assets: [asset], body }), 1)).toMatchObject({ sha256, expectedSize: 4096 })
    expect(updateFromRelease(release({ assets: [asset] }), 1)).toMatchObject({ sha256 })
    expect(updateFromRelease(release({ body }), 1)).toMatchObject({ sha256 })
    expect(updateFromRelease(release({ assets: [{ ...asset, digest: `sha256:${'b'.repeat(64)}` }], body }), 1)).toBeNull()
    expect(updateFromRelease(release({ body: body.replace('4096', '4097') }), 1)).toBeNull()
  })

  it.each(['sha512:' + 'a'.repeat(64), 'sha256:bad', '', 42])('rejects corrupt advertised digest instead of claiming legacy availability: %s', digest => {
    expect(updateFromRelease(release({ assets: [{ ...release().assets[0], digest }] }), 1)).toBeNull()
  })

  it('rejects duplicate metadata markers, duplicate APKs and invalid checksum/size body values', () => {
    expect(updateFromRelease(release({ body: release().body + release().body }), 1)).toBeNull()
    expect(updateFromRelease(release({ assets: [release().assets[0], release().assets[0]] }), 1)).toBeNull()
    for (const field of [{ sha256: 'bad' }, { expectedSize: 0 }, { expectedSize: 1.5 }]) {
      expect(updateFromRelease(release({ body: `<!-- neighbouraid-update:${JSON.stringify({ versionCode: 12, versionName: 'build-12', ...field })} -->` }), 1)).toBeNull()
    }
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

  it('does not claim there is no update when a manual check is rate-limited', async () => {
    await expect(latestAppUpdate(1, async () => ({ status: 403, ok: false }), { reportUnavailable: true })).rejects.toThrow('unavailable')
  })
})
