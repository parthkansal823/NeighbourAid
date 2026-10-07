import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// A successful PR merge test or feature-branch build must never authorize
// signing. Only the latest trusted main CI run for this exact commit counts.
export function selectCiRun(runs, repository, sha) {
  return runs.filter(run =>
    run.head_sha === sha && run.head_branch === 'main' &&
    run.head_repository?.full_name === repository &&
    ['push', 'workflow_dispatch'].includes(run.event),
  ).sort((left, right) =>
    right.run_number - left.run_number || right.run_attempt - left.run_attempt || right.id - left.id,
  )[0]
}

export async function waitForCi({
  repository, sha, request, now = Date.now,
  delay = milliseconds => new Promise(done => setTimeout(done, milliseconds)),
  log = console.log, timeoutMs = 15 * 60 * 1000, intervalMs = 15 * 1000,
}) {
  const started = now()
  let previous = ''
  while (true) {
    const response = await request(`actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&per_page=100`)
    const run = selectCiRun(response.workflow_runs || [], repository, sha)
    const state = run ? `CI run ${run.run_number}, attempt ${run.run_attempt}: ${run.status}` : 'Waiting for main CI to start for this commit'
    if (state !== previous) log(state)
    previous = state
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Main CI did not pass: ${run.conclusion}. See ${run.html_url}`)
      const { jobs = [] } = await request(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
      const gate = jobs.find(job => job.name === 'ci-success')
      if (gate?.status !== 'completed' || gate.conclusion !== 'success') {
        throw new Error(`Main CI has no successful ci-success check. See ${run.html_url}`)
      }
      log(`Release authorized by main CI for ${sha}: ${run.html_url}`)
      return run
    }
    if (now() - started >= timeoutMs) {
      throw new Error('Timed out waiting for successful main CI for this exact commit. Run NeighbourAid CI on main, then rerun this Android workflow.')
    }
    await delay(Math.min(intervalMs, timeoutMs - (now() - started)))
  }
}

async function main(env) {
  const repository = env.GITHUB_REPOSITORY || ''
  const sha = env.GITHUB_SHA || ''
  const token = env.GH_TOKEN || env.GITHUB_TOKEN
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(sha) || !token) {
    throw new Error('GITHUB_REPOSITORY, GITHUB_SHA and a read-only GitHub Actions token are required')
  }
  const api = new URL(env.GITHUB_API_URL || 'https://api.github.com')
  if (api.protocol !== 'https:' || api.username || api.password) throw new Error('GitHub API must use HTTPS without embedded credentials')
  if (!api.pathname.endsWith('/')) api.pathname += '/'
  const request = async endpoint => {
    const response = await fetch(new URL(`repos/${repository}/${endpoint}`, api), {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Cannot inspect main CI: GitHub API returned ${response.status}`)
    return response.json()
  }
  const run = await waitForCi({ repository, sha, request })
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, `### Android release CI gate\n\nCommit \`${sha}\` passed [main CI, run ${run.run_number}, attempt ${run.run_attempt}](${run.html_url}) with a successful \`ci-success\` check.\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.env).catch(error => {
    console.error(`::error::${error.message.replaceAll('\n', ' ')}`)
    process.exitCode = 1
  })
}
