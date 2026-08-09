#!/usr/bin/env bash
set -euo pipefail

npm --prefix api run lint
npm --prefix api test
npm --prefix web run build
npm --prefix web test

scan_deployment_identifiers() {
  if command -v rg >/dev/null 2>&1; then
    rg -n -i 'ghwiz|cdxpxy|ghw[a-z]+' --glob '!.gitmodules' --glob '!package-lock.json' --glob '!scripts/validate.sh' --glob '!vendor/federated-banner/**' .
    return
  fi
  grep -RInEi 'ghwiz|cdxpxy|ghw[a-z]+' . \
    --exclude=.gitmodules \
    --exclude=.env \
    --exclude='*.log' \
    --exclude=package-lock.json \
    --exclude=validate.sh \
    --exclude-dir=.codex-home \
    --exclude-dir=.git \
    --exclude-dir=coverage \
    --exclude-dir=dist \
    --exclude-dir=federated-banner \
    --exclude-dir=node_modules \
    --exclude-dir=secrets
}

if scan_deployment_identifiers; then
  echo "Deployment-specific identifier found in public gateway repository." >&2
  exit 1
fi
