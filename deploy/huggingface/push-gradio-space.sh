#!/usr/bin/env bash
#
# Assemble and push a Hugging Face Space running on the GRADIO SDK.
#
# Use this when Docker Spaces are gated behind a paid plan on your account.
# Gradio and Static Spaces are free; a Gradio Space just runs `app.py` and
# proxies port 7860, which is all this backend needs. See gradio/app.py.
#
# A Space is its own git repo and expects app.py + README.md + requirements
# at ITS root, while this project keeps the backend under backend/. Rather
# than contort the main repo, this builds the Space tree in a scratch
# directory and pushes only that.
#
# It force-pushes: the Space is a build artefact of this repo, not somewhere
# to edit code. Anything committed in the Space UI is lost on the next run.
#
# Usage:
#   bash deploy/huggingface/push-gradio-space.sh <hf-username> [space-name]
#
# On Windows use `bash ...` (or the PowerShell wrapper push-gradio-space.ps1).
# Running `./push-gradio-space.sh` from PowerShell does NOT execute it —
# PowerShell has no shebang handling, so it hands the file to whatever is
# associated with .sh and the file simply opens in an editor.
#
# Pass --dry-run to assemble the Space tree and print it without pushing.
# Worth doing once: the real run force-pushes.
#
# Requires git and a Hugging Face write token (git will prompt):
#   https://huggingface.co/settings/tokens

set -euo pipefail

DRY_RUN=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then DRY_RUN=1; else ARGS+=("$arg"); fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

USER_NAME="${1:-}"
SPACE_NAME="${2:-neighbouraid-api}"

if [[ -z "$USER_NAME" ]]; then
  echo "usage: $0 <hf-username> [space-name]" >&2
  echo >&2
  echo "Create the Space first at https://huggingface.co/new-space" >&2
  echo "  SDK:      Gradio  (free — Docker is the paid one)" >&2
  echo "  Template: Blank" >&2
  echo "  Hardware: CPU basic (free)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_ROOT/deploy/huggingface/gradio"
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

# Validate the Space README frontmatter locally. The Hub rejects an invalid
# one with a server-side "pre-receive hook declined" that names no field, so
# catching it here turns a guess-and-force-push loop into a one-line error.
echo "==> Validating Space README frontmatter"
"$PY" "$REPO_ROOT/deploy/huggingface/validate_readme.py" "$HERE/README.md"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Assembling Space tree"
cp "$HERE/app.py" "$STAGE/app.py"
cp "$HERE/README.md" "$STAGE/README.md"
cp -r "$REPO_ROOT/backend/app" "$STAGE/app"

# gradio is a deploy-only dependency: it exists to satisfy the Space SDK and
# render the landing page, and has no place in the backend's own
# requirements.txt where it would be installed by everyone for nothing.
{
  cat "$REPO_ROOT/backend/requirements.txt"
  echo
  echo "# Added by push-gradio-space.sh — required by the Space SDK only."
  echo "gradio>=6.23.1"
} > "$STAGE/requirements.txt"

# Never ship local config or caches. A .env here would override the Space's
# configured secrets with whatever a developer had on their laptop — most
# damagingly a MONGO_URL pointing at localhost.
find "$STAGE" \( -name '__pycache__' -o -name '*.pyc' -o -name '.env' \
  -o -name '.pytest_cache' \) -exec rm -rf {} + 2>/dev/null || true

cat > "$STAGE/.gitignore" <<'GITIGNORE'
__pycache__/
*.pyc
.env
GITIGNORE

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> --dry-run: assembled tree, not pushing"
  (cd "$STAGE" && find . -type f -not -path './.git/*' | sort | sed 's/^/    /')
  echo
  echo "    Would force-push the above to $REMOTE"
  exit 0
fi

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
echo "First push? Set these under Settings -> Variables and secrets:"
echo "    MONGO_URL and JWT_SECRET"
echo "  ENVIRONMENT already defaults to production."
