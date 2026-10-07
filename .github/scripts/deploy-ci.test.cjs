'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCiDeployment, validateBuildMetadata } = require('./deploy-ci.cjs');

const SHA = 'a'.repeat(40);

function fixture(overrides = {}) {
  const run = {
    id: 42, workflow_id: 5, head_sha: SHA, head_branch: 'main',
    head_repository: { full_name: 'community/neighbouraid' }, event: 'push',
    status: 'completed', conclusion: 'success', run_attempt: 1, ...overrides.run,
  };
  const context = {
    repo: { owner: 'community', repo: 'neighbouraid' }, eventName: 'workflow_run',
    ref: 'refs/heads/main', sha: SHA, payload: { workflow_run: { id: 42, run_attempt: 1 } },
    ...overrides.context,
  };
  const github = {
    rest: {
      git: { getRef: async () => ({ data: { object: { sha: overrides.mainSha || SHA } } }) },
      actions: {
        getWorkflow: async () => ({ data: { id: 5 } }),
        listWorkflowRuns: async () => ({ data: { workflow_runs: overrides.runs || [run] } }),
        getWorkflowRun: async () => ({ data: run }),
        listJobsForWorkflowRun: () => {},
      },
    },
    paginate: async () => overrides.jobs || [
      { name: 'ci-success', status: 'completed', conclusion: 'success' },
    ],
  };
  return { github, context };
}

test('deploys the exact current main run only after its success gate', async () => {
  assert.deepEqual(await resolveCiDeployment(fixture()), { sha: SHA, runId: 42 });
});

test('manual deployment also requires a green CI run of the same current main SHA', async () => {
  assert.deepEqual(await resolveCiDeployment(fixture({ context: { eventName: 'workflow_dispatch' } })),
    { sha: SHA, runId: 42 });
});

test('rejects manual runs from another branch', async () => {
  await assert.rejects(resolveCiDeployment(fixture({
    context: { eventName: 'workflow_dispatch', ref: 'refs/heads/feature' },
  })), /only allowed from main/);
});

test('rejects a manual run when main changed while it was queued', async () => {
  await assert.rejects(resolveCiDeployment(fixture({
    context: { eventName: 'workflow_dispatch' }, mainSha: 'b'.repeat(40),
  })), /stale/);
});

test('rejects manual untested SHAs', async () => {
  await assert.rejects(resolveCiDeployment(fixture({
    context: { eventName: 'workflow_dispatch' }, runs: [],
  })), /No main CI run/);
});

test('rejects successful CI from an old main SHA', async () => {
  await assert.rejects(resolveCiDeployment(fixture({ mainSha: 'b'.repeat(40) })), /stale/);
});

test('rejects an older green run if a newer main run is queued', async () => {
  await assert.rejects(resolveCiDeployment(fixture({ runs: [
    { id: 43, event: 'push', status: 'queued' }, { id: 42, event: 'push' },
  ] })), /stale/);
});

test('rejects failed and incomplete CI', async () => {
  for (const run of [{ conclusion: 'failure' }, { status: 'in_progress', conclusion: null }]) {
    await assert.rejects(resolveCiDeployment(fixture({ run })), /not completed successfully/);
  }
});

test('rejects a fork, non-main run, wrong workflow or unsupported event', async () => {
  for (const run of [
    { head_repository: { full_name: 'someone/neighbouraid' } },
    { head_branch: 'feature' }, { workflow_id: 6 }, { event: 'pull_request' },
  ]) {
    await assert.rejects(resolveCiDeployment(fixture({ run, runs: [{ id: 42, event: 'push' }] })),
      /not a trusted/);
  }
});

test('requires the explicit success gate', async () => {
  for (const jobs of [[], [{ name: 'ci-success', status: 'completed', conclusion: 'failure' }]]) {
    await assert.rejects(resolveCiDeployment(fixture({ jobs })), /ci-success/);
  }
});

test('rejects a stale CI completion event after a rerun', async () => {
  await assert.rejects(resolveCiDeployment(fixture({ run: { run_attempt: 2 } })), /rerun/);
});

test('artifact metadata must bind target, SHA and run id', () => {
  const deployment = { sha: SHA, runId: 42 };
  const metadata = { target: 'edge', sha: SHA, run_id: '42' };
  assert.doesNotThrow(() => validateBuildMetadata(metadata, deployment));
  for (const invalid of [null, { ...metadata, target: 'demo' },
    { ...metadata, sha: 'b'.repeat(40) }, { ...metadata, run_id: 41 }]) {
    assert.throws(() => validateBuildMetadata(invalid, deployment), /provenance/);
  }
});
