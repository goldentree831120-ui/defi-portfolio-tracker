# DeFi Portfolio Tracker

A full-stack Web3 project built around a **Java backend**, not just Solidity + React — the angle that
differentiates a Java/fullstack background from the flood of JS-only Web3 portfolios.

**What it does:** reads a wallet's ERC-20 token balance and staking positions directly from an Ethereum
testnet via [Web3j](https://github.com/web3j/web3j) (Java's equivalent of ethers.js), caches snapshots in
Postgres/H2, and serves them over a REST API with a small dashboard on top.

```
contracts/   Solidity: TrackerToken (ERC-20) + Staking (tiered-APY staking pool). Hardhat + tests.
backend/     Spring Boot + Web3j: reads on-chain state, caches it, exposes REST endpoints.
             Static dashboard lives at backend/src/main/resources/static/index.html.
```

## Why this project (and not just "another staking dApp")

A staking contract with a React frontend is common. Putting a **real backend service** in front of chain
data — one that caches state, polls on a schedule, and serves a clean API instead of hitting an RPC
node from the browser on every click — is the pattern real protocol/wallet/exchange backend teams
actually hire for. It's also a legitimate way to make a Java background an asset instead of something to
work around.

## 1. Contracts

```bash
cd contracts
npm install
cp .env.example .env        # fill in SEPOLIA_RPC_URL + PRIVATE_KEY (see below)
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network sepolia
```

- **`TrackerToken.sol`** — plain OpenZeppelin ERC-20, 1,000,000 initial supply.
- **`Staking.sol`** — tiered-APY staking (30-day/5%, 90-day/12%, 180-day/25%), with a 10% early-exit
  penalty for withdrawing before the lock expires and a `ReentrancyGuard` on every state-changing call.
  This is the "stretch feature" version of a plain stake/unstake contract — worth being able to explain
  the reward-math and penalty logic in an interview.
- Tests cover: reward accrual over time, the early-exit penalty, full principal return after unlock,
  and two revert paths (invalid lock tier, double withdrawal).

**Getting a free RPC URL:** sign up at [alchemy.com](https://alchemy.com) or [infura.io](https://infura.io),
create a Sepolia app, copy the HTTPS URL. **Private key:** export it from a *throwaway* MetaMask wallet
(Account details → Show private key) funded with free Sepolia ETH from a faucet like
[sepoliafaucet.com](https://sepoliafaucet.com) — never use a wallet holding real funds.

> **Note on this sandbox:** `npx hardhat compile` normally downloads the Solidity compiler from
> `binaries.soliditylang.org`. This sandboxed session's network policy blocks that host, so the
> contracts here were compiled with `node local-compile.js` (uses the `solc` npm package directly) and
> tested with `npx hardhat test --no-compile`. On your own machine or in GitHub Actions, `npx hardhat
> compile` will work normally — `local-compile.js` isn't needed there, it's just how this was verified
> in this environment. All 5 tests pass.

## 2. Backend

```bash
cd backend
# after deploying contracts, export the two addresses deploy.js prints:
export WEB3_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
export TOKEN_ADDRESS=0x...
export STAKING_ADDRESS=0x...
export WATCHED_WALLETS=0xYourTestWallet
mvn spring-boot:run
```

Then open `http://localhost:8080`.

**Endpoints:**

| Method | Path | What it does |
|---|---|---|
| GET | `/api/wallets/{address}` | Latest cached snapshot (fast — reads the DB) |
| POST | `/api/wallets/{address}/refresh` | Forces a live read from the chain, stores a new snapshot |
| GET | `/api/wallets/{address}/history?limit=30` | Snapshot history for a "value over time" chart |

**How the Web3j layer works:** `ChainReaderService` encodes and decodes contract calls by hand with
`FunctionEncoder`/`FunctionReturnDecoder` instead of using a generated contract wrapper (Web3j can
generate one from an ABI via `web3j generate solidity`, but that's an extra build step). Reading a
staking position uses the compiler's auto-generated flat getter for the `positions` mapping
(`positions(address,uint256)` → six scalars) rather than decoding a dynamic array of structs, which is
worth doing deliberately and simply rather than fighting ABI edge cases for a demo project.

`SnapshotPollingService` refreshes every watched wallet on a schedule (`web3.poll-interval-ms`,
default 60s) so the API almost never has to make a live RPC call. Real production systems more often
listen to contract *events* instead of polling every wallet — that's a natural "what would you do
differently at scale" answer to have ready.

Defaults to an in-memory H2 database (zero setup). To use Postgres instead, uncomment the Postgres
block in `application.yml` and point it at a local instance.

> **Note on this sandbox:** this session's network policy also blocks Maven Central
> (`repo.maven.apache.org`), so `mvn compile` couldn't be run to verify the backend here. The code was
> written and reviewed carefully, but **build it once on your own machine** (`mvn spring-boot:run`)
> before relying on it — normal machines and CI have unrestricted access to Maven Central.

## 3. Frontend

A single dependency-free HTML/JS dashboard at `backend/src/main/resources/static/index.html`, served
by Spring Boot itself — no separate build step. Enter a wallet address, hit "Load" (reads the cache) or
"Force refresh" (reads the chain live), see balance, staked total, pending rewards, and a table of
individual positions with their lock/APY/status.

## Suggested next steps if you want to go further

- Swap polling for event-driven updates: subscribe to `Staked`/`Withdrawn`/`RewardsClaimed` logs with
  Web3j's `web3j.ethLogFlowable(...)` and update snapshots reactively instead of on a timer.
- Add a second protocol (e.g. track balances across two staking contracts) to show the backend
  generalizes beyond one integration.
- Deploy the backend somewhere public (Railway/Render free tier) so the link in your resume is live.
