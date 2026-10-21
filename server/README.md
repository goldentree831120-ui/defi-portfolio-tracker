# server: indexer + read-only REST API (P2 M2)

A Node + TypeScript service that indexes the Staking contract's events into Postgres and
serves them over a small REST API. The front end keeps reading live values (pending rewards,
balances) from the chain. This service adds history and totals that would otherwise take
many RPC calls per page load.

```
 Sepolia / Hardhat ──eth_getLogs──▶ Indexer ──one transaction per batch──▶ Postgres
                                   (polls, waits N confirmations)          │ staking_events (raw log)
                                                                           │ positions (projection)
                                                                           │ indexer_cursor
 Browser ──GET /v1/...──▶ Fastify API ──SELECT only──────────────────────▶ ┘
```

## Run it

```bash
npm ci
npm run dev:local     # embedded Postgres + Hardhat node + the real contracts + sample activity + server
npm test              # 30 tests: indexer (11) + API (19), against real Postgres and a real Hardhat chain
npm run check:mutations   # plants 5 indexer bugs; every one must make a test fail
npm run typecheck
```

`dev:local` and the tests need no accounts, keys, Docker or installed Postgres: Postgres
comes from the `embedded-postgres` npm package, and the chain is a local Hardhat node. Run
them from a Linux folder (in WSL, under `~`, not `/mnt/c/...`), because Postgres refuses data
directories on Windows drives.

Against a real chain (Sepolia): `cp .env.example .env`, fill in `RPC_URL` (your Alchemy or
Infura URL), `STAKING_ADDRESS`, `START_BLOCK` (the deploy block) and `CONFIRMATIONS=12`. Then
`npm run migrate && npm start`. `.env` is git-ignored, and the RPC key never leaves the server.

## API

All responses are JSON. Amounts are strings in token base units (wei), because they don't fit
in a JavaScript number. Addresses are accepted in any valid form and returned checksummed.

| Route | Returns |
|---|---|
| `GET /health` | `{status, indexer}`; 503 if the database is unreachable |
| `GET /v1/status` | chain, contract, confirmations, indexer state, last indexed block, head, lag |
| `GET /v1/wallets/:address/positions?status=open\|withdrawn\|all` | every position with amount, lock, APY (bps), start/unlock time, claimed rewards, penalty |
| `GET /v1/wallets/:address/summary` | open/withdrawn counts, total staked, rewards claimed, penalties paid |
| `GET /v1/wallets/:address/events?limit=1..100&before=<id>` | event history, newest first; `nextCursor` for the next page |

Every error has the same shape and a stable code:

```json
{ "error": { "code": "INVALID_QUERY", "message": "invalid query parameters",
             "details": [{ "param": "limit", "problem": "Number must be less than or equal to 100" }] } }
```

| Code | Status | When |
|---|---|---|
| `INVALID_ADDRESS` | 400 | not 40 hex chars, or mixed case that doesn't match the checksum (a likely typo) |
| `INVALID_QUERY` | 400 | unknown or out-of-range query parameter (unknown parameters are rejected, not ignored) |
| `NOT_FOUND` | 404 | unknown route |
| `SERVICE_UNAVAILABLE` | 503 | database down (`/health`) |
| `INTERNAL` | 500 | anything else; the body never includes the underlying error |

A wallet with no history gets an empty, valid answer, not a 404.

## Indexer guarantees

Each guarantee has a test in `test/indexer.test.ts`, and `scripts/mutation-check.sh` checks
that removing it makes a test fail.

1. **Confirmation depth.** A block is read only once `CONFIRMATIONS` blocks sit on top of it,
   so ordinary reorgs (which replace the newest blocks) never reach the database.
2. **Restart without double counting.** The events of a block range and the cursor that
   says "indexed up to here" are committed in **one transaction**. A crash anywhere rolls
   both back, and the next run re-reads the same range. The tests kill the indexer mid-batch
   and check the result is identical to an uninterrupted run.
3. **Idempotent writes.** Each event is unique on `(chain_id, tx_hash, log_index)`, and the
   `positions` table is only updated for rows that were actually inserted. Re-reading a range
   that's already indexed (for example, a cursor rewound by hand) changes nothing.
4. **One writer.** The cursor row is locked `FOR UPDATE` and re-checked inside the
   transaction, so two indexer processes on one database apply each batch exactly once.
5. **Deep-reorg detection.** Before each batch, the stored hash of the last indexed block is
   compared with the chain's. If they differ, a reorg went deeper than the confirmation depth;
   the indexer **halts** and `/health` reports `degraded`, instead of silently building on a
   dead branch. Recovery is manual: rewind the cursor to before the fork, delete the events
   after it, and rebuild `positions` from `staking_events`.
6. **RPC limits.** If the provider rejects an `eth_getLogs` range as too large (free tiers
   cap it), the batch is halved until it fits. Other errors are retried with backoff and are
   not mistaken for range errors.

## Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| Polling `eth_getLogs`, not WebSocket subscriptions | works with any HTTP RPC, survives restarts; the cursor is the only state | up to `POLL_INTERVAL_MS` + confirmations of delay |
| Raw event table + derived `positions` table | the event log is the source of truth; the projection can be rebuilt from it | two writes per event |
| `numeric(78,0)` for amounts | any `uint256` fits exactly; no float rounding | values come back as strings |
| Pending rewards not stored | they change every second; the front end reads them live | the API answers history, not "what's claimable right now" |
| zod validation, strict query schemas | typos like `?limt=5` fail loudly instead of being ignored | slightly stricter than many APIs |
| CORS only for configured origins, GET only | data is public, but there's no reason to let any site use this server | add origins to `CORS_ORIGINS` |
| Config validated at startup, values never echoed | fail fast; secrets never land in logs | |
| Startup checks the RPC's chain id and that the contract has code | refuses to index the wrong chain or address | |

## Files

```
src/config.ts        env schema (zod)
src/db.ts            pool, transactions, migrations (advisory-locked)
src/migrations/      001_init.sql: indexer_cursor, staking_events, positions
src/indexer.ts       the indexer (guarantees above)
src/api.ts           Fastify routes, validation, typed errors
src/errors.ts        ApiError and the error codes
src/main.ts          wires it together; graceful shutdown on Ctrl+C / SIGTERM
scripts/dev.ts       one-command local stack
scripts/mutation-check.sh
test/                indexer.test.ts, api.test.ts, support/ (Postgres, Hardhat node, fixtures)
```

Note for the tests: `embedded-postgres` installs an exit hook that calls `process.exit(0)`.
Inside the test runner it replaced vitest's failure exit code, so failing tests exited 0. The
test Postgres therefore runs in its own child process (`test/support/pg-child.ts`).
The mutation check is how this was found: all five planted bugs "survived" until the fix.
