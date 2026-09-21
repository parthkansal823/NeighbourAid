#!/usr/bin/env bash
# SessionStart: report toolchain health up front. This repo has two independent
# toolchains (backend venv, frontend node_modules) and either can be absent or
# stale in a fresh clone -- surfacing that here beats discovering it halfway
# through a task when a test command suddenly fails.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
NOTES=""

PY="$ROOT/backend/venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$ROOT/backend/venv/bin/python"
if [ ! -e "$ROOT/backend/venv" ]; then
  NOTES="$NOTES- backend venv: missing. Create it before running pytest."$'\n'
elif ! "$PY" --version >/dev/null 2>&1; then
  HOME_LINE="$(grep -m1 '^home =' "$ROOT/backend/venv/pyvenv.cfg" 2>/dev/null | sed 's/^home = //')"
  NOTES="$NOTES- backend venv: BROKEN. pyvenv.cfg points at '$HOME_LINE', which no longer exists. Recreate the venv before running pytest."$'\n'
else
  NOTES="$NOTES- backend venv: ok ($("$PY" --version 2>&1))."$'\n'
fi

if [ -d "$ROOT/frontend/node_modules" ]; then
  NOTES="$NOTES- frontend deps: installed. Checks: npm run lint, npm test, npm run build."$'\n'
else
  NOTES="$NOTES- frontend deps: missing. Run npm ci in frontend/ first."$'\n'
fi

# Passed through the environment rather than argv: the notes begin with "-",
# which node would otherwise read as one of its own flags.
NA_HOOK_NOTES="$NOTES" node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:"NeighbourAid toolchain status:\n"+(process.env.NA_HOOK_NOTES||"")}}))'
