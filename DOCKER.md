# Running with Docker (P2 M4)

Three containers, one command:

```
browser ──:8080──▶ web (nginx, unprivileged)
                    ├── /            the built frontend (static files)
                    └── /api/*  ───▶ server (Node, non-root) ──▶ db (Postgres 17)
                                       │
                                       └──▶ chain RPC (Sepolia via your provider, or the local `chain` container)
```

Only port 8080 is published, and only on 127.0.0.1. Postgres and the server are reachable
only inside the compose network. In local mode the chain is published too (8545), because
MetaMask in your browser talks to it directly.

## Fully local: no RPC provider, no keys

```bash
docker compose -f compose.yaml -f compose.local.yaml --env-file local.env up --build
./scripts/docker-smoke.sh          # in a second terminal: 11 checks against the running stack
```

This adds two containers: `chain` (a Hardhat node) and `deploy` (deploys TrackerToken and
Staking, funds the reward pool, sends 1,000 TRK to test accounts #1 and #2, then exits). The
server waits for `deploy` to finish. Everything is throwaway: the chain and the database start
empty on every `up`.

The first build downloads the base images and installs dependencies, which takes a few
minutes. Later builds reuse the cache.

To use the app at http://localhost:8080 with MetaMask:
1. Add a network: RPC `http://127.0.0.1:8545`, chain id `31337`, currency `ETH`.
2. Import test account #1. Its private key is printed in
   `docker compose -f compose.yaml -f compose.local.yaml --env-file local.env logs chain`
   (the "Account #1" entry). It's one of Hardhat's built-in test keys, which are published
   for everyone. **Never send real funds to it or use it on a real network.**
3. After restarting the stack, MetaMask may remember old nonces: Settings → Advanced →
   Clear activity tab data.

## Against Sepolia

```bash
cp .env.example .env     # fill in RPC_URL, STAKING_ADDRESS, START_BLOCK, POSTGRES_PASSWORD
docker compose up --build -d
./scripts/docker-smoke.sh
docker compose logs -f server
```

`.env` is git-ignored and stays on the machine. If a required value is missing, compose stops
before starting anything and names each one. The database lives in the `pgdata` volume, so
restarts keep the index. `docker compose down -v` deletes it (the indexer then re-reads
everything from `START_BLOCK`).

`CHAIN_ID` and `STAKING_ADDRESS` are **built into the frontend image** (Vite inlines them).
After changing them, rebuild: `docker compose up --build`.

## What's in each image

| Image | Base | Contents | Runs as |
|---|---|---|---|
| server (`runtime` target) | `node:24-bookworm-slim` | compiled `dist/` + production dependencies only (73 packages; no TypeScript, Hardhat or test tools) | `node` (uid 1000) |
| web | `nginxinc/nginx-unprivileged:1.27-alpine` | the Vite build + nginx config | nginx (non-root), port 8080 |
| chain (`chain` target, local only) | `node:24-bookworm-slim` | full dev dependencies, Hardhat node, deploy script | root (dev only, never deployed) |

- The server image runs `npm run typecheck` during the build, and the web image runs the 46
  frontend unit tests. An image with failing code doesn't build.
- Both runtime images have a `HEALTHCHECK`. `web` waits for a healthy `server`, which waits
  for a healthy `db`.
- `docker stop` sends SIGTERM to the server (PID 1), which stops polling and lets the
  in-flight batch commit or roll back (see the server README's guarantees).
- nginx: `/api/*` is GET-only (the API is read-only), hashed assets are cached for a year,
  `index.html` is always revalidated, and security headers are set on every response.
- `.dockerignore` keeps `node_modules`, `.env*` and local data out of the build context, so a
  local `.env` can never end up in an image.

## Smoke test

`scripts/docker-smoke.sh [base-url]` checks the stack from outside, the way a browser sees it:
the app loads, unknown paths fall back to the app, security headers are present and nginx
hides its version, `/api` reaches the server and the indexer is healthy, the API rejects
POST, typed errors come back, the server runs as non-root, and the frontend bundle contains
no RPC provider URL. It exits 1 if any check fails, so CI (M5) can run it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` in WSL | Docker Desktop → Settings → Resources → WSL integration → enable your distro |
| `port is already allocated` (8080 or 8545) | stop `npm run dev:local` / other stacks, or set `WEB_PORT` |
| server unhealthy, logs say `RPC is on chain X but CHAIN_ID is Y` | `RPC_URL` and `CHAIN_ID` don't match |
| `/api/health` says `degraded`, logs say a block "changed after it was indexed" | the chain changed under the stored index (a deep reorg, or a reset local chain with a kept volume): `docker compose down -v` and start again |
