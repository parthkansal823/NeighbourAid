import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { ensureRuntimeConfig, newRuntimeConfig } from './server-config.mjs'
import { rotateRuntimeConfig } from './server-rotate.mjs'

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'neighbouraid-rotation-test-'))
  await ensureRuntimeConfig({ directory })
  return { directory, backups: resolve(directory, 'backups') }
}

test('legacy credentials migrate privately without resetting existing database passwords', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'neighbouraid-migration-test-'))
  const previous = newRuntimeConfig()
  await writeFile(resolve(directory, 'runtime-secrets.json'), JSON.stringify(previous))
  await ensureRuntimeConfig({ directory, existingData: true })
  assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'runtime-secrets.private.json'), 'utf8')), previous)
  assert.ok((await readFile(resolve(directory, 'app.private.env'), 'utf8')).includes(previous.appPassword))
})

test('rotation persists recovery keys before mutation and recreates services without deleting volumes', async () => {
  const config = await fixture()
  const source = resolve(config.directory, 'runtime-secrets.private.json')
  const previous = JSON.parse(await readFile(source, 'utf8'))
  const calls = []
  let payload
  await rotateRuntimeConfig({ ...config, compose: (args, options) => {
    calls.push(args)
    if (args[0] === 'exec') {
      payload = JSON.parse(options.input)
      assert.equal(options.stdio[1], 'pipe')
      assert.ok(!args.join(' ').includes(payload.next.appPassword))
    }
  } })
  const current = JSON.parse(await readFile(source, 'utf8'))
  assert.deepEqual(payload.previous, previous)
  assert.deepEqual(payload.next, current)
  for (const key of ['jwtSecret', 'rootPassword', 'appPassword']) assert.notEqual(current[key], previous[key])
  assert.deepEqual(calls[0], ['stop', 'tunnel', 'api'])
  assert.ok(calls.some((args) => args.includes('--force-recreate') && args.includes('api')))
  assert.ok(!calls.flat().includes('--volumes'))
  await assert.rejects(readFile(resolve(config.directory, 'rotation.private.json')), { code: 'ENOENT' })
})

test('an interrupted database mutation retains and reuses the exact recovery identities', async () => {
  const config = await fixture()
  const journal = resolve(config.directory, 'rotation.private.json')
  await assert.rejects(rotateRuntimeConfig({ ...config, compose: (args) => {
    if (args[0] === 'exec') throw new Error('simulated database interruption')
  } }), /Keep rotation.private.json/)
  const pending = JSON.parse(await readFile(journal, 'utf8'))
  let resumed
  await rotateRuntimeConfig({ ...config, compose: (args, options) => {
    if (args[0] === 'exec') resumed = JSON.parse(options.input)
  } })
  assert.deepEqual(resumed, pending)
  assert.deepEqual(JSON.parse(await readFile(resolve(config.directory, 'runtime-secrets.private.json'), 'utf8')), pending.next)
})

test('invalid recovery data fails before stopping services or modifying the database', async () => {
  const config = await fixture()
  await writeFile(resolve(config.directory, 'rotation.private.json'), 'broken')
  let calls = 0
  await assert.rejects(rotateRuntimeConfig({ ...config, compose: () => { calls++ } }), /journal is invalid/)
  assert.equal(calls, 0)
})
