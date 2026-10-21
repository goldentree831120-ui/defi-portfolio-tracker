#!/usr/bin/env bash
# Plant one bug at a time in src/indexer.ts; the indexer tests must fail for every one.
# Restores the file afterwards (also on Ctrl+C).
set -uo pipefail
cd "$(dirname "$0")/.."
FILE=src/indexer.ts
BACKUP=$(mktemp)
cp "$FILE" "$BACKUP"
trap 'cp "$BACKUP" "$FILE"; rm -f "$BACKUP"' EXIT

mutate() { # name, exact text to replace, replacement
  cp "$BACKUP" "$FILE"
  node -e '
    const fs = require("fs"); const [f, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes(a)) { console.error("pattern not found: " + a); process.exit(3); }
    fs.writeFileSync(f, s.replace(a, b));' "$FILE" "$2" "$3" || exit 3
  if npx vitest run test/indexer.test.ts >/dev/null 2>&1; then
    echo "SURVIVED  $1"; survived=$((survived + 1))
  else
    echo "caught    $1"
  fi
}

survived=0
mutate "projection updated even for duplicate event rows" "    if (ins.rowCount === 0) return false;" ""
mutate "confirmation depth ignored"                       "const safe = head - confirmations;" "const safe = head;"
mutate "stale cursor not re-checked inside the transaction" "if (locked.lastBlock !== cursor.lastBlock) return -1;" ""
mutate "deep-reorg guard removed"                         "if (b?.hash !== cursor.lastBlockHash) {" "if (false) {"
mutate "every RPC error treated as 'range too large'"     "if (size <= 1 || !isRangeError(e)) throw e;" "if (size <= 1) throw e;"
echo
[[ $survived -eq 0 ]] && echo "all 5 planted bugs caught" || { echo "$survived bug(s) survived"; exit 1; }
