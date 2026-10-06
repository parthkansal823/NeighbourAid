# Deployment and Android distribution

Two separate sites:

- [Real app](https://neighbouraid.kansalp-parth.workers.dev/) — web and Android use the same real backend.
- [Fictional demo](https://neighbouraid-demo.kansalp-parth.workers.dev/) — browser-only sample data, no real API or calls.

The real frontend stays hosted on Cloudflare when your laptop is off. That
does **not** keep the API online: live accounts, alerts and volunteer updates
need the Docker server running. The demo does not need the laptop.

## Requirements

- Node.js 22+ and dependencies installed with `npm ci` in `frontend/`.
- Docker Desktop, Linux containers, engine running; Compose plugin 2.24+.
- A Cloudflare account you control, with Wrangler authenticated to it.
- For APK builds only: JDK 21 and Android SDK platform/build tools 36, with
  licences accepted. Neither Python nor Android tools are needed to run Docker.

## One-time real-app setup

Run from the repository root:

```powershell
cd frontend
npm ci
npx wrangler login
npx wrangler whoami
```

Check `frontend/wrangler.jsonc`: its Worker name and `CONFIG` KV namespace must
belong to your account. **Reuse the existing namespace** for this project's
existing deployment. Only a new account needs:

```powershell
npx wrangler kv namespace create CONFIG
```

For a new namespace, put the returned ID in the `CONFIG` binding before going
further. Do not create a replacement namespace on every start.

Create `frontend/.env.production` from `.env.production.example` **only if
it does not already exist**:

```powershell
if (!(Test-Path -LiteralPath .env.production)) {
    Copy-Item -LiteralPath .env.production.example -Destination .env.production
}
```

Use `VITE_EDGE_PROXY=1`. Leave `VITE_API_URL` and `VITE_WS_URL` unset so clients
never bypass the Worker. Preserve other existing configuration.

```powershell
npm run server:setup
npm run deploy
```

`server:setup` prepares random local JWT/database/edge credentials and uploads
only the edge credential to the real Worker through Wrangler's secret command.
This changes the Cloudflare account's Worker configuration; confirm your account
before running it. `deploy` builds and publishes the web assets and edge code.
The first image pull/build happens when you connect the server.

Generated files, all private and ignored:

| File in `deploy/laptop/` | Purpose |
|---|---|
| `runtime-secrets.private.json` | Stable master JWT and database credentials |
| `app.private.env` | API JWT and least-privilege database connection |
| `mongo.private.env` | Mongo initialization and health-check credentials |
| `edge.env` | Shared Worker/API edge authentication |

Back these up securely. Do not send them to friends or add them to Git. No
manual `JWT_SECRET`, `MONGO_URL` or Atlas setup is required for this stack.
An optional `backend/.env` can supply Web Push/WhatsApp/AI settings;
the generated Docker configuration overrides its core database/JWT values.

## Start and stop the laptop server

Keep Docker Desktop open, then from `frontend/`:

```powershell
npm run server:connect
npm run server:status
npm run server:test
```

The command starts MongoDB, waits for authentication to work, starts one
FastAPI process, opens a temporary Cloudflare Tunnel, checks API/database
readiness through it, and updates `CONFIG/API_ORIGIN`. It does not rebuild
the web app or APK. KV changes may take about a minute to propagate.

Neither port 27017 nor 8000 is published to the host or LAN. Only the tunnel
provides ingress, and the API checks the Worker's edge credential. MongoDB
has its own internal Docker network and the API has only `readWrite` access
to the `neighbouraid` database, not database-administrator permissions.

```powershell
npm run server:stop
```

This stops/removes the stack's containers but **retains its MongoDB volumes**.
The static Cloudflare website remains available and reports the server offline.
Next time, use `server:connect` with the same generated secrets.

The database is new and local to Docker. Existing Atlas data is untouched and
is not automatically migrated. Sleep/shutdown or loss of Internet stops live
requests. Quick Tunnels are intended for testing; they have no uptime guarantee.
For a reliable public service, plan an always-on host and a managed/named tunnel
or proper HTTPS ingress. See [Cloudflare's Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Database backups, rotation and recovery

With MongoDB running:

```powershell
npm run server:backup
```

This writes a compressed `mongodump` archive under ignored `backups/`, using
the application database user. Passwords are not put in command arguments.
The archive contains application data; protect it along with the generated
secrets. Gitignore is not encryption. Copy backups off the laptop into secure
storage and test a restore separately before relying on them. The script does
not perform a restore or automatically back up on a schedule.

To deliberately change exposed/old JWT and MongoDB credentials:

```powershell
npm run server:rotate
npm run server:test
# Reconnect the public tunnel when ready:
npm run server:connect
```

Rotation first creates a database backup and private recovery records. It stops
API/tunnel access, changes the actual MongoDB passwords without replacing its
volumes, rejects old database credentials, updates private configuration, and
recreates the API/database containers. Existing sessions must sign in again.
It does not change optional provider credentials in `backend/.env` or the edge
credential. A partially finished run retains `rotation.private.json`; keep
that file and both volumes and rerun the rotation rather than inventing new
passwords. MongoDB must be running for the backup/rotation commands.

Never edit only an env-file password: Mongo initialization variables apply
only to an empty data volume, so that would lock the app out of its existing
database. Never use `down --volumes`, volume pruning or deleting a master
credential file as a repair step. Restore matching private secrets from backup.
Database restoration/migration needs a separate, carefully tested procedure;
the app does not silently import Atlas records.

If credentials were committed, `.gitignore` alone does not untrack them. This
update removes the old generated secret files from the working tree; include
those deletions in your own commit. Old history may still contain **retired**
values. Rotate exposed credentials and coordinate history cleanup with
collaborators; deleting a current file does not erase earlier commits.

## Deploy the separate fictional demo

```powershell
cd frontend
npm ci
npx wrangler login
npm run demo:deploy
```

`wrangler.demo.jsonc` publishes only demo assets. There is no CONFIG namespace,
API origin or backend secret in that deployment. Friends can open the
[demo link](https://neighbouraid-demo.kansalp-parth.workers.dev/) on a phone or
computer; sample interactions are not shared or saved to the real DB.

## Android signing and automatic releases

Distribution is through [GitHub Releases](https://github.com/parthkansal823/NeighbourAid/releases),
not Play Store. You need your own stable release signing key, not a paid store
account. Android updates require the same signing identity and a newer version
code. See [Android's signing documentation](https://developer.android.com/studio/publish/app-signing).

The repository/releases must be publicly accessible for friends to download
without a GitHub login and for the app's unauthenticated update check. Never
embed a GitHub access token in an APK to bypass a private repository.

### Create a signing key once

If you already have a release keystore, reuse and back it up; do not generate
a replacement just to fix a skipped workflow job.

With JDK 21 installed, run from the repository root:

```powershell
keytool -genkeypair -v -keystore neighbouraid-release.jks -alias neighbouraid -keyalg RSA -keysize 3072 -validity 10000
```

Enter your own password when prompted. Back up the keystore securely; losing
it prevents compatible APK updates. Never commit it or paste it into chat.
Keystore files are ignored by the repository's signing-file rules.

Go to repository **Settings → Secrets and variables → Actions → New
repository secret** and add:

| Secret | What to put in it |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of your `.jks` file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `neighbouraid`, if you used the command above |
| `ANDROID_KEY_PASSWORD` | Key password; for the default PKCS12 format, use the store password |

Copy the Base64 value privately to the Windows clipboard without printing it:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath .\neighbouraid-release.jks))) | Set-Clipboard
```

Paste only into the named GitHub secret, then clear your clipboard. Do not share
screenshots of its contents. Optional repository variable
`NEIGHBOURAID_WORKER_URL` chooses a different public Worker origin; no tunnel
address or private API key belongs there.

### What happens after your push

- Relevant pushes/PRs build and test a debug APK; its Actions artifact lasts
  14 days and is for testing.
- A relevant push to `main` also builds a signed APK if all four secrets exist,
  then publishes an `android-<run-number>` release with APK and SHA-256 checksum.
  No manual tag is needed for this path.
- `v*` tag pushes can publish a named version. Use a **new** tag, not a previously
  published one; the workflow uses increasing build version codes.
- After pushing this workflow, choose **Actions → Android package → Run workflow →
  main** to build and publish a release manually. Manual runs on other branches
  build only the debug APK.
- Without signing secrets, main builds skip signed publication with a warning.
  An explicit version-tag or manual-main release fails instead and lists the
  missing secret names without printing their values.

Older versions of the workflow allowed signed publication only on pushes, so
their manual runs skip the entire release job even when all secrets exist.
Push the updated workflow to `main`, then start a **new** run. Re-running an old
run keeps its original commit/ref and does not pick up the changed policy. See
[GitHub's re-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

An installed APK from this update checks GitHub's public latest release on
opening/returning to the app and at most once per four hours after a successful
check while active. It sends no account token or app records to GitHub. A newer
uploaded APK offers **Download update** and **Later**. Downloading opens an
external link; the user still permits installation in Android. An unavailable
GitHub service does not block emergency features. Older APKs without this notice
need one manual upgrade first. This is not silent installation or web-code OTA.

Keep using the same signing key. Moving from debug to release may need
uninstalling the debug APK: **send saved offline reports first**, because
uninstalling can erase local data. Do not share debug artifacts as stable
release APKs.

### Local APK build and phone checks

After installing JDK 21 and SDK 36 and accepting licences:

```powershell
cd frontend
npm run mobile:doctor
npm run mobile:apk
```

Debug output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
Local release format: [keystore.properties.example](frontend/android/keystore.properties.example).
The Android shell is generated by Capacitor; sync using the commands above.

Before distributing, test on a physical phone: installation/update with the same
key, login, GPS permission, photo selection, alert creation, volunteer response,
WebSocket reconnection, server-offline state and queued delivery after reconnect.
Check the update link and Android confirmation with two signed versions too.
An APK build/signature check does not replace these phone tests.

## CI and common problems

CI runs Python 3.12/3.13 backend tests, frontend tests/lint/build modes,
server-tool tests and Docker MongoDB/API auth/readiness checks. Dependency
audits are non-blocking. Android uses Node 22/Java 21. Automatic publication
starts only after you push the updated workflow and configure signing secrets;
local edits do not publish a release.

The Docker job builds only the backend image and starts temporary MongoDB/API
containers to test authentication, edge access control, readiness and persistence
after a restart. It does not run cloudflared, publish Docker images or deploy
anything to your laptop. The frontend's optional Nginx container build is not
part of CI because the deployed website uses Cloudflare.

| Symptom | Check |
|---|---|
| Docker connection fails | Open Docker Desktop and wait for the Linux engine; update Compose if older than 2.24. |
| Credentials missing with an existing volume | Restore `runtime-secrets.private.json` from its matching backup. Do not reset volumes. |
| Rotation interrupted | Keep the private journal/volumes; start Mongo if stopped and rerun `server:rotate`. |
| All real API calls return 403 | Run `server:setup` against the correct Worker to resync its edge credential, then reconnect. |
| Site says server offline | Check `server:status`, Internet/laptop sleep, then `server:connect`; allow KV propagation. |
| Sample tunnel URL rejected | Do not use `example.trycloudflare.com`. Docker connect discovers a real tunnel automatically. |
| Gradle fails on Java | Use JDK 21 and SDK 36; run `mobile:doctor`. |
| APK refuses an update | Check signing key and increasing version code. Debug-to-release is not an in-place update. |
| No signed release | Read the Android run's signing warning/error; configure all four repository secrets. |
| Entire signed release job skipped on a manual run | Push the updated workflow to `main`, then start a new Android package run on `main`. Old manual runs and other branches do not publish releases. |

`deploy/vm/` is a separate legacy Caddy/VM option with external MongoDB. The
self-contained MongoDB setup here is `deploy/laptop/docker-compose.yml`; the
VM scripts do not automatically include it.
