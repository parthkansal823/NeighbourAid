import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function releaseVersionCode(body = '') {
  try {
    const matches = [...body.matchAll(/<!--\s*neighbouraid-update:(\{[^\r\n]*\})\s*-->/g)]
    if (matches.length !== 1) return 0
    const code = JSON.parse(matches[0][1]).versionCode
    return Number.isSafeInteger(code) && code > 0 && code <= 2100000000 ? code : 0
  } catch { return 0 }
}

const MAX_BYTES = 100 * 1024 * 1024

export async function apkIntegrity(path) {
  const file = await stat(path)
  if (!file.isFile() || file.size <= 0 || file.size > MAX_BYTES) throw new Error('Invalid release APK size')
  const digest = createHash('sha256')
  let expectedSize = 0
  for await (const chunk of createReadStream(path)) {
    expectedSize += chunk.length
    if (expectedSize > MAX_BYTES) throw new Error('Release APK exceeds the update size limit')
    digest.update(chunk)
  }
  if (expectedSize !== file.size) throw new Error('Release APK changed while checksumming')
  return { sha256: digest.digest('hex'), expectedSize }
}

export function releaseNotes(versionCode, versionName, integrity = null) {
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 ||
      typeof versionName !== 'string' || !versionName.trim() || versionName.length > 80) {
    throw new Error('Invalid Android release version metadata')
  }
  if (integrity && (typeof integrity.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(integrity.sha256) ||
      !Number.isSafeInteger(integrity.expectedSize) || integrity.expectedSize <= 0 || integrity.expectedSize > MAX_BYTES)) {
    throw new Error('Invalid Android release integrity metadata')
  }
  return [
    `<!-- neighbouraid-update:${JSON.stringify({ versionCode, versionName, ...(integrity ? { sha256: integrity.sha256, expectedSize: integrity.expectedSize } : {}) })} -->`,
    '',
    'Download **app-release.apk** on an Android phone and confirm installation.',
    'The APK uses the real NeighbourAid API; live data needs the backend to be running.',
    'Existing signed releases can be updated using the same signing key.',
    'A debug/test APK uses a different key and may need uninstalling first. Do not discard unsent offline reports.',
    '',
    integrity ? `SHA-256: \`${integrity.sha256}\`; APK size: ${integrity.expectedSize} bytes. The in-app updater checks both before offering installation.` :
      'Checksum metadata is unavailable for this legacy release; package, newer-version and signing-key validation remain required.',
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2]
  const apkPath = process.argv[3]
  if (!output || !apkPath) throw new Error('Pass the release notes output path and signed APK path')
  const integrity = await apkIntegrity(apkPath)
  await writeFile(output, releaseNotes(Number(process.env.VERSION_CODE), process.env.VERSION_NAME, integrity), { mode: 0o600 })
}
