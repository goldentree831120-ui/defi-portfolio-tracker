# Frontend (M1)

React + TypeScript (Vite) + ethers v6. Connects MetaMask, reads the `Staking`
contract and lets you stake, claim and withdraw on Sepolia.

```bash
cd frontend
cp .env.example .env     # defaults point at the Sepolia deployment
npm install
npm run dev              # http://localhost:5173
npm run build            # type-check + production build into dist/
npm run lint
```

## Configuration

| Variable | Meaning |
|---|---|
| `VITE_CHAIN_ID` | `11155111` (Sepolia) or `31337` (local Hardhat node) |
| `VITE_STAKING_ADDRESS` | The `Staking` contract. The token address is read from `stakingToken()` on-chain, so the two can never disagree. |

Everything prefixed `VITE_` is baked into the JavaScript bundle and is public.
No RPC key is needed: all reads and writes go through the user's MetaMask.

## Run against a local chain

```bash
# terminal 1
cd contracts && npx hardhat node
# terminal 2
cd contracts && npx hardhat run scripts/deploy.js --network localhost
# terminal 3 (use the Staking address deploy.js printed)
cd frontend && VITE_CHAIN_ID=31337 VITE_STAKING_ADDRESS=0x... npm run dev
```

In MetaMask, add the network `http://127.0.0.1:8545` (chain id 31337) and import
Hardhat account #0 (the deployer, which holds the TRK). Its key is printed by
`npx hardhat node` and is public: never use it anywhere else. After restarting
the node, use "Clear activity tab data" in MetaMask, or it will reuse stale nonces.

## Tests

```bash
npm test                  # 46 unit tests (Vitest): amounts, error messages, staking maths, config
npm run check:mutations   # plants 6 bugs in src/lib; every one must make a test fail
```

The unit tests cover the pure logic in `src/lib`: parsing and formatting token amounts
without float rounding, turning every MetaMask / ethers / contract error into a readable
message (including OpenZeppelin custom errors decoded from raw revert data), the early-exit
penalty and lock maths that mirror `Staking.sol`, and config validation. The UI itself is
tested end to end, through a real browser against a local chain and the real server, in
[`../e2e`](../e2e/README.md).

## How it is built

```
src/
  lib/config.ts        validate env vars; chain metadata for wallet_addEthereumChain
  lib/abi.ts           human-readable ABI fragments + OpenZeppelin custom errors
  lib/staking.ts       typed reads (one block-pinned snapshot), penalty / totals / chain-time helpers
  lib/errors.ts        classifyError(): any wallet / RPC / revert error -> { kind, message }
  lib/format.ts        bigint-safe amount formatting and input parsing
  hooks/useWallet.ts   connect, account / chain change listeners, switch or add Sepolia
  hooks/useStakingData.ts   read on connect and on every new block
  hooks/useTransactions.ts  awaiting-signature -> pending -> confirmed | failed
  components/          StakeForm, Positions, Activity
```

Design decisions worth knowing:

- **Amounts are `bigint` end to end.** `parseUnits` / `formatUnits` only; a `number`
  cannot hold 18-decimal token amounts exactly.
- **One snapshot per block.** Balance, allowance, positions and pending rewards are all
  read with the same `blockTag`, so the screen never mixes two blocks.
- **Chain time, not the laptop clock.** Lock countdowns and the early-exit warning use
  the last block's timestamp plus elapsed time, because the contract decides the
  penalty with `block.timestamp`.
- **Approve exactly the amount, not unlimited.** It costs one extra transaction per
  stake but an unlimited approval is a standing risk if the staking contract were
  ever compromised.
- **Reverts are caught before signing.** ethers runs `eth_estimateGas` before MetaMask
  opens, so a stake that would revert fails with a readable reason and costs no gas.
  ethers does not decode custom errors on sends, so `errors.ts` decodes
  `ERC20InsufficientAllowance` etc. from the raw revert data itself.
- **Wrong network is checked twice:** the UI pauses reads and writes when the wallet
  is on another chain, and every send re-checks the chain id at the moment of
  signing, in case the user switched in between.
- **Early withdraw needs a second click** that states the exact penalty and payout.

Error states handled: no wallet installed, connection rejected, a MetaMask
prompt already open, wrong network (switch, or add the chain if MetaMask
doesn't know it), signature rejected, not enough ETH for gas, contract revert
(require strings and OpenZeppelin custom errors), transaction mined but
reverted, transaction sped up or cancelled in MetaMask, RPC unreachable.
