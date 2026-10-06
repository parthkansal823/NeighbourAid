import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releaseNotes, releaseVersionCode } from './release-notes.mjs'

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
