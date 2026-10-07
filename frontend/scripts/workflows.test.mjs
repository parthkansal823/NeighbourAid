import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const android = readFileSync(path.join(repo, '.github/workflows/android.yml'), 'utf8').replaceAll('\r', '')
const ci = readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8').replaceAll('\r', '')
const signingNames = [
  'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
]

function jobBlock(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|$(?![\\s\\S]))`, 'm'))
  assert.ok(match, `Missing job ${name}`)
  return match[1]
}

function releaseAllowed(event, ref) {
  // Evaluate the expression from the actual workflow, not a copied policy.
  const lines = jobBlock(android, 'signed-apk-release').split('\n')
  const index = lines.findIndex(line => line.startsWith('    if: '))
  assert.notEqual(index, -1)
  let expression = lines[index].slice('    if: '.length)
  if (expression === '>-' || expression === '>') {
    const length = lines.slice(index + 1).findIndex(line => !line.startsWith('      '))
    assert.ok(length > 0, 'Release condition must be a nonempty folded scalar')
    expression = lines.slice(index + 1, index + 1 + length).join(' ').trim()
  }
  return new Function('github', 'startsWith', `return (${expression})`)(
    { event_name: event, ref }, (value, prefix) => value.startsWith(prefix),
  )
}

for (const [event, ref, expected] of [
  ['push', 'refs/heads/main', true],
  ['push', 'refs/tags/v1.0.0', true],
  ['push', 'refs/heads/feature', false],
  ['pull_request', 'refs/heads/main', false],
  ['workflow_dispatch', 'refs/heads/main', true],
  ['workflow_dispatch', 'refs/heads/feature', false],
  ['workflow_dispatch', 'refs/tags/v1.0.0', false],
]) {
  test(`Android release eligibility: ${event} on ${ref}`, () => {
    assert.equal(releaseAllowed(event, ref), expected)
  })
}

test('CI keeps code checks but does not build or start backend containers', () => {
  assert.doesNotMatch(ci, /^ {2}docker-build:/m)
  assert.ok(jobBlock(ci, 'backend-test').includes('pytest tests/'))
  assert.ok(jobBlock(ci, 'frontend-lint').includes('npm run test:tools'))
  assert.doesNotMatch(ci, /docker\/build-push-action|docker\/setup-buildx-action|docker compose|npm run server:init/)
})

test('local Docker API/database/tunnel remain, without remote backend hosting configs', () => {
  assert.ok(existsSync(path.join(repo, 'backend/Dockerfile')))
  const compose = readFileSync(path.join(repo, 'deploy/laptop/docker-compose.yml'), 'utf8')
  for (const service of ['mongo', 'api', 'tunnel']) assert.match(compose, new RegExp(`^  ${service}:`, 'm'))
  for (const file of ['heroku.yml', 'deploy/vm/setup.sh', 'deploy/vm/docker-compose.yml', 'deploy/vm/Caddyfile']) {
    assert.equal(existsSync(path.join(repo, file)), false, `Remote hosting config must be removed: ${file}`)
  }
})

test('Android workflow calls the tested signing check and watches its changes', () => {
  assert.ok(jobBlock(android, 'signed-apk-release').includes('run: bash .github/scripts/check-android-signing.sh'))
  assert.equal(android.split('- ".github/scripts/**"').length - 1, 2)
  assert.equal(android.split('- ".github/workflows/ci.yml"').length - 1, 2)
})

test('Android signing requires debug validation and same-commit trusted CI', () => {
  const release = jobBlock(android, 'signed-apk-release')
  assert.match(release, /needs: \[debug-apk, release-ci-gate\]/)
  const gate = jobBlock(android, 'release-ci-gate')
  assert.match(gate, /actions: read/)
  assert.match(gate, /run: node \.github\/scripts\/check-android-ci\.mjs/)
  assert.doesNotMatch(gate, /contents: write|secrets\./)
})

test('Android signing restores keys after installing dependencies and always removes them', () => {
  const release = jobBlock(android, 'signed-apk-release')
  assert.ok(release.indexOf('npm ci') < release.indexOf('run: node frontend/scripts/restore-signing.mjs'))
  assert.match(release, /Remove signing files after every build outcome\n\s+if: always\(\)/)
  assert.match(release, /upload-keystore\.jks.*keystore\.properties.*force: true/)
  assert.match(release, /cache-read-only: true/)
  assert.doesNotMatch(release, /cache: gradle/)
})

function checkSigning(event, ref, configuredNames) {
  const directory = mkdtempSync(path.join(tmpdir(), 'neighbouraid-signing-test-'))
  const output = path.join(directory, 'output')
  const env = {
    ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref,
    GITHUB_OUTPUT: output.replaceAll('\\', '/'),
  }
  for (const name of signingNames) env[name] = configuredNames.includes(name) ? `fixture-${name}` : ''
  try {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
    const result = spawnSync(bash, ['.github/scripts/check-android-signing.sh'], {
      cwd: repo, env, encoding: 'utf8', windowsHide: true,
    })
    assert.ifError(result.error)
    const log = `${result.stdout}${result.stderr}`
    for (const name of signingNames) assert.ok(!log.includes(`fixture-${name}`), 'Secret value leaked')
    return { status: result.status, log, output: readFileSync(output, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('configured manual releases proceed without logging secret values', () => {
  const result = checkSigning('workflow_dispatch', 'refs/heads/main', signingNames)
  assert.equal(result.status, 0)
  assert.equal(result.output, 'configured=true\n')
})

for (const [event, ref, status, level] of [
  ['push', 'refs/heads/main', 0, 'warning'],
  ['push', 'refs/tags/v1.0.0', 1, 'error'],
  ['workflow_dispatch', 'refs/heads/main', 1, 'error'],
]) {
  test(`missing signing secrets give an explicit ${level} on ${event} ${ref}`, () => {
    const result = checkSigning(event, ref, [signingNames[0]])
    assert.equal(result.status, status)
    assert.equal(result.output, 'configured=false\n')
    assert.ok(result.log.includes(`::${level}::`))
    assert.ok(!result.log.includes(signingNames[0]))
    for (const name of signingNames.slice(1)) assert.ok(result.log.includes(name))
  })
}
