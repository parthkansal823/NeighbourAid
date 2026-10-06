#!/usr/bin/env bash
set -euo pipefail

# Report missing names only. Never print or persist signing secret values here.
required=(ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  printf 'configured=true\n' >> "$GITHUB_OUTPUT"
  exit 0
fi

printf 'configured=false\n' >> "$GITHUB_OUTPUT"
if [[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch || "${GITHUB_REF:-}" == refs/tags/v* ]]; then
  printf '::error::Release requested but these repository secrets are missing: %s.\n' "${missing[*]}"
  exit 1
fi

printf '::warning::Signed release skipped. Missing repository secrets: %s. The debug APK artifact is still available.\n' "${missing[*]}"
