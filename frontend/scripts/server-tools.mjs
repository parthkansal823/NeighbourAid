import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_DIR = resolve(FRONTEND_DIR, '..')
export const COMPOSE_FILE = resolve(REPO_DIR, 'deploy/laptop/docker-compose.yml')
export const EDGE_FILE = resolve(REPO_DIR, 'deploy/laptop/edge.env')

export function runWrangler(args, options = {}) {
  const cli = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
  return execFileSync(process.execPath, [cli, ...args, '--config', resolve(FRONTEND_DIR, 'wrangler.jsonc')], {
    cwd: FRONTEND_DIR,
    windowsHide: true,
    stdio: 'inherit',
    ...options,
  })
}

export function runDocker(args, options = {}) {
  const candidates = ['docker']
  if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles]) {
      if (!base) continue
      for (const dir of ['DockerDesktop', 'Docker']) {
        const path = resolve(base, dir, 'resources/bin/docker.exe')
        if (existsSync(path)) candidates.push(path)
      }
    }
  }
  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, args, { windowsHide: true, stdio: 'inherit', ...options })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw new Error('Docker Desktop is not installed or its CLI could not be found.')
}

export function runCompose(args, options = {}) {
  return runDocker(['compose', '--file', COMPOSE_FILE, ...args], {
    cwd: REPO_DIR,
    windowsHide: true,
    stdio: 'inherit',
    ...options,
  })
}

export function parseApiOrigin(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Pass the complete HTTPS URL printed by your running tunnel.')
  }
  if (url.protocol !== 'https:') throw new Error('The public API origin must use HTTPS.')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Pass only the HTTPS origin, with no credentials, path, query or fragment.')
  }
  const host = url.hostname.toLowerCase()
  if (host === 'example.trycloudflare.com' || host === 'localhost' ||
      host === '[::1]' || host.startsWith('127.') ||
      /(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/.test(host)) {
    throw new Error('That is a sample or local address. Use the actual public URL from your tunnel.')
  }
  return url.origin
}

export function extractTunnelOrigin(logs) {
  const matches = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/g)
  return matches?.length ? parseApiOrigin(matches.at(-1)) : null
}

export async function checkApi(origin, { secret, ready = false, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${origin}/health${ready ? '/ready' : ''}`, {
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
    headers: secret ? { 'X-Edge-Secret': secret } : {},
  })
  if (!response.ok) throw new Error(`API health check returned HTTP ${response.status}.`)
  const body = await response.json()
  if (body.status !== 'ok' || (ready && body.database !== 'ok')) {
    throw new Error('The API is reachable but is not ready to serve requests.')
  }
}

export async function setApiOrigin(raw) {
  const origin = parseApiOrigin(raw)
  // Check an open liveness endpoint before changing production routing.
  // Do not send the edge credential to a manually supplied destination.
  await checkApi(origin)
  runWrangler(['kv', 'key', 'put', 'API_ORIGIN', origin, '--binding=CONFIG', '--remote'])
  return origin
}
