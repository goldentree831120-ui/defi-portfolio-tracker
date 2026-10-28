# Threat model: Staking.sol + TrackerToken.sol

Scope: `contracts/contracts/Staking.sol` and `TrackerToken.sol` from defi-portfolio-tracker,
as deployed on Sepolia (Staking `0x707AbBCEd16c1872e08ba56d079eacE17960F8D6`, TRK
`0x5Db69118dB4652CBC39F027Fb28b6B5e8A9eE593`). Reviewed with OpenZeppelin 5.6.1 (the version in
`package.json`) and solc 0.8.26 (deployed with 0.8.24; no relevant semantic differences).
Out of scope: the Java backend, the frontend, the escrow contract (reviewed separately).

## Assets

| Asset | Held where | Notes |
|---|---|---|
| Stakers' principal | Staking contract TRK balance | The thing that must never be lost |
| Reward pool | Same TRK balance (not tracked separately) | Funded by owner via `fundRewardPool`; 200,000 TRK on Sepolia |
| Early-exit penalties | Same TRK balance | Kept by the contract, not tracked, not withdrawable |
| TRK supply integrity | TrackerToken | Owner can mint without limit |
| Owner key | Off-chain | Owns both contracts. **Currently published in `contracts/.env.example` on GitHub** |

## Actors and trust

| Actor | Can | Trusted? |
|---|---|---|
| Staker | stake, claim own rewards, withdraw own positions | No. Must not be able to take others' funds |
| Large staker | same, with a lot of TRK | No. Capital should not translate into other people's money |
| Owner | `fundRewardPool`; on TRK: `mint` | Trusted not to inflate TRK; cannot withdraw from Staking directly |
| Anyone holding the owner key | everything the owner can | Not trusted. An earlier deployer key was exposed; the contracts were redeployed from a fresh wallet (see OPS-1 in SECURITY.md) |
| Token contract | called by Staking | TRK is plain ERC-20 (no hooks); Staking takes any IERC20 at deploy |

Trust boundaries: user → Staking (per-user position arrays, `msg.sender` indexed);
Staking → token (`safeTransfer`/`safeTransferFrom`); owner key → both contracts.

## Attack paths

| # | Attack | Result on original | Evidence |
|---|---|---|---|
| A1 | **Rewards paid from other users' principal.** Rewards and principal share one balance with no accounting. Any reward beyond what was funded is paid out of someone else's deposit; the last stakers out can't withdraw. | **Works** (finding F1, high) | `test_F1_rewardsPaidFromPrincipal_original_succeeds`, `test_F1_fundedPoolStillInsolventOverTime_original_succeeds` |
| A2 | **Empty pool locks principal.** `withdraw` pays the reward before the principal; if the balance can't cover both, the whole call reverts, so even a lone staker can't get their own deposit back. | **Works** (finding F1b, high) | `test_F1b_emptyPoolLocksPrincipal_original_succeeds` |
| A3 | **Whale drain.** Stake a large amount in the 180-day tier sized so the reward equals everyone else's deposits, wait, withdraw. Consequence of F1. | **Works** | `test_ownerKeyHolder_drainsAllPrincipal_original_succeeds` |
| A4 | **Owner key holder.** Mint TRK for free (TrackerToken `mint`), then A3. Turns A3 from "needs capital" into "costs nothing". | **Works** | same test. An earlier deployer key was public (OPS-1); the current contracts were deployed from a fresh wallet |
| A5 | **Lock bypass after expiry.** A 180-day position keeps earning 25% APY forever while withdrawable at any time with no penalty. | **Works** (finding F2, medium) | `test_F2_rewardsAccrueForeverAfterUnlock_original_succeeds` |
| A6 | Reentrancy through a token with transfer hooks | Blocked by `nonReentrant` | `test_reentrancyThroughTokenHook_fails` |
| A7 | Withdraw early without paying the 10% penalty | Blocked | `test_earlyWithdrawCannotDodgePenalty_fails` |
| A8 | Withdraw twice / claim after withdraw | Blocked | `test_doubleWithdrawOrClaimAfterWithdraw_fails` |
| A9 | Withdraw someone else's position | Blocked: positions are indexed by `msg.sender` | `test_cannotWithdrawSomeoneElsesPosition_fails` |
| A10 | Non-owner funds or configures | Blocked: `onlyOwner`; nothing else is configurable | `test_onlyOwnerFundsPool_fails` |
| A11 | Front-running | No meaningful target: no prices, no shared rate, positions are independent | reasoning only |
| A12 | Rounding | Floor division under-pays dust; `claimRewards` requires reward > 0 so it can't be called to reset the clock for nothing | reasoning; Slither `timestamp` notes |
| A13 | Timestamp manipulation | A block producer can shift time by seconds; worst case is a few seconds of reward or penalty boundary | accepted |

## Findings and fixes

- **F1 / F1b (high): principal and rewards are not separated.** Fixed in
  `security/staking/src/StakingFixed.sol`: `totalStaked` and `rewardReserve` are tracked; rewards are paid
  only from `rewardReserve`; `withdraw` always returns principal and pays rewards up to what the
  reserve holds (logging any shortfall); penalties go into the reserve. Fuzz test
  `testFuzz_fixed_principalAlwaysCovered` checks balance >= totalStaked + rewardReserve and that the
  second staker can always withdraw.
- **F2 (medium): rewards never stop.** Fixed: accrual stops at `startTime + lockDuration`.
- **Operational (critical, not a code bug): an owner private key was public.** Resolved: the
  contracts were redeployed from a fresh wallet used for nothing else, the exposed key is retired,
  and the repository now holds only placeholders. Remaining advice: consider `renounceOwnership()`
  on TRK after initial distribution so supply is fixed.

## Residual risks

- Owner can still inflate TRK supply (devaluing everyone's position) unless ownership is renounced.
- With the fix, an under-funded pool means stakers get less reward than the APY advertises.
  That is now visible (`RewardShortfall` event), not silently paid from principal.
- The deployed Sepolia contract is immutable: the fix only applies to a new deployment.
