#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Running tests"
npm test

echo "==> Building app"
npm run build

echo "==> Validation complete"
