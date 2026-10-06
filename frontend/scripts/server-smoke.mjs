import { randomUUID } from 'node:crypto'
import { runCompose } from './server-tools.mjs'

// Deliberately operates only inside the project's Docker API. No credentials
// leave the container, and no public users/alerts are created by this probe.
const probe = `
import asyncio,json,os,urllib.request,urllib.error
from pymongo import AsyncMongoClient
from pymongo.errors import OperationFailure

async def main():
    client=AsyncMongoClient(os.environ['MONGO_URL'],serverSelectionTimeoutMS=5000)
    db=client.get_default_database()
    await db.command('ping')
    try:
        await client.admin.command('serverStatus')
        raise AssertionError('Application user unexpectedly has admin privileges')
    except OperationFailure as error:
        assert error.code == 13
    plain=AsyncMongoClient('mongodb://mongo:27017/neighbouraid',serverSelectionTimeoutMS=5000)
    try:
        await plain.neighbouraid.users.find_one({})
        raise AssertionError('Unauthenticated database read unexpectedly succeeded')
    except OperationFailure as error:
        assert error.code == 13
    finally:
        await plain.close()
    marker=${JSON.stringify(randomUUID())}
    await db['_deployment_smoke'].insert_one({'_id':marker,'purpose':'deployment verification'})
    try:
        assert await db['_deployment_smoke'].find_one({'_id':marker})
    finally:
        await db['_deployment_smoke'].delete_one({'_id':marker})
    await client.close()
    req=urllib.request.Request('http://127.0.0.1:8000/health/ready',headers={'X-Edge-Secret':os.environ['EDGE_SECRET']})
    body=json.loads(urllib.request.urlopen(req,timeout=5).read())
    assert body['status']=='ok' and body['database']=='ok'
    try:
        urllib.request.urlopen('http://127.0.0.1:8000/health/ready',timeout=5)
        raise AssertionError('Direct API access unexpectedly succeeded')
    except urllib.error.HTTPError as error:
        assert error.code == 403
    print('MongoDB CRUD/auth, least-privilege app user, API readiness and edge guard passed.')
asyncio.run(main())
`

const persistenceProbe = `
import asyncio,os,sys
from pymongo import AsyncMongoClient
async def main():
    client=AsyncMongoClient(os.environ['MONGO_URL'],serverSelectionTimeoutMS=5000)
    collection=client.get_default_database()['_deployment_smoke']
    action,marker=sys.argv[1:3]
    if action=='save': await collection.insert_one({'_id':marker,'purpose':'volume persistence verification'})
    elif action=='check': assert await collection.find_one({'_id':marker}), 'Own persistence probe disappeared'
    elif action=='remove': await collection.delete_one({'_id':marker})
    await client.close()
asyncio.run(main())
`
try {
  const rows = runCompose(['ps', '--format', 'json'], { stdio: 'pipe', encoding: 'utf8' }).trim().split('\n').filter(Boolean).flatMap((line) => {
    const value = JSON.parse(line)
    return Array.isArray(value) ? value : [value]
  })
  for (const row of rows) {
    if (['api', 'mongo'].includes(row.Service) && row.Publishers?.some((port) => port.PublishedPort > 0)) {
      throw new Error('An API/database port is publicly published; check the Compose configuration.')
    }
  }
  runCompose(['exec', '-T', 'api', 'python', '-c', probe])
  if (process.argv.includes('--restart')) {
    const marker = randomUUID()
    const run = (action) => runCompose(['exec', '-T', 'api', 'python', '-c', persistenceProbe, action, marker])
    run('save')
    try {
      runCompose(['stop', 'api', 'mongo'])
      runCompose(['up', '--detach', '--no-build', '--wait', '--wait-timeout', '180', 'api'])
      run('check')
      console.log('MongoDB volume persistence across a real stop/start passed.')
    } finally {
      run('remove')
    }
  }
} catch {
  console.error('Docker verification failed. Check server:status; no public alerts were created.')
  process.exitCode = 1
}
