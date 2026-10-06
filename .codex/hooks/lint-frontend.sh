#!/usr/bin/env bash
# PostToolUse(Write|Edit): lint frontend sources Claude just wrote.
#
# CI gates on `eslint --max-warnings 0`, and this config carries no
# auto-fixable style rules -- its teeth are no-undef / react/jsx-no-undef /
# no-unused-vars, none of which --fix can repair. So the hook runs --fix for
# the little it can do, then re-lints and exits 2 on anything left, which
# hands the exact eslint output back to Claude to fix in the same turn.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
FILE="$(node "$ROOT/.claude/hooks/_hookfile.js")"
case "$FILE" in
  *.js|*.jsx) ;;
  *) exit 0 ;;
esac
case "$FILE" in
  *frontend/*) ;;
  *) exit 0 ;;
esac
[ -d "$ROOT/frontend/node_modules" ] || exit 0

cd "$ROOT/frontend" || exit 0
npx --no-install eslint --fix "$FILE" >/dev/null 2>&1

OUT="$(npx --no-install eslint "$FILE" 2>&1)"
if [ $? -ne 0 ]; then
  echo "ESLint failures in $FILE (CI runs --max-warnings 0, so these block the build):" >&2
  echo "$OUT" >&2
  exit 2
fi
exit 0
