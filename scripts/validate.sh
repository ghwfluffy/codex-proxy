#!/usr/bin/env bash
set -euo pipefail

npm --prefix api run lint
npm --prefix api test
npm --prefix web run build
npm --prefix web test

if rg -n -i 'ghwiz|cdxpxy|ghw[a-z]+' --glob '!package-lock.json' --glob '!scripts/validate.sh' .; then
  echo "Deployment-specific identifier found in public gateway repository." >&2
  exit 1
fi
