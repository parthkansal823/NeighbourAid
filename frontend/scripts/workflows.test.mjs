import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    expression = lines.slice(index + 1).findIndex(line => !line.startsWith('      '))
    expression = lines.slice(index + 1, index + 1 + expression).join(' ').trim()
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

test('CI builds only the deployed backend container and keeps MongoDB integration checks', () => {
  const docker = jobBlock(ci, 'docker-build')
  assert.deepEqual([...docker.matchAll(/context: (.+)/g)].map(match => match[1]), ['./backend'])
  assert.ok(docker.includes('push: false'))
  assert.ok(docker.includes('load: true'))
  assert.match(docker, /up --detach --no-build --wait --wait-timeout 180 api\n/)
  assert.ok(docker.includes('npm run server:test -- --restart'))
  assert.ok(docker.includes('if: always()'))
})

test('Android workflow calls the tested signing check and watches its changes', () => {
  assert.ok(android.includes('run: bash .github/scripts/check-android-signing.sh'))
  assert.equal(android.split('- ".github/scripts/check-android-signing.sh"').length - 1, 2)
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
