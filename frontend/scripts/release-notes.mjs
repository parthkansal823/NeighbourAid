import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function releaseVersionCode(body = '') {
  try {
    const match = body.match(/<!--\s*neighbouraid-update:(\{[^\r\n]*\})\s*-->/)
    const code = JSON.parse(match?.[1] || '{}').versionCode
    return Number.isSafeInteger(code) && code > 0 && code <= 2100000000 ? code : 0
  } catch { return 0 }
}

export function releaseNotes(versionCode, versionName) {
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 ||
      typeof versionName !== 'string' || !versionName.trim() || versionName.length > 80) {
    throw new Error('Invalid Android release version metadata')
  }
  return [
    `<!-- neighbouraid-update:${JSON.stringify({ versionCode, versionName })} -->`,
    '',
    'Download **app-release.apk** on an Android phone and confirm installation.',
    'The APK uses the real NeighbourAid API; live data needs the backend to be running.',
    'Existing signed releases can be updated using the same signing key.',
    'A debug/test APK uses a different key and may need uninstalling first. Do not discard unsent offline reports.',
    '',
    'A SHA-256 checksum is attached as **app-release.apk.sha256**.',
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2]
  if (!output) throw new Error('Pass the release notes output path')
  await writeFile(output, releaseNotes(Number(process.env.VERSION_CODE), process.env.VERSION_NAME), { mode: 0o600 })
}
