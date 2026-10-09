# Deployment and Android distribution

Two separate sites:

- [Real app](https://neighbouraid.kansalp-parth.workers.dev/) — web and Android use the same real backend.
- [Fictional demo](https://neighbouraid-demo.kansalp-parth.workers.dev/) — browser-only sample data, no real API or calls.

The real frontend stays hosted on Cloudflare when your laptop is off. That
does **not** keep the API online: live accounts, alerts and volunteer updates
need the Docker server running. The demo does not need the laptop.

The backend and MongoDB run only on your laptop, connected through cloudflared.
There is no Heroku/VM/cloud-backend deployment or Docker build job in CI.
Only the frontend is hosted on Cloudflare; APKs are distributed on GitHub.

## Requirements

- Node.js 22.12+ and dependencies installed with `npm ci` in `frontend/`.
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

### Optional offline Gemma + Qwen review

The default laptop image intentionally has no llama.cpp runtime, model download
or model mount. It is the normal lightweight choice. To enable the optional,
server-side two-stage review, download the GGUF files yourself under the
gitignored `models/` directory, then create the local model configuration:

```powershell
Copy-Item deploy/laptop/ai.env.example deploy/laptop/ai.env
```

The supplied `ai.env.example` selects Gemma 1B for the fast first pass and
Qwen 2.5 3B for the stronger verifier. Its paths are **inside** the container
(`/models/...`), not Windows paths. It also documents the 7B Qwen override for
a laptop with measured RAM headroom. Do not put credentials, tunnel addresses
or an API key in this file.

From `frontend/`, use the separate AI commands:

```powershell
npm run server:ai:connect
npm run server:ai:status
npm run server:ai:test
# Later:
npm run server:ai:stop
```

They add a Compose override which builds the optional `ai` target and mounts
only `../../models` at `/models` read-only. No model is copied into an image,
downloaded at startup, or called over a network. Keep using the matching
`server:ai:*` commands for backup/rotation/status while that variant is active;
ordinary `server:*` commands intentionally select the no-model image again.

This is automated server-side review, not training or factual verification.
The server is authoritative; a future phone-local Gemma may assist a draft but
is not implemented and cannot approve, restrict, resolve or otherwise control
an alert. Model errors/timeouts fall back to deterministic handling rather
than suppressing a possible emergency. See [models/README.md](models/README.md)
for review states, evaluation limits and privacy requirements for any future
fine-tuning work.

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
  It waits for successful main CI of that exact commit and the debug/native
  checks before signing. No manual tag is needed for this path.
- `v*` tag pushes can publish a named version. Use a **new** tag, not a previously
  published one; the workflow uses increasing build version codes. Tag a commit
  that has passed CI on `main`; feature/PR CI cannot authorize signing.
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
uploaded APK offers **Update now** and **Later**. In updater-enabled builds,
Android downloads the APK inside the app, checks its package/version/signing
identity, then opens Android's installer when you tap **Install update**.
The phone owner still permits installation. An unavailable
GitHub service does not block emergency features. Older APKs without this notice
need one manual upgrade first. This is not silent installation or web-code OTA.

The Android **More** menu shows the installed version and **Check for updates**.
Notification permission is optional: without it, the in-app notice still works.
Checks happen on opening/resuming or while active, not through a guaranteed
closed-app background push. An older installed APK cannot acquire the new
updater or speech plugin until you install one new **signed** APK first.

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
server-tool tests, checksum-verified actionlint and a Wrangler deployment dry run.
Actions use immutable commit pins, CI tools are pinned in
`backend/requirements-ci.txt`, and failure/coverage/security reports are retained
for 14 days. Android uses Node 22/Java 21 with Gradle wrapper validation;
signing files are removed after every build outcome and signed build state is
not written into the Gradle cache.

Configure branch protection/rulesets to require **`ci-success`**. This check runs
on pushes, PRs, merge queues and manual CI runs, and fails if any prerequisite
fails, is cancelled or is skipped. Python dependency vulnerabilities and
high/critical frontend dependency vulnerabilities, including build tooling,
block it. The full npm audit retains lower-severity findings in the Actions
summary and `security-audit-npm` artifact for review. Audit-service errors
fail rather than being reported as clean.
Dependabot opens weekly GitHub Actions, npm and Python update proposals.

Cloudflare production needs the **`CLOUDFLARE_API_TOKEN`** secret and
**`CLOUDFLARE_ACCOUNT_ID`** variable in the repository or `production` environment.
Use the token permissions described in
[Cloudflare's CI guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/).
Missing configuration produces an explicit skipped-deployment summary.

After successful main CI, deployment downloads its `frontend-edge-dist` artifact
instead of rebuilding it. The artifact's `ci-build.json` binds the SHA, CI run
and edge target; the workflow checks current main and the successful gate again
before upload. Manual production runs are main-only and require the same tested
artifact. A stale run cannot deploy over newer main code. If the artifact has
expired, run **NeighbourAid CI** on main again, then deploy. The post-deploy check
verifies the static frontend, independently of the laptop API.

Automatic publication starts only after the updated workflows are pushed and
credentials are configured; local edits do not publish a release.

CI does not build Docker images, start a database/tunnel or deploy a backend.
With your laptop stack running, use `npm run server:test` from `frontend/` to
check MongoDB authentication, edge access control and API readiness. Use
`npm run server:test -- --restart` only when a temporary API/database interruption
is acceptable; it also checks data persistence. These integration checks are
now local and must be run separately from CI.

| Symptom | Check |
|---|---|
| Docker connection fails | Open Docker Desktop and wait for the Linux engine; update Compose if older than 2.24. |
| Credentials missing with an existing volume | Restore `runtime-secrets.private.json` from its matching backup. Do not reset volumes. |
| Rotation interrupted | Keep the private journal/volumes; start Mongo if stopped and rerun `server:rotate`. |
| All real API calls return 403 | Run `server:setup` against the correct Worker to resync its edge credential, then reconnect. |
| Site says server offline | Check `server:status`, Internet/laptop sleep, then `server:connect`; allow KV propagation. |
| Sample tunnel URL rejected | Do not use `example.trycloudflare.com`. Docker connect discovers a real tunnel automatically. |
| Gradle fails on Java | Use JDK 21 and SDK 36; run `mobile:doctor`. |
| CI fails during `npm ci` | Use the committed corrected lockfile. Both Android and frontend CI use Node 22/npm 10; run a new workflow after pushing, not a rerun of the old commit. |
| Wrangler reports authentication error 10000 | From `frontend/`, run `npx wrangler login`, `npx wrangler whoami`, then `npm run server:connect`. Do not paste API tokens into chat. |
| APK refuses an update | Check signing key and increasing version code. Debug-to-release is not an in-place update. |
| No signed release | Read the Android run's signing warning/error; configure all four repository secrets. |
| Entire signed release job skipped on a manual run | Push the updated workflow to `main`, then start a new Android package run on `main`. Old manual runs and other branches do not publish releases. |

The supported server setup is `deploy/laptop/docker-compose.yml`.
It preserves database volumes on normal stop/start; the backend is reachable
only while the laptop stack and its tunnel are online.

## Voice and optional clinician review

Voice prompts and the first-aid reference guide are bundled in the clients.
Speech recognition/read-aloud still depend on the installed device services;
some require Internet access or language packs. No medical advice is generated
by the optional triage LLM. The first-aid guide needs qualified review of its
wording, translations and emergency branching before a real medical rollout.

Clinician-review requests require the local API/database/tunnel. The desk is
disabled until an operator has checked and approved a real clinician's identity
and registration. Rebuild the local API for the new routes/CLI when ready;
normal start/stop must preserve MongoDB volumes. No clinician has been enrolled
by these code changes. See [the approval and revocation procedure](docs/12-voice-first-aid-and-clinician-review.md).
