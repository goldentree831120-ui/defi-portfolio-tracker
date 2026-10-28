# Slither triage

Slither 0.11.x (report generated with 0.11.6; CI uses 0.11.3), `--exclude-dependencies`. Raw output in `reports/`.

```bash
# from the repository root, after `cd contracts && npm ci`
slither contracts/contracts/Staking.sol --compile-force-framework solc --solc solc-0.8.26 \
  --solc-remaps "@openzeppelin/contracts/=contracts/node_modules/@openzeppelin/contracts/" --exclude-dependencies
```

| Contract | Results | High | Medium | Low | Informational |
|---|---|---|---|---|---|
| Staking (original) | 20 | 0 | 0 | 2 (timestamp) | 18 |
| TrackerToken | 8 | 0 | 0 | 0 | 8 |
| StakingFixed | 21 | 0 | 0 | 3 (timestamp) | 18 |

## Each finding

| Detector | Where | Decision | Reasoning |
|---|---|---|---|
| `timestamp` | `claimRewards`, `withdraw` (original); `pendingRewards` (fixed) | **Accepted** | The contract is about time: lock expiry and linear accrual must use `block.timestamp`. A producer can skew it by seconds, which moves rewards by a negligible amount and the lock boundary by seconds. Several flagged comparisons (`!p.withdrawn`, `p.amount > 0`) don't involve time at all; Slither flags every condition in a function that reads the timestamp. |
| `assembly` | OpenZeppelin `SafeERC20`, `StorageSlot` | **False positive** for this review | Audited library code, listed because it is inlined into the contract. |
| `pragma` | `^0.8.24` vs OZ's `^0.8.20` etc. | **Accepted** | Normal when using a library; everything compiles with one compiler version. Could pin `pragma solidity 0.8.24;` for the deployed contract. |
| `solc-version` | OZ's open pragmas | **False positive** | The listed bugs apply to old compilers the open ranges allow, not to 0.8.24/0.8.26, which is what is used. |
| `dead-code` | OZ `Context._msgData`, `ERC20._burn` | **False positive** | Unused library internals. |

## What Slither did NOT find

Slither reported **nothing** about the two real problems (F1: rewards paid from other users'
principal; F1b: empty pool locks principal; F2: rewards never stop). Those are accounting and
economic design flaws, not code patterns, so a pattern-based static analyser can't see them.
They were found by reading the contract against its intent and confirmed with Foundry tests
(`test/StakingAttacks.t.sol`). This is the main lesson of the review.

## CI gate

`.github/workflows/security.yml` runs Slither on both the deployed `Staking.sol` and
`StakingFixed.sol`, excluding only the detectors triaged above (`timestamp, assembly, pragma,
solc-version, dead-code`), with `--fail-low`. Both have 0 remaining findings, so any new finding
fails the build. Note what that gate can and can't do: it would not have caught F1, F1b or F2.
The Foundry tests are what protect those.

