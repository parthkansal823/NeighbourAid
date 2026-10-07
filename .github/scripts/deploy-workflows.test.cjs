'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = (name) => fs.readFileSync(path.join(__dirname, '../workflows', name), 'utf8')
  .replaceAll('\r', '');

function job(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Missing job ${name}`);
  return match[1];
}

test('Worker deploy downloads its successful CI artifact without rebuilding it', () => {
  const source = workflow('deploy.yml');
  assert.match(source, /name: frontend-edge-dist/);
  assert.match(source, /run-id: \$\{\{ steps\.ci\.outputs\.run_id \}\}/);
  assert.match(source, /ref: \$\{\{ steps\.ci\.outputs\.sha \}\}/);
  assert.match(source, /run: npx --no-install wrangler deploy\n/);
  assert.doesNotMatch(source, /run:.*npm run (?:build|deploy)/);
  assert.ok(source.indexOf('Validate artifact provenance') < source.indexOf('- name: Deploy tested'));
});

test('Cloudflare credentials are only exposed to the deployment step', () => {
  const source = workflow('deploy.yml');
  const global = source.slice(0, source.indexOf('\njobs:'));
  assert.doesNotMatch(global, /secrets\./);
  assert.equal(source.split('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}').length - 1, 1);
  const deployment = source.slice(source.indexOf('- name: Deploy tested'), source.indexOf('- name: Check deployed'));
  assert.match(deployment, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(source, /TOKEN_CONFIGURED: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN != '' \}\}/);
  assert.match(source, /Deployment skipped/);
  assert.match(source, /GITHUB_STEP_SUMMARY/);
});

test('Pages build and deployment split read and write permissions', () => {
  const source = workflow('deploy-ppt.yml');
  const build = job(source, 'build');
  const deploy = job(source, 'deploy');
  assert.match(build, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(build, /pages: read/);
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /needs: build/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(build, /node --check PPT\/deck-stage\.js/);
});

test('deployment actions have immutable commit pins and bounded jobs', () => {
  for (const name of ['deploy.yml', 'deploy-ppt.yml']) {
    const source = workflow(name);
    for (const [, action] of source.matchAll(/uses: (\S+)/g)) {
      assert.match(action, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
    }
    const jobs = [...source.matchAll(/^  ([a-zA-Z][\w-]*):$/gm)]
      .map((match) => match[1]).filter((name) => !['workflow_run', 'workflow_dispatch', 'push'].includes(name));
    for (const name of jobs) assert.match(job(source, name), /timeout-minutes: \d+/);
    assert.match(source, /persist-credentials: false/);
    assert.match(source, /cancel-in-progress: false/);
  }
});
