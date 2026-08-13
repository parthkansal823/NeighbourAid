#!/usr/bin/env bash
#
# One-shot backend deploy on a fresh Ubuntu/Debian VM.
# Written for a DigitalOcean droplet bought with GitHub Student Pack credit,
# but nothing here is DigitalOcean-specific.
#
#   ssh root@YOUR_SERVER_IP
#   git clone https://github.com/pk23nk21/NeighbourAid.git
#   cd NeighbourAid && bash deploy/vm/setup.sh
#
# Re-runs are safe.
#
# BEFORE YOU RUN THIS: point your domain's A record at this server's IP.
# Caddy proves domain ownership over port 80 to get a certificate, and that
# fails if DNS has not propagated. Check with:  dig +short YOUR_DOMAIN

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- docker ---
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "${SUDO_USER:-$USER}" 2>/dev/null || true
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 missing. Install docker-compose-plugin."

# ------------------------------------------------------------------- env ---
if [ ! -f "$ENV_FILE" ]; then
  say "Creating $ENV_FILE"
  # 64 hex chars = 32 bytes, exactly the HS256 floor config.py enforces.
  SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
# ---- required ----
# MongoDB Atlas connection string (free M0, Mumbai region).
MONGO_URL=

# Domain pointing at this server. Caddy gets a TLS certificate for it.
# A free .me domain comes with the GitHub Student Pack via Namecheap.
DOMAIN=

# Where Let's Encrypt sends expiry warnings.
TLS_EMAIL=

# ---- generated, do not edit ----
JWT_SECRET=$SECRET

# ---- optional ----
# Only needed for a custom frontend domain. *.workers.dev and *.pages.dev
# are already allowed by the CORS regex in app/main.py.
FRONTEND_ORIGINS=
EOF
  chmod 600 "$ENV_FILE"
  die "Wrote $ENV_FILE with a fresh JWT_SECRET. Fill in MONGO_URL, DOMAIN and TLS_EMAIL, then re-run."
fi

set -a; . "$ENV_FILE"; set +a
[ -n "${MONGO_URL:-}" ]  || die "MONGO_URL is empty in $ENV_FILE"
[ -n "${DOMAIN:-}" ]     || die "DOMAIN is empty in $ENV_FILE"
[ -n "${TLS_EMAIL:-}" ]  || die "TLS_EMAIL is empty in $ENV_FILE"

case "$MONGO_URL" in
  *localhost*|*127.0.0.1*)
    die "MONGO_URL points at localhost. Inside a container that is the container itself, not the host — use the Atlas URI, or uncomment the mongo service and use mongodb://mongo:27017/neighbouraid" ;;
esac

# --------------------------------------------------------------- dns gate ---
# Checked before starting, because a failed ACME challenge counts against a
# Let's Encrypt rate limit that locks you out for a week.
say "Checking DNS for $DOMAIN"
MY_IP="$(curl -fsS4 https://api.ipify.org || true)"
DNS_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
if [ -z "$DNS_IP" ]; then
  die "$DOMAIN does not resolve yet. Add an A record pointing at ${MY_IP:-this server} and wait a few minutes."
elif [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; then
  printf '\n\033[1;33mWARNING:\033[0m %s resolves to %s but this server is %s.\n' "$DOMAIN" "$DNS_IP" "$MY_IP"
  printf 'Certificate issuance will fail. Continue anyway? [y/N] '
  read -r reply
  [ "$reply" = "y" ] || exit 1
else
  echo "    $DOMAIN -> $DNS_IP (matches this server)"
fi

# ------------------------------------------------------------------ boot ---
say "Building and starting"
cd "$HERE"
docker compose up -d --build

say "Waiting for the API to report healthy"
for _ in $(seq 1 30); do
  if [ "$(docker compose ps --format json api 2>/dev/null | grep -c healthy)" -gt 0 ]; then break; fi
  sleep 3
done
docker compose ps

say "Verifying"
sleep 3
printf '  https://%s/health        -> ' "$DOMAIN"; curl -fsS -m 25 "https://$DOMAIN/health" || echo "not ready yet"
printf '\n  https://%s/health/ready  -> ' "$DOMAIN"; curl -fsS -m 25 "https://$DOMAIN/health/ready" || echo "not ready yet"

cat <<EOF


Backend is up at https://$DOMAIN

Next:
  1. Frontend — set these in frontend/.env.production, then \`npm run deploy\`:
       VITE_API_URL=https://$DOMAIN
       VITE_WS_URL=wss://$DOMAIN
     wss:// not ws:// — a browser on an https page blocks insecure
     WebSockets, and it fails silently: the volunteer feed simply never
     receives anything.

  2. Uptime — point UptimeRobot at https://$DOMAIN/health/ready every 5 min.
     This VM does not sleep, so it is monitoring rather than a keep-alive,
     but it is the endpoint that tells you Atlas is reachable.

  3. Firewall — allow only 80, 443 and 22:
       ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable

Logs:     docker compose -f $HERE/docker-compose.yml logs -f api
Update:   git pull && bash deploy/vm/setup.sh
EOF
