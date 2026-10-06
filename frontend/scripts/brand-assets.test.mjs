import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
test('every shipped brand size exists with matching PNG dimensions', async () => {
  for (const [name, size] of [['brand-logo.png', 192], ['favicon-32.png', 32], ['favicon-64.png', 64], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['badge-72.png', 72]]) {
    const bytes = await readFile(path.join(root, 'public', name))
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG', name)
    assert.equal(bytes.readUInt32BE(16), size, name)
    assert.equal(bytes.readUInt32BE(20), size, name)
  }
})
test('real, demo, manifest and PPT no longer reference the old brand asset', async () => {
  for (const name of ['index.html', 'demo.html', 'public/manifest.webmanifest', 'public/service-worker.js']) {
    assert.doesNotMatch(await readFile(path.join(root, name), 'utf8'), /favicon\.svg/)
  }
  const ppt = await readFile(path.resolve(root, '../PPT/index.html'), 'utf8')
  assert.equal((ppt.match(/class="brand-logo"/g) || []).length, 10)
  assert.equal((ppt.match(/class="cu-logo/g) || []).length, 10)
})
