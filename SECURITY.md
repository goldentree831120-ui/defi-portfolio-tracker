# Security

Security review of the staking contracts (`contracts/contracts/Staking.sol`,
`TrackerToken.sol`). Everything lives in [`security/staking/`](security/staking/):
the threat model (`THREAT_MODEL.md`), the Slither triage (`SLITHER_TRIAGE.md`), Foundry attack
tests (`test/StakingAttacks.t.sol`) and a fixed version (`src/StakingFixed.sol`). The tests
import the repo's real contracts from `contracts/contracts/`, so they test the code that is
deployed, not a copy.

Testnet project (Sepolia); no real funds.

## Summary

| ID | Severity | Issue | Status |
|---|---|---|---|
| F1 | High | Rewards are paid from the same balance as principal, so rewards beyond the funded pool come out of other stakers' deposits | Fixed in `StakingFixed.sol`; the deployed contract is unchanged |
| F1b | High | With an empty reward pool, `withdraw` reverts entirely, so a staker can't recover their own principal | Fixed in `StakingFixed.sol` |
| F2 | Medium | Rewards keep accruing after the lock ends, so a 180-day lock becomes a flexible 25% account after day 180 | Fixed in `StakingFixed.sol` |
| OPS-1 | Critical (operational) | An early commit had a testnet deployer private key in `contracts/.env.example`. Whoever holds the TRK owner key can mint TRK and, via F1, drain every staker (`test_ownerKeyHolder_drainsAllPrincipal_original_succeeds`) | **Resolved:** history rewritten, contracts redeployed from a fresh wallet, old key and contracts abandoned, secret scan in CI |

Defences that held: reentrancy (`nonReentrant` on every state-changing function, tested with a
token that calls back), early-exit penalty, double withdrawal, per-user position isolation,
`onlyOwner` funding.

## Known limitations

- The Sepolia deployment is the original contract, and a deployed contract can't be patched.
  F1, F1b and F2 apply to it; using the fixes needs a new deployment of `StakingFixed.sol`.
- The owner can mint unlimited TRK. Renouncing ownership after distribution would fix supply.
- An under-funded pool pays less than the advertised APY (the fixed version emits
  `RewardShortfall` when that happens).
- Slither didn't find F1, F1b or F2; the tests did. No audit, no formal verification.

## Run the checks

```bash
cd contracts && npm ci && cd ..          # OpenZeppelin, used by both contracts
cd security/staking && forge test && cd ../..   # 15 tests, including a 1,000-run fuzz test
# Slither from the repository root (solc 0.8.26 needed):
slither contracts/contracts/Staking.sol --compile-force-framework solc \
  --solc-remaps "@openzeppelin/contracts/=contracts/node_modules/@openzeppelin/contracts/" \
  --exclude-dependencies
```

CI runs both on every push ([`.github/workflows/security.yml`](.github/workflows/security.yml)).

## Reporting

This is a portfolio project on testnet. Report issues by opening a GitHub issue.
