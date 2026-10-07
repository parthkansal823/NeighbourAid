import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r', '')
const gate = workflow.slice(workflow.indexOf('\n  ci-success:'))
const script = gate.match(/node - <<'NODE'\n([\s\S]*?)\n\s+NODE/)[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n')

for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
  test(`final CI gate ${result === 'success' ? 'accepts' : 'rejects'} a ${result} prerequisite`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'neighbouraid-ci-gate-'))
    try {
      const child = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, JOB_RESULTS: JSON.stringify({ 'backend-test': { result } }),
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md') },
      })
      assert.ifError(child.error)
      assert.equal(child.status, result === 'success' ? 0 : 1)
      assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), new RegExp(result))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('stable gate covers all main CI jobs even when a prerequisite fails', () => {
  assert.match(gate, /if: always\(\)/)
  assert.match(gate, /needs: \[workflow-lint, backend-test, frontend-lint, security-audit\]/)
  assert.match(workflow, /merge_group:/)
  assert.match(workflow, /workflow_dispatch:/)
})

test('edge artifact is built and package-checked before it is uploaded', () => {
  assert.ok(workflow.indexOf('wrangler deploy --dry-run') < workflow.indexOf('name: frontend-edge-dist'))
  assert.ok(workflow.indexOf('dist/ci-build.json') < workflow.indexOf('name: frontend-edge-dist'))
  assert.ok(workflow.indexOf('name: frontend-edge-dist') < workflow.indexOf('run: npm run demo:build'))
  assert.match(workflow, /target:"edge"/)
})

test('security checks cannot suppress a vulnerability or service failure', () => {
  const audit = workflow.slice(workflow.indexOf('\n  security-audit:'), workflow.indexOf('\n  ci-success:'))
  assert.doesNotMatch(audit, /continue-on-error|\|\| true/)
  assert.match(audit, /python -m pip_audit/)
  assert.match(audit, /node \.github\/scripts\/audit-frontend\.mjs/)
})

test('all CI actions are immutable and checkout does not retain credentials', () => {
  for (const [, ref] of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(ref, /@[a-f0-9]{40}$/)
  assert.equal(workflow.match(/persist-credentials: false/g).length, workflow.match(/uses: actions\/checkout@/g).length)
})
