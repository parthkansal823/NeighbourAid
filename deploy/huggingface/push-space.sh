#!/usr/bin/env bash
#
# Assemble and push the Hugging Face Space for the NeighbourAid API.
#
# A Space is its own git repo and expects Dockerfile + README.md at ITS root,
# while this project keeps the backend under backend/ and has its own README.
# Rather than contort the main repo to satisfy that layout, this script builds
# the Space's tree in a scratch directory and pushes only that.
#
# It force-pushes: the Space is a build artefact of this repo, not somewhere
# to edit code. Anything committed directly in the Space UI is lost on the
# next run — which is the intended behaviour, since the alternative is two
# copies of the backend drifting apart.
#
# Usage:
#   ./deploy/huggingface/push-space.sh <hf-username> <space-name>
#
# Example:
#   ./deploy/huggingface/push-space.sh parthkansal823 neighbouraid-api
#
# Requires: git, and a Hugging Face write token. The token is requested at
# push time by git's credential prompt — generate one at
# https://huggingface.co/settings/tokens (role: write).

set -euo pipefail

USER_NAME="${1:-}"
SPACE_NAME="${2:-neighbouraid-api}"

if [[ -z "$USER_NAME" ]]; then
  echo "usage: $0 <hf-username> [space-name]" >&2
  echo "the Space must already exist — create it at https://huggingface.co/new-space" >&2
  echo "choosing SDK: Docker, and leaving the template blank" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_ROOT/deploy/huggingface"
REMOTE="https://huggingface.co/spaces/${USER_NAME}/${SPACE_NAME}"

# Refuse to ship an untested backend. The Space has no CI of its own, so this
# is the only gate between a broken commit and production.
echo "==> Running backend tests"
if [[ -x "$REPO_ROOT/backend/venv/Scripts/python.exe" ]]; then
  PY="$REPO_ROOT/backend/venv/Scripts/python.exe"
elif [[ -x "$REPO_ROOT/backend/venv/bin/python" ]]; then
  PY="$REPO_ROOT/backend/venv/bin/python"
else
  PY="python3"
fi
(cd "$REPO_ROOT/backend" && "$PY" -m pytest -q)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Assembling Space tree in $STAGE"
cp "$HERE/Dockerfile" "$STAGE/Dockerfile"
cp "$HERE/README.md" "$STAGE/README.md"
cp "$REPO_ROOT/backend/requirements.txt" "$STAGE/requirements.txt"
cp -r "$REPO_ROOT/backend/app" "$STAGE/app"

# Never ship local config or caches. A .env here would override the Space's
# configured secrets with whatever a developer had on their laptop — most
# damagingly a MONGO_URL pointing at localhost, which fails closed, or one
# pointing at a personal cluster, which does not.
find "$STAGE" \( -name '__pycache__' -o -name '*.pyc' -o -name '.env' \
  -o -name '.pytest_cache' \) -exec rm -rf {} + 2>/dev/null || true

cat > "$STAGE/.gitignore" <<'GITIGNORE'
__pycache__/
*.pyc
.env
GITIGNORE

echo "==> Pushing to $REMOTE"
cd "$STAGE"
git init -q -b main
git add -A
git -c user.email=deploy@neighbouraid -c user.name=deploy \
    commit -qm "Deploy from $(cd "$REPO_ROOT" && git rev-parse --short HEAD)"
git remote add space "$REMOTE"
git push -q --force space main

echo
echo "==> Done. Build logs: ${REMOTE}?logs=build"
echo "    Live URL:        https://${USER_NAME}-${SPACE_NAME}.hf.space"
echo
echo "If this is the first push, set the secrets now under Settings →"
echo "Variables and secrets: MONGO_URL, JWT_SECRET, ENVIRONMENT=production,"
echo "and optionally ANTHROPIC_API_KEY. The Space restarts automatically."
