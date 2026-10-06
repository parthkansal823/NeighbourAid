// Authenticate the actual application user, not just an unauthenticated ping.
// During first-time initialization this fails until the final server is ready.
const user = encodeURIComponent(process.env.MONGO_APP_USER)
const password = encodeURIComponent(process.env.MONGO_APP_PASSWORD)
const connection = new Mongo(`mongodb://${user}:${password}@127.0.0.1:27017/neighbouraid?authSource=neighbouraid`)
const appDb = connection.getDB('neighbouraid')
const status = appDb.runCommand({ connectionStatus: 1 })
if (status.authInfo.authenticatedUsers.length !== 1) quit(1)
quit(appDb.runCommand({ ping: 1 }).ok === 1 ? 0 : 1)
