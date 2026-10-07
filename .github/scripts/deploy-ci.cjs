'use strict';

/** Resolve production to a completed, green CI run for the current main SHA. */
async function resolveCiDeployment({ github, context }) {
  const repo = context.repo;
  const fullName = `${repo.owner}/${repo.repo}`;
  if (context.eventName === 'workflow_dispatch' && context.ref !== 'refs/heads/main') {
    throw new Error('Manual production deployment is only allowed from main.');
  }
  if (!['workflow_run', 'workflow_dispatch'].includes(context.eventName)) {
    throw new Error('Unsupported production deployment trigger.');
  }

  const { data: main } = await github.rest.git.getRef({ ...repo, ref: 'heads/main' });
  const sha = main.object.sha;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('main did not resolve to a commit SHA.');
  if (context.eventName === 'workflow_dispatch' && context.sha !== sha) {
    throw new Error('This manual deployment is stale: main has moved since it was queued.');
  }

  const { data: workflow } = await github.rest.actions.getWorkflow({ ...repo, workflow_id: 'ci.yml' });
  const { data: runs } = await github.rest.actions.listWorkflowRuns({
    ...repo, workflow_id: workflow.id, branch: 'main', head_sha: sha, per_page: 100,
  });
  // Reject an older green run when a newer run is still pending or has failed.
  const latest = runs.workflow_runs
    .filter((run) => ['push', 'workflow_dispatch'].includes(run.event))
    .sort((a, b) => b.id - a.id)[0];
  if (!latest) throw new Error('No main CI run exists for this revision. Run NeighbourAid CI first.');

  const requestedRunId = context.eventName === 'workflow_run'
    ? context.payload.workflow_run.id
    : latest.id;
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: requestedRunId });
  if (run.workflow_id !== workflow.id || run.head_repository?.full_name !== fullName ||
      run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event)) {
    throw new Error('The candidate was not a trusted NeighbourAid CI run on main.');
  }
  if (run.head_sha !== sha || run.id !== latest.id) {
    throw new Error('The candidate CI run is stale. Only the latest current-main CI run may deploy.');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('The latest main CI run has not completed successfully.');
  }
  if (context.eventName === 'workflow_run' &&
      context.payload.workflow_run.run_attempt !== run.run_attempt) {
    throw new Error('The CI run was rerun after this deployment event.');
  }

  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo, run_id: run.id, filter: 'latest', per_page: 100,
  });
  const gate = jobs.find((job) => job.name === 'ci-success');
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') {
    throw new Error('The required ci-success gate is missing or unsuccessful.');
  }
  return { sha, runId: run.id };
}

function validateBuildMetadata(metadata, deployment) {
  if (!metadata || metadata.target !== 'edge' || metadata.sha !== deployment.sha ||
      String(metadata.run_id) !== String(deployment.runId)) {
    throw new Error('The frontend artifact provenance does not match the successful CI edge build.');
  }
}

module.exports = { resolveCiDeployment, validateBuildMetadata };
