export const RELEASES_API = 'https://api.github.com/repos/parthkansal823/NeighbourAid/releases/latest'
const REPO_PREFIX = '/parthkansal823/NeighbourAid/releases/'

function trustedUrl(raw, prefix) {
  try {
    const url = new URL(raw)
    return url.origin === 'https://github.com' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname.startsWith(prefix)
      ? url.href : null
  } catch {
    return null
  }
}

export function updateFromRelease(release, currentVersionCode) {
  if (!release || release.draft || release.prerelease) return null
  if (typeof release.body !== 'string' || !Array.isArray(release.assets)) return null
  const match = release.body.match(/<!--\s*neighbouraid-update:(\{[^\r\n]*\})\s*-->/)
  if (!match) return null
  let version
  try { version = JSON.parse(match[1]) } catch { return null }
  if (!version || !Number.isSafeInteger(version.versionCode) || version.versionCode < 1 || version.versionCode <= currentVersionCode ||
      version.versionCode > 2100000000 || typeof version.versionName !== 'string' ||
      !version.versionName.trim() || version.versionName.length > 80) return null
  const asset = release.assets.find((item) => item?.name === 'app-release.apk' && item.state === 'uploaded' && Number.isSafeInteger(item.size) && item.size > 0)
  const downloadUrl = trustedUrl(asset?.browser_download_url, `${REPO_PREFIX}download/`)
  const releaseUrl = trustedUrl(release.html_url, `${REPO_PREFIX}tag/`)
  if (!downloadUrl || !releaseUrl || !new URL(downloadUrl).pathname.endsWith('/app-release.apk')) return null
  return { versionCode: version.versionCode, versionName: version.versionName, downloadUrl, releaseUrl }
}

export async function latestAppUpdate(currentVersionCode, fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_API, {
    signal: AbortSignal.timeout(8000), credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/vnd.github+json' },
  })
  // No release yet, or GitHub's public read limit: never block the crisis UI.
  if (response.status === 404 || response.status === 429 || response.status === 403) return null
  if (!response.ok) throw new Error('Could not check for an app update')
  return updateFromRelease(await response.json(), currentVersionCode)
}
