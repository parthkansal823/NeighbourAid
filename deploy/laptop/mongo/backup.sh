#!/usr/bin/env bash
set -euo pipefail
umask 077
# Keep the password out of command arguments and send the archive to stdout.
# Node routes stdout straight into a private backup file, not the console.
task_config="$(mktemp /tmp/neighbouraid-backup.XXXXXX)"
trap 'rm -f -- "$task_config"' EXIT
printf 'password: "%s"\n' "$MONGO_APP_PASSWORD" > "$task_config"
mongodump --host 127.0.0.1 --username "$MONGO_APP_USER" \
  --authenticationDatabase neighbouraid --config "$task_config" \
  --db neighbouraid --archive --gzip
