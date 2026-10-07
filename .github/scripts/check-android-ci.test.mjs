import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectCiRun, waitForCi } from './check-android-ci.mjs'

const repository = 'example/neighbouraid'
const sha = 'a'.repeat(40)
const run = {
  id: 123, run_number: 7, run_attempt: 1, head_sha: sha, head_branch: 'main',
  head_repository: { full_name: repository }, event: 'push',
  status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/neighbouraid/actions/runs/123',
}

test('Android signing accepts only exact-SHA trusted main CI, not PRs or feature/fork results', () => {
  for (const rejected of [
    { ...run, head_sha: 'b'.repeat(40) },
    { ...run, head_branch: 'feature' },
    { ...run, head_repository: { full_name: 'fork/neighbouraid' } },
    { ...run, event: 'pull_request' },
    { ...run, event: 'merge_group' },
  ]) assert.equal(selectCiRun([rejected], repository, sha), undefined)
  assert.equal(selectCiRun([run], repository, sha), run)
  assert.ok(selectCiRun([{ ...run, event: 'workflow_dispatch' }], repository, sha))
})

test('a later failed run or rerun supersedes an old CI success', async () => {
  for (const latest of [
    { ...run, id: 124, run_number: 8, conclusion: 'failure' },
    { ...run, run_attempt: 2, conclusion: 'failure' },
  ]) {
    await assert.rejects(waitForCi({ repository, sha, log() {}, request: async () => ({ workflow_runs: [run, latest] }) }), /did not pass: failure/)
  }
})

test('completed workflow without successful stable gate cannot authorize signing', async () => {
  for (const jobs of [[], [{ name: 'ci-success', status: 'completed', conclusion: 'skipped' }], [{ name: 'ci-success', status: 'in_progress', conclusion: null }]]) {
    await assert.rejects(waitForCi({ repository, sha, log() {}, request: async endpoint =>
      endpoint.includes('/jobs?') ? { jobs } : { workflow_runs: [run] },
    }), /no successful ci-success/)
  }
})

test('gate waits for same-commit CI, then checks the matching run attempt', async () => {
  let time = 0
  const calls = []
  const request = async endpoint => {
    calls.push(endpoint)
    if (endpoint.includes('/jobs?')) return { jobs: [{ name: 'ci-success', status: 'completed', conclusion: 'success' }] }
    return { workflow_runs: time >= 20 ? [run] : [] }
  }
  const result = await waitForCi({ repository, sha, request, log() {}, now: () => time, delay: async ms => { time += ms }, intervalMs: 10, timeoutMs: 50 })
  assert.equal(result, run)
  assert.equal(calls.length, 4)
  assert.ok(calls.at(-1).includes('/123/attempts/1/jobs?'))
  assert.ok(calls[0].includes(`head_sha=${sha}`))
})

test('CI gate times out when no matching main run exists', async () => {
  let time = 0
  await assert.rejects(waitForCi({ repository, sha, log() {}, now: () => time,
    delay: async ms => { time += ms }, intervalMs: 10, timeoutMs: 25,
    request: async () => ({ workflow_runs: [] }),
  }), /Timed out waiting/)
  assert.equal(time, 25)
})
