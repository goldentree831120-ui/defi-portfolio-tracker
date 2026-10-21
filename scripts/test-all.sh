#!/usr/bin/env bash
# Every test layer, in order of speed. Stops at the first failing layer.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n=== %s ===\n' "$1"; }
step "frontend: unit tests";           (cd frontend && npm test)
step "server: indexer + API tests";    (cd server && npm test)
step "e2e: whole stack in a browser";  (cd e2e && npm test)
if [[ ${1:-} == "--mutations" ]]; then
  step "frontend: mutation check";     (cd frontend && npm run check:mutations)
  step "server: mutation check";       (cd server && npm run check:mutations)
fi
printf '\nall layers passed\n'
