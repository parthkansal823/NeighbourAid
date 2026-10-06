import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_DIR } from './server-tools.mjs'

export function privateTrackedPaths(paths) {
  return paths.filter((path) => {
    const name = path.replaceAll('\\', '/')
    if (name === 'frontend/.env.mobile' || name.endsWith('.example')) return false
    return /(^|\/)\.env(?:\.|$)/.test(name) || /\.(env|jks|keystore)$/.test(name) ||
      /(^|\/)keystore\.properties$/.test(name) ||
      /^deploy\/laptop\/(runtime-secrets(?:\.private)?\.json(?:\.pending)?|rotation\.private\.json)$/.test(name) ||
      name.startsWith('backups/')
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_DIR, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean)
  // Deleted working-tree files can be staged by the user later; a checkout in
  // CI has no such difference, so this also guards a accidentally committed key.
  const leaked = privateTrackedPaths(paths).filter((path) => existsSync(resolve(REPO_DIR, path)))
  if (leaked.length) {
    console.error(`Private files must not be committed: ${leaked.join(', ')}. Remove them from tracking and rotate any exposed credentials.`)
    process.exitCode = 1
  } else console.log('No tracked private configuration, backups or Android signing files found.')
}
