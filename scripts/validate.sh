#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-full}"

if [[ "$mode" != "full" && "$mode" != "quick" ]]; then
  echo "Usage: $0 [quick|full]" >&2
  exit 2
fi

echo "==> Running tests"
npm test

if [[ "$mode" == "quick" ]]; then
  echo "==> Quick validation complete"
  exit 0
fi

echo "==> Building app"
npm run build

echo "==> Validation complete"
