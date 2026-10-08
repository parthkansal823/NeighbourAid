export const RELEASES_API = 'https://api.github.com/repos/parthkansal823/NeighbourAid/releases/latest'
const REPO_PREFIX = '/parthkansal823/NeighbourAid/releases/'
export const MAX_UPDATE_BYTES = 100 * 1024 * 1024
const TAG = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}'

function trustedUrl(raw, kind) {
  try {
    if (typeof raw !== 'string' || raw.includes('?') || raw.includes('#')) return null
    const url = new URL(raw)
    const path = kind === 'download' ? `download/(${TAG})/app-release\\.apk` : `tag/(${TAG})`
    const match = url.pathname.match(new RegExp(`^${REPO_PREFIX}${path}$`))
    // GitHub's canonical URLs need no normalization, escaping or extra path.
    return url.href === raw && url.origin === 'https://github.com' && !url.username && !url.password &&
      !url.search && !url.hash && match && !match[1].includes('..')
      ? url.href : null
  } catch {
    return null
  }
}

export function trustedUpdateDownload(raw) {
  return trustedUrl(raw, 'download')
}

export function validUpdateSize(size) {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_UPDATE_BYTES
}

export function normalizeUpdateSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}

export function updateFromRelease(release, currentVersionCode) {
  if (!release || release.draft || release.prerelease) return null
  if (typeof release.body !== 'string' || !Array.isArray(release.assets)) return null
  if (!Number.isSafeInteger(currentVersionCode) || currentVersionCode < 0) return null
  const matches = [...release.body.matchAll(/<!--\s*neighbouraid-update:(\{[^\r\n]*\})\s*-->/g)]
  if (matches.length !== 1) return null
  let version
  try { version = JSON.parse(matches[0][1]) } catch { return null }
  if (!version || !Number.isSafeInteger(version.versionCode) || version.versionCode < 1 || version.versionCode <= currentVersionCode ||
      version.versionCode > 2100000000 || typeof version.versionName !== 'string' ||
      !version.versionName.trim() || version.versionName.length > 80) return null
  const assets = release.assets.filter(item => item?.name === 'app-release.apk')
  if (assets.length !== 1) return null
  const asset = assets[0]
  if (asset.state !== 'uploaded' || !validUpdateSize(asset.size)) return null
  const downloadUrl = trustedUpdateDownload(asset?.browser_download_url)
  const releaseUrl = trustedUrl(release.html_url, 'release')
  if (!downloadUrl || !releaseUrl) return null
  const tag = new URL(releaseUrl).pathname.split('/').at(-1)
  if (new URL(downloadUrl).pathname !== `${REPO_PREFIX}download/${tag}/app-release.apk` ||
      (release.tag_name != null && release.tag_name !== tag)) return null
  if (version.expectedSize != null && (!validUpdateSize(version.expectedSize) || version.expectedSize !== asset.size)) return null
  const bodySha = version.sha256 == null ? null : normalizeUpdateSha256(version.sha256)
  if (version.sha256 != null && !bodySha) return null
  const assetSha = asset.digest == null ? null :
    typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? normalizeUpdateSha256(asset.digest.slice(7)) : null
  if (asset.digest != null && !assetSha) return null
  if (bodySha && assetSha && bodySha !== assetSha) return null
  return { versionCode: version.versionCode, versionName: version.versionName, downloadUrl, releaseUrl,
    expectedSize: asset.size, sha256: assetSha || bodySha }
}

export async function latestAppUpdate(currentVersionCode, fetchImpl = fetch, { reportUnavailable = false } = {}) {
  const response = await fetchImpl(RELEASES_API, {
    signal: AbortSignal.timeout(8000), credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/vnd.github+json' },
  })
  // No release yet, or GitHub's public read limit: never block the crisis UI.
  if (response.status === 404) return null
  if (response.status === 429 || response.status === 403) {
    if (reportUnavailable) throw new Error('Public update service unavailable')
    return null
  }
  if (!response.ok) throw new Error('Could not check for an app update')
  return updateFromRelease(await response.json(), currentVersionCode)
}
