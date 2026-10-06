import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { ensureRuntimeConfig } from './server-config.mjs'

// Each test owns a fresh OS temp directory; never use a real runtime secret.
async function directory() { return mkdtemp(resolve(tmpdir(), 'neighbouraid-config-test-')) }

test('generates independent strong credentials and only an app-scoped URI for the API', async () => {
  const dir = await directory()
  await ensureRuntimeConfig({ directory: dir })
  const values = JSON.parse(await readFile(resolve(dir, 'runtime-secrets.private.json'), 'utf8'))
  for (const key of ['jwtSecret', 'rootPassword', 'appPassword']) assert.match(values[key], /^[a-f0-9]{64}$/)
  assert.equal(new Set([values.jwtSecret, values.rootPassword, values.appPassword]).size, 3)
  const app = await readFile(resolve(dir, 'app.private.env'), 'utf8')
  assert.ok(app.includes(`JWT_SECRET=${values.jwtSecret}`))
  assert.ok(app.includes(`mongodb://neighbouraid_app:${values.appPassword}@mongo:27017/neighbouraid?authSource=neighbouraid`))
  assert.ok(!app.includes(values.rootPassword))
  assert.ok(!app.includes('MONGO_INITDB_ROOT'))
})

test('subsequent setup reuses credentials and repairs generated files', async () => {
  const dir = await directory()
  await ensureRuntimeConfig({ directory: dir })
  const original = await readFile(resolve(dir, 'runtime-secrets.private.json'), 'utf8')
  const expected = await readFile(resolve(dir, 'app.private.env'), 'utf8')
  await writeFile(resolve(dir, 'app.private.env'), '# incomplete generated file')
  await ensureRuntimeConfig({ directory: dir, existingData: true })
  assert.equal(await readFile(resolve(dir, 'runtime-secrets.private.json'), 'utf8'), original)
  assert.equal(await readFile(resolve(dir, 'app.private.env'), 'utf8'), expected)
})

test('missing credentials cannot be regenerated over an existing data volume', async () => {
  const dir = await directory()
  await assert.rejects(ensureRuntimeConfig({ directory: dir, existingData: true }), /Restore runtime-secrets/)
  await assert.rejects(readFile(resolve(dir, 'runtime-secrets.private.json')), { code: 'ENOENT' })
})

test('orphaned generated configuration is retained instead of overwritten', async () => {
  const dir = await directory()
  await writeFile(resolve(dir, 'mongo.private.env'), '# original database configuration')
  await assert.rejects(ensureRuntimeConfig({ directory: dir }), /already exists/)
  assert.equal(await readFile(resolve(dir, 'mongo.private.env'), 'utf8'), '# original database configuration')
})

test('malformed or weak saved secrets fail closed without echoing their values', async () => {
  for (const contents of ['broken', JSON.stringify({ version: 1, jwtSecret: 'private-value' })]) {
    const dir = await directory()
    await writeFile(resolve(dir, 'runtime-secrets.private.json'), contents)
    await assert.rejects(ensureRuntimeConfig({ directory: dir }), (error) => {
      assert.ok(!error.message.includes('private-value'))
      return /invalid/.test(error.message)
    })
    assert.equal(await readFile(resolve(dir, 'runtime-secrets.private.json'), 'utf8'), contents)
  }
})
