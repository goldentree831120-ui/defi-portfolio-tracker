#!/usr/bin/env bash
# Checks a running `docker compose` stack from the outside, the way a browser sees it.
#   ./scripts/docker-smoke.sh                 # http://127.0.0.1:8080
#   ./scripts/docker-smoke.sh http://host:port
#   SMOKE_SKIP_DOCKER=1 ./scripts/docker-smoke.sh https://xxxx.cloudfront.net   # from a machine not running the stack
set -uo pipefail
BASE=${1:-http://127.0.0.1:8080}
USER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 # Hardhat test account #1 (local mode)
fails=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

printf 'waiting for %s/api/health ' "$BASE"
for _ in $(seq 1 90); do
  curl -sf "$BASE/api/health" >/dev/null && break
  printf '.'; sleep 2
done
echo

headers=$(curl -sI "$BASE/")
status=$(curl -s "$BASE/api/v1/status")
health=$(curl -s "$BASE/api/health")

check "web serves the app"                         '[[ $(curl -s -o /dev/null -w "%{http_code}" "$BASE/") == 200 ]]'
check "unknown paths fall back to the app (SPA)"   'curl -s "$BASE/some/page" | grep -q "<div id=\"root\""'
check "security headers present"                   'grep -qi "x-content-type-options: nosniff" <<<"$headers" && grep -qi "x-frame-options: deny" <<<"$headers"'
check "nginx version hidden"                       '! grep -qiE "^server: nginx/[0-9]" <<<"$headers"'
check "API reachable through /api, health ok"      'grep -q "\"status\":\"ok\"" <<<"$health"'
check "indexer running or caught up"               'grep -qE "\"state\":\"(running|caught-up)\"" <<<"$status"'
check "API is read-only: POST rejected"            '[[ $(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/status") =~ ^(403|405)$ ]]'
check "typed error for a bad address"              'curl -s "$BASE/api/v1/wallets/0xdeadbeef/summary" | grep -q INVALID_ADDRESS'
check "wallet summary answers"                     'curl -s "$BASE/api/v1/wallets/$USER_ADDR/summary" | grep -q "\"address\""'

if [[ -z ${SMOKE_SKIP_DOCKER:-} ]] && command -v docker >/dev/null; then
  # Find the containers by compose labels, so this works however the stack was started
  # (with or without compose.local.yaml / --env-file). The project name is set in compose.yaml.
  cid() { docker ps -q --filter label=com.docker.compose.project=defi-tracker --filter "label=com.docker.compose.service=$1" | head -1; }
  server_id=$(cid server); web_id=$(cid web)
  uid=$([[ -n $server_id ]] && docker exec "$server_id" id -u 2>/dev/null | tr -d '\r')
  check "server runs as a non-root user (uid ${uid:-?})" '[[ $uid =~ ^[0-9]+$ && $uid != 0 ]]'
  bundle=$([[ -n $web_id ]] && docker exec "$web_id" sh -c 'cat /usr/share/nginx/html/assets/*.js' 2>/dev/null)
  check "no RPC key in the frontend bundle"        '[[ -n $bundle ]] && ! grep -qiE "alchemy\.com/v2/|infura\.io/v3/" <<<"$bundle"'
fi

echo "status: $status"
echo
[[ $fails -eq 0 ]] && echo "smoke test passed" || { echo "$fails check(s) failed"; exit 1; }
