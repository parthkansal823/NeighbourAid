import { randomBytes, randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { checkApi, EDGE_FILE, extractTunnelOrigin, REPO_DIR, runCompose, runDocker, runWrangler, setApiOrigin } from './server-tools.mjs'
import { ensureRuntimeConfig, MONGO_VOLUME, SERVER_DIR } from './server-config.mjs'
import { rotateRuntimeConfig } from './server-rotate.mjs'

const action = process.argv[2]
const aiMode = process.argv.includes('--ai')

// Read by runCompose at invocation time. Keep this process-local so a normal
// `server:*` command can never accidentally select the heavier image/mount.
if (aiMode) process.env.NEIGHBOURAID_AI_PROFILE = '1'
const command = (name) => `npm run server:${aiMode ? 'ai:' : ''}${name}`

export async function edgeSecret({ create = false, file = EDGE_FILE } = {}) {
  try {
    const contents = await readFile(file, 'utf8')
    const secret = contents.match(/^EDGE_SECRET=([a-f0-9]{64})\r?$/m)?.[1]
    if (!secret) throw new Error('The generated edge.env is invalid. Restore its backup before connecting.')
    return secret
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!create) throw new Error(`Run ${command('setup')} once before connecting.`)
    const secret = randomBytes(32).toString('hex')
    await writeFile(file, `EDGE_SECRET=${secret}\n`, { flag: 'wx', mode: 0o600 })
    return secret
  }
}

function requireDocker() {
  try {
    runDocker(['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' })
  } catch {
    throw new Error('Docker is not running. Open Docker Desktop, wait for its engine, then try again.')
  }
}

const pendingRotation = () => access(resolve(SERVER_DIR, 'rotation.private.json')).then(() => true, () => false)

async function prepare({ allowRotation = false } = {}) {
  requireDocker()
  if (!allowRotation && await pendingRotation()) {
    throw new Error(`A credential rotation is unfinished. Keep the private journal and run ${command('rotate')} before connecting.`)
  }
  let existingData = false
  try {
    runDocker(['volume', 'inspect', MONGO_VOLUME], { stdio: 'ignore' })
    existingData = true
  } catch (error) {
    if (error.status !== 1) throw error
  }
  await ensureRuntimeConfig({ existingData })
  await edgeSecret({ create: true })
}

async function setup() {
  await prepare()
  const secret = await edgeSecret({ create: true })
  // Confirm the account in the console before changing this existing
  // Worker. The credential goes through stdin; it never appears in argv.
  runWrangler(['whoami'])
  runWrangler(['secret', 'put', 'EDGE_SECRET'], {
    input: `${secret}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  console.log(`Docker database/JWT credentials and edge authentication configured. All local secrets are gitignored.\nRun ${command('connect')}. Keep the generated secrets and MongoDB volumes for subsequent starts.`)
}

async function connect() {
  const secret = await edgeSecret()
  requireDocker()
  // Reuse credentials; never silently assign new passwords to an existing DB.
  await prepare()
  runCompose(['config', '--quiet'])
  runCompose(['up', '--detach', '--build', '--wait', '--wait-timeout', '180'])
  // Read only tunnel logs: backend logs may include database diagnostics.
  let origin
  for (let attempt = 0; attempt < 30; attempt++) {
    const logs = runCompose(['logs', '--no-color', '--tail', '200', 'tunnel'], { stdio: 'pipe', encoding: 'utf8' })
    origin = extractTunnelOrigin(logs)
    if (origin) {
      try {
        await checkApi(origin, { secret, ready: true })
        break
      } catch {
        origin = null
      }
    }
    await delay(2000)
  }
  if (!origin) throw new Error('Tunnel/API did not become ready. Check Docker status and MongoDB network access, then retry. No routing change was made.')
  try {
    await setApiOrigin(origin)
  } catch {
    throw new Error(`Docker MongoDB/API/tunnel are running, but Cloudflare routing was NOT updated. If Wrangler reports authentication error 10000, run npx wrangler login in frontend/, approve your own account in the browser, then retry ${command('connect')}. Check CONFIG/account permissions if login does not help. Do not delete database volumes or run ${command('setup')} again.`)
  }
  console.log(`Docker MongoDB, API and tunnel are running. The real web app and Android APK use the same Worker URL.\nKV routing can take about a minute to propagate. Stop the stack with ${command('stop')}; database volumes are preserved.`)
}

async function backup() {
  requireDocker()
  const directory = resolve(REPO_DIR, 'backups')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = resolve(directory, `neighbouraid-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.archive.gz`)
  const file = await open(path, 'wx', 0o600)
  try {
    runCompose(['exec', '-T', 'mongo', 'bash', '/opt/neighbouraid/backup.sh'], { stdio: ['ignore', file.fd, 'pipe'] })
  } catch {
    throw new Error(`Database backup failed; ${path} may be incomplete. Keep the original database, check server:status, then retry.`)
  } finally {
    await file.close()
  }
  console.log(`Database backup saved privately to ${path}. Copy it and the generated secrets to a safe location.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
try {
  if (action === 'init') {
    await prepare()
    console.log('Local Docker configuration prepared; no Cloudflare configuration was changed.')
  }
  else if (action === 'setup') await setup()
  else if (action === 'connect') await connect()
  else if (action === 'backup') await backup()
  else if (action === 'rotate') {
    await prepare({ allowRotation: true })
    // A partial rotation may already have changed the database password.
    // Do not block journal recovery by trying a second backup with old auth.
    if (!await pendingRotation()) await backup()
    await rotateRuntimeConfig()
    console.log('JWT and both MongoDB passwords rotated. Existing sessions must sign in again. Database data is preserved; reconnect the tunnel with server:connect when ready.')
  }
  else if (action === 'stop') {
    runCompose(['down'])
    console.log('MongoDB, API and tunnel stopped. Database volumes are preserved; the Cloudflare website is still available.')
  } else if (action === 'status') runCompose(['ps'])
  else throw new Error(`Use ${command('init')}, ${command('setup')}, ${command('connect')}, ${command('stop')}, ${command('status')}, ${command('backup')} or ${command('rotate')}.`)
} catch (error) {
  // execFile errors can embed captured stderr. Keep diagnostics to the
  // operation, not data from configuration files or command input.
  console.error(error.cmd ? 'The operation failed. Check the preceding Docker/Wrangler output and retry.' : error.message)
  process.exitCode = 1
}
}
