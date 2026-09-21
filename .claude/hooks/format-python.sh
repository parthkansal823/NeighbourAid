#!/usr/bin/env bash
# PostToolUse(Write|Edit): check backend Python that Claude just wrote.
#
# Deliberately mirrors the CI gate rather than running ruff's full ruleset.
# CI selects only E9,F63,F7,F82 -- syntax errors, undefined names, bad
# imports -- because this codebase is knowingly not ruff-clean (104 style
# findings, many already carrying explicit `# noqa`). Running `ruff format`
# or a blanket `--fix` here would bury every real change under hundreds of
# lines of unrelated reformatting.
#
# Exit 2 hands the ruff output straight back to Claude to fix in the turn.
# No-ops silently when the venv is missing or has no ruff.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
FILE="$(node "$ROOT/.claude/hooks/_hookfile.js")"
case "$FILE" in
  *.py) ;;
  *) exit 0 ;;
esac

PY="$ROOT/backend/venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$ROOT/backend/venv/bin/python"
[ -x "$PY" ] || exit 0
"$PY" -m ruff --version >/dev/null 2>&1 || exit 0

OUT="$("$PY" -m ruff check --select=E9,F63,F7,F82 "$FILE" 2>&1)"
if [ $? -ne 0 ]; then
  echo "Ruff found show-stoppers in $FILE (these fail CI):" >&2
  echo "$OUT" >&2
  exit 2
fi
exit 0
