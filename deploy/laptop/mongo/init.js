// Runs only when MongoDB's data volume is empty. The API is not a DB admin.
const appDb = db.getSiblingDB('neighbouraid')
appDb.createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'neighbouraid' }],
})
