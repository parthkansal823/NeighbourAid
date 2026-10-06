import { setApiOrigin } from './server-tools.mjs'

if (!process.argv[2]) {
  console.error('Usage: npm run set-api <actual HTTPS tunnel origin>\nOr use npm run server:connect to start the Docker backend and tunnel automatically.')
  process.exitCode = 1
} else {
  try {
    const origin = await setApiOrigin(process.argv[2])
    console.log(`Verified API and updated routing to ${origin}.\nThe public website URL is unchanged. KV changes may take about a minute to reach every edge.\nWhen the backend stops, the real app will show that its server is offline.`)
  } catch (error) {
    // Fetch errors can contain implementation details; nothing needs the
    // tunnel credentials here, and the existing KV value stays untouched.
    console.error(`Could not update the API origin: ${error.message}\nCheck the tunnel, Docker backend, Wrangler login and CONFIG binding.`)
    process.exitCode = 1
  }
}
