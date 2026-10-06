import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateTrackedPaths } from './check-private-files.mjs'

test('rejects private runtime and signing files but permits deliberate public templates', () => {
  const unsafe = ['backend/.env', 'frontend/.env.production', 'deploy/laptop/app.env',
    'deploy/laptop/app.private.env', 'deploy/laptop/runtime-secrets.json',
    'deploy/laptop/runtime-secrets.private.json', 'deploy/laptop/rotation.private.json',
    'backups/backup.archive.gz', 'neighbouraid-release.jks', 'frontend/android/keystore.properties']
  assert.deepEqual(privateTrackedPaths([...unsafe, 'frontend/.env.mobile', '.env.example',
    'frontend/.env.production.example', 'frontend/android/keystore.properties.example', 'README.md']), unsafe)
})
