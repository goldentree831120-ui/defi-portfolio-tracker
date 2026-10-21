#!/usr/bin/env bash
# Plant one bug at a time in src/lib; the unit tests must fail for every one.
# Each file is restored afterwards (also on Ctrl+C).
set -uo pipefail
cd "$(dirname "$0")/.."
survived=0
current=""
backup=$(mktemp)
trap '[[ -n $current ]] && cp "$backup" "$current"; rm -f "$backup"' EXIT

mutate() { # name, file, exact text, replacement
  current=$2
  cp "$2" "$backup"
  node -e '
    const fs = require("fs"); const [f, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes(a)) { console.error("pattern not found: " + a); process.exit(3); }
    fs.writeFileSync(f, s.replace(a, b));' "$2" "$3" "$4" || exit 3
  if npx vitest run >/dev/null 2>&1; then echo "SURVIVED  $1"; survived=$((survived + 1)); else echo "caught    $1"; fi
  cp "$backup" "$2"
  current=""
}

mutate "penalty also charged at the unlock second" src/lib/staking.ts "now < p.unlockTime ? (p.amount" "now <= p.unlockTime ? (p.amount"
mutate "next unlock picks the latest, not the earliest" src/lib/staking.ts "(p.unlockTime < m ? p.unlockTime : m)" "(p.unlockTime > m ? p.unlockTime : m)"
mutate "amounts rounded to one decimal too many" src/lib/format.ts "frac.slice(0, maxFrac)" "frac.slice(0, maxFrac + 1)"
mutate "zero amount accepted" src/lib/format.ts "if (v === 0n) throw" "if (v < 0n) throw"
mutate "raw MetaMask rejection (4001) not recognised" src/lib/errors.ts "rpcCode(e) === 4001" "rpcCode(e) === 4002"
mutate "OpenZeppelin custom errors not decoded" src/lib/errors.ts "return KNOWN_ERRORS.parseError(e.data)?.name" "return undefined"
echo
[[ $survived -eq 0 ]] && echo "all 6 planted bugs caught" || { echo "$survived bug(s) survived"; exit 1; }
