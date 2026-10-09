import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureRuntimeConfig, newRuntimeConfig, SERVER_DIR, validateRuntimeConfig } from './server-config.mjs'
import { REPO_DIR, runCompose } from './server-tools.mjs'

// All passwords travel over stdin to a process inside Mongo's own container.
// Only the loopback database connection sees the administrator credential.
const rotateInMongo = `
try {
  const payload = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  let admin;
  for (const password of [payload.previous.rootPassword, payload.next.rootPassword]) {
    try {
      const uri = 'mongodb://neighbouraid_admin:' + encodeURIComponent(password) + '@127.0.0.1:27017/admin';
      const candidate = new Mongo(uri).getDB('admin');
      if (candidate.runCommand({connectionStatus:1}).authInfo.authenticatedUsers.length === 1) { admin=candidate; break; }
    } catch {}
  }
  if (!admin) throw new Error('No valid administrator credential');
  admin.getSiblingDB('neighbouraid').updateUser('neighbouraid_app', {pwd:payload.next.appPassword});
  admin.updateUser('neighbouraid_admin', {pwd:payload.next.rootPassword});
  const uri = 'mongodb://neighbouraid_app:' + encodeURIComponent(payload.next.appPassword) + '@127.0.0.1:27017/neighbouraid';
  const verified = new Mongo(uri).getDB('neighbouraid');
  verified.getCollection('_deployment_smoke').findOne({});
  for (const [user, password, database, command] of [
    ['neighbouraid_admin',payload.previous.rootPassword,'admin',{serverStatus:1}],
    ['neighbouraid_app',payload.previous.appPassword,'neighbouraid',{listCollections:1}]
  ]) {
    let rejected=false;
    try { new Mongo('mongodb://' + user + ':' + encodeURIComponent(password) + '@127.0.0.1:27017/' + database).getDB(database).runCommand(command); }
    catch { rejected=true; }
    if (!rejected) throw new Error('Old password still accepted');
  }
  print('Database passwords rotated; old credentials rejected.');
} catch { print('Database credential rotation failed; retain the private recovery journal.'); quit(1); }
`

export async function rotateRuntimeConfig({ directory = SERVER_DIR, backups = resolve(REPO_DIR, 'backups'), compose = runCompose } = {}) {
  const source = resolve(directory, 'runtime-secrets.private.json')
  const journal = resolve(directory, 'rotation.private.json')
  let payload
  try {
    payload = JSON.parse(await readFile(journal, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('The private rotation journal is invalid. Keep it for recovery.')
    // Only build the ordinary generated files before the first attempt. Once
    // a journal exists, it is the recovery authority: the database might have
    // accepted the new passwords while the process was interrupted before it
    // could replace this local file. Re-running must therefore work even if
    // that old file is absent or incomplete.
    await ensureRuntimeConfig({ directory, existingData: true })
    const previous = validateRuntimeConfig(JSON.parse(await readFile(source, 'utf8')))
    payload = { previous, next: newRuntimeConfig() }
    await mkdir(backups, { recursive: true, mode: 0o700 })
    await writeFile(resolve(backups, `retired-runtime-secrets-${randomUUID()}.json`), `${JSON.stringify(previous)}\n`, { flag: 'wx', mode: 0o600 })
    // Persist BOTH identities before any database mutation. A partial run can
    // resume against either the old or the new database administrator password.
    await writeFile(journal, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600 })
  }
  validateRuntimeConfig(payload.previous)
  validateRuntimeConfig(payload.next)
  for (const key of ['jwtSecret', 'rootPassword', 'appPassword']) {
    if (payload.previous[key] === payload.next[key]) throw new Error('The rotation journal does not contain fresh credentials.')
  }
  try {
    compose(['stop', 'tunnel', 'api'])
    compose(['exec', '-T', 'mongo', 'mongosh', '--quiet', '--norc', '--eval', rotateInMongo], {
      input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'],
    })
    const pending = resolve(directory, 'runtime-secrets.private.json.pending')
    await writeFile(pending, `${JSON.stringify(payload.next)}\n`, { mode: 0o600 })
    try {
      // POSIX replaces an existing destination atomically. Windows does not:
      // Node's rename() returns EPERM when `source` already exists, which
      // left a completed credential rotation permanently stuck on Windows.
      await rename(pending, source)
    } catch (error) {
      if (!['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error
      // The journal remains until every later step succeeds, so this
      // overwrite is recoverable if the machine is interrupted mid-copy. A
      // retry can authenticate with either journal identity and finish.
      await copyFile(pending, source)
      await unlink(pending)
    }
    await ensureRuntimeConfig({ directory, existingData: true })
    compose(['up', '--detach', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180', 'api'])
    await unlink(journal)
  } catch {
    throw new Error('Credential rotation did not finish. Keep rotation.private.json and both database volumes; start Mongo if necessary and run server:rotate again. No credentials were printed.')
  }
}
