import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url))

export function auditResult(stdout, status) {
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    throw new Error('npm audit returned no valid JSON report; vulnerability status is unknown.')
  }
  const counts = report.metadata?.vulnerabilities
  if (report.error || !counts || ![0, 1].includes(status) ||
      !['high', 'critical', 'total'].every(key => Number.isInteger(counts[key]) && counts[key] >= 0) ||
      (status === 1 && counts.total === 0)) {
    throw new Error('npm audit failed to complete; check registry connectivity and the audit report.')
  }
  return { report, counts, blocked: counts.high > 0 || counts.critical > 0 }
}

export function runAudit(args, outputPath) {
  // Arguments are fixed by this script, never interpolated from PR content.
  const auditArgs = ['audit', '--package-lock-only', '--json', ...args]
  const windows = process.platform === 'win32'
  const result = spawnSync(windows ? (process.env.ComSpec || 'cmd.exe') : 'npm',
    windows ? ['/d', '/s', '/c', `npm ${auditArgs.join(' ')}`] : auditArgs, {
    cwd: frontend,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  writeFileSync(outputPath, result.stdout || '{}')
  if (result.error) throw new Error(`npm audit could not run: ${result.error.message}`)
  return auditResult(result.stdout, result.status)
}

export function auditFrontend(reportDirectory) {
  const directory = resolve(reportDirectory)
  mkdirSync(directory, { recursive: true })
  const runtime = runAudit(['--omit=dev', '--audit-level=high'], resolve(directory, 'runtime.json'))
  const all = runAudit([], resolve(directory, 'all-dependencies.json'))
  const summary = [
    '| Dependency audit | High | Critical | Total | Policy |',
    '|---|---|---|---|---|',
    `| Browser runtime | ${runtime.counts.high} | ${runtime.counts.critical} | ${runtime.counts.total} | High/critical block CI |`,
    `| Runtime + build tooling | ${all.counts.high} | ${all.counts.critical} | ${all.counts.total} | Full report retained |`,
    '',
  ].join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (runtime.blocked) throw new Error('High/critical browser runtime vulnerabilities must be fixed before release.')
  if (all.counts.total) {
    console.warn('::warning::Build tooling dependency findings are present. Review the security-audit-npm artifact and Dependabot updates.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    auditFrontend(process.argv[2] || resolve(frontend, 'audit-reports'))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
