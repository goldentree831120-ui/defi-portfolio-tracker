#!/usr/bin/env bash
# Fails if any tracked file looks like it contains a secret: a raw 64-hex private key next to
# a key-like name, an RPC URL with an API key in it, or a committed .env file. Runs in CI on
# every push; run it locally before committing too.
set -uo pipefail
cd "$(dirname "$0")/.."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git repository: cannot check"; exit 2; }
found=0
report() { echo "  $1"; found=1; }

while IFS= read -r f; do
  base=${f##*/}
  case "$base" in
    .env.example|.env.sample) ;;
    .env|.env.*) report "$f: a .env file is committed (only .env.example belongs in git)";;
  esac
done < <(git ls-files)

# private keys: 64 hex chars assigned to something named like a key/secret/mnemonic
git grep -nIiE '(private_?key|secret|mnemonic)["'"'"']?\s*[:=]\s*["'"'"']?(0x)?[0-9a-f]{64}' -- . ':!*.lock' ':!*package-lock.json' ':!security/staking/lib/**' \
  | sed -E 's/[0-9a-fA-F]{64}/<64 hex hidden>/' | while IFS= read -r l; do echo "  $l"; done | grep . && found=1

# RPC provider URLs that carry an API key
# (security/staking/lib is vendored forge-std, which ships public demo RPC URLs)
git grep -nIE '(alchemy\.com/v2/|infura\.io/v3/|quiknode\.pro/)[A-Za-z0-9_-]{16,}' -- . ':!security/staking/lib/**' \
  | sed -E 's#(v2/|v3/|pro/)[A-Za-z0-9_-]+#\1<key hidden>#' | while IFS= read -r l; do echo "  $l"; done | grep . && found=1

if [[ $found -eq 0 ]]; then echo "no secrets found in tracked files"; else echo "possible secrets found (values hidden above)"; exit 1; fi
