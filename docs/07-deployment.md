# Deployment

The backend is local-only: Docker on your laptop, reached through a tunnel.
No external backend host or VM deployment is part of this setup.

The current step-by-step guide is **[DEPLOY.md](../DEPLOY.md)**. It covers:

- Cloudflare Worker/static frontend and the separate fictional demo.
- On-demand **Docker MongoDB + FastAPI + cloudflared** on the laptop.
- Private networking, generated credentials, backups and rotation.
- Android APK signing, GitHub Releases and installed-app update notices.
- Startup commands, recovery precautions and phone testing.

The [real app](https://neighbouraid.kansalp-parth.workers.dev/) needs its backend
running for live data. The [demo](https://neighbouraid-demo.kansalp-parth.workers.dev/)
uses fictional browser-local data and does not need a server. The Android package
uses the real backend, not the demo.

The laptop stack uses a separate persistent MongoDB volume. Atlas records are
not automatically migrated or removed. Stopping the stack preserves its volumes;
deleting them destroys that local database. Keep private credentials and data
backups outside Git.

Earlier instructions here described different hosting experiments. They are
replaced by the linked guide; this is not a promise of free hosting, unlimited
capacity or emergency-service uptime.

For source development, see [06-development.md](06-development.md). For using
the app, see [02-user-guide.md](02-user-guide.md).
