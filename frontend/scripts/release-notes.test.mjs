import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { apkIntegrity, releaseNotes, releaseVersionCode } from './release-notes.mjs'

test('release notes carry monotonically comparable Android build metadata', () => {
  const body = releaseNotes(34, 'build-34')
  assert.equal(releaseVersionCode(body), 34)
  assert.ok(body.includes('app-release.apk'))
  assert.ok(body.includes('unsent offline reports'))
})
test('missing or corrupt older release metadata cannot invent a new version code', () => {
  for (const body of ['', '<!-- neighbouraid-update:{bad} -->', '<!-- neighbouraid-update:{"versionCode":-1} -->']) {
    assert.equal(releaseVersionCode(body), 0)
  }
})
test('invalid build metadata is rejected before publishing', () => {
  for (const code of [0, -1, NaN, 1.5, 2100000001]) assert.throws(() => releaseNotes(code, 'build'))
  assert.throws(() => releaseNotes(1, ''))
})

test('new release metadata contains the actual APK checksum and byte size', async () => {
  // Any immutable byte fixture exercises the stream; signing is checked by
  // apksigner in CI, not invented by this metadata-generation test.
  const path = new URL(import.meta.url)
  const bytes = await readFile(path)
  const integrity = await apkIntegrity(path)
  assert.deepEqual(integrity, { expectedSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  const body = releaseNotes(34, 'build-34', integrity)
  const metadata = JSON.parse(body.match(/neighbouraid-update:(\{[^\r\n]*\})/)[1])
  assert.deepEqual(metadata, { versionCode: 34, versionName: 'build-34', ...integrity })
  assert.ok(body.includes('checks both before offering installation'))
})

test('missing/nonfile APK and malformed checksum/size metadata fail before publication', async () => {
  await assert.rejects(apkIntegrity(new URL('./absent-release.apk', import.meta.url)))
  await assert.rejects(apkIntegrity(new URL('.', import.meta.url)), /Invalid release APK size/)
  for (const integrity of [{ sha256: 'bad', expectedSize: 1 }, { sha256: 'a'.repeat(64), expectedSize: 0 },
    { sha256: 'a'.repeat(64), expectedSize: 1.5 }, { sha256: 'a'.repeat(64), expectedSize: 101 * 1024 * 1024 }]) {
    assert.throws(() => releaseNotes(34, 'build-34', integrity), /integrity metadata/)
  }
})

test('legacy notes do not falsely claim checksum availability and duplicate markers are rejected', () => {
  const body = releaseNotes(34, 'build-34')
  assert.ok(body.includes('Checksum metadata is unavailable'))
  assert.equal(releaseVersionCode(body + body), 0)
  const metadata = { sha256: 'a'.repeat(64), expectedSize: 3, versionCode: 1000 }
  assert.equal(releaseVersionCode(releaseNotes(34, 'build-34', metadata)), 34)
})
