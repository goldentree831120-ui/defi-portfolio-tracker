# e2e: the whole stack, through the real UI (P2 M3)

One Playwright suite that starts everything on your machine and drives the real frontend in
Chromium:

```
Postgres (embedded) ← server (indexer + API) ← Hardhat node :8545 ← test wallet ← frontend (Vite) ← Playwright
```

| Test | Checks |
|---|---|
| connect | rejecting the wallet prompt shows a notice; approving shows the dashboard |
| stake | approve + stake 100 TRK for 90 days **in the UI**; the position is in the UI, on-chain (`positionsOf`) and in the API (`/positions`, `/summary`) |
| rejected transaction | the user rejects in the wallet: nothing is sent, and the API's event count doesn't change |
| early withdrawal | the UI asks for confirmation; the API records the 10% penalty |

The wallet is `support/inject.js`, a minimal stand-in for MetaMask (`window.ethereum`) that
forwards to the Hardhat node. The node signs for its built-in test accounts, so no private key
exists in the browser or in this repo. A test can make the "user" press Reject (error 4001).

## Run

```bash
# once
(cd ../server && npm ci) && (cd ../frontend && npm ci) && npm ci
npx playwright install chromium          # downloads the browser (~150 MB)
sudo npx playwright install-deps chromium  # Linux/WSL only: the system libraries Chromium needs

npm test             # ~30 s; starts and stops everything itself
npm run report       # HTML report; failures keep a screenshot and a trace
```

Ports 8545 (chain), 3101 (API), 5174 (web) and 54341 (Postgres) must be free: stop
`npm run dev:local` first. A deliberately planted indexer bug (withdrawals stored but not
applied to the position) makes the early-withdrawal test fail. That's the class of bug only
an end-to-end test sees, because the UI reads the chain directly and looks fine.

## All test layers

`../scripts/test-all.sh` runs everything:

| Layer | Where | Count | Tool |
|---|---|---|---|
| Frontend unit | `frontend/src/lib/__tests__` | 46 | Vitest |
| Server (indexer + API) | `server/test` | 30 | Vitest, real Postgres, real Hardhat chain |
| End-to-end | `e2e/tests` | 4 | Playwright |
| Mutation checks | `*/scripts/mutation-check.sh` | 6 + 5 planted bugs | |
