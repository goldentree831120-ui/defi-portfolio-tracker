#!/usr/bin/env bash
# Run ON THE EC2 SERVER, in /home/ubuntu/app: pull the latest code, (re)build, start, smoke-test.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "missing .env: cp deploy/server.env.example .env and fill it in"; exit 2; }
grep -qE '^RPC_URL=https://' .env || { echo ".env: RPC_URL is not set"; exit 2; }
grep -qE '^POSTGRES_PASSWORD=[A-Za-z0-9]{16,}' .env || { echo ".env: set POSTGRES_PASSWORD (openssl rand -hex 24)"; exit 2; }
git pull --ff-only
docker compose -f compose.yaml -f compose.aws.yaml up -d --build --remove-orphans
docker image prune -f >/dev/null
./scripts/docker-smoke.sh http://127.0.0.1
