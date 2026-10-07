#!/usr/bin/env bash
set -euo pipefail

# Fixed release and digest from rhysd/actionlint's published checksums.
# A changed/download-corrupted binary must never be executed by CI.
version=1.7.12
sha256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
tool_dir="$(mktemp -d)"
trap 'rm -rf -- "$tool_dir"' EXIT
archive="$tool_dir/actionlint.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_amd64.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$tool_dir" actionlint
"$tool_dir/actionlint" -color
