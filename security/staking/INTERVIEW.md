# Using this review on a resume and in interviews

Only claims the tests in `security/staking/test/StakingAttacks.t.sol` actually show.

## Resume bullet

- Security-reviewed my own Solidity staking contract (threat model, Slither, Foundry attack
  tests): found that rewards were paid from other stakers' principal (staker funds at risk),
  proved it with 3 exploit tests including a whale or owner-key drain, fixed it with separate
  principal/reward accounting, and verified the fix with a 1,000-run fuzz test.

Shorter variant: *Found and fixed a principal-drain bug in my own staking contract that Slither
missed; 15 Foundry attack tests (exploits on original, failures on fix).*

## 60-second explanation

"My staking contract pays rewards by APY tier, and I reviewed it the way an auditor would. I
wrote a threat model, ran Slither, then wrote Foundry tests that attack it. Slither only found
low-severity timestamp notes. The real bug was in the accounting: principal, rewards and
penalties all sat in one token balance with nothing tracking which was which. So any reward
beyond what the owner funded was quietly paid out of other people's deposits. I wrote a test
where Alice withdraws a year of 25% rewards from an unfunded pool, and Bob then can't withdraw
his own money. A second test showed that with an empty pool, even a single staker can't get
their principal back, because the contract pays the reward first and the whole call reverts.
I also showed a whale, or anyone with the owner key, could size a stake so its reward equals
everyone else's deposits and drain them. The fix tracks total staked and a reward reserve
separately, pays rewards only from the reserve, and stops accrual at lock end. A fuzz test checks
that the balance always covers principal plus reserve. The takeaway: static analysis finds code
smells, but economic bugs need invariants and tests written against what the contract is supposed
to guarantee."

## Likely follow-up questions

- *Why didn't Slither catch it?* It matches code patterns; this is a missing invariant, not a pattern.
- *Why not just require the pool be funded?* Obligations grow with time and are unbounded; funding
  can never be "enough" without either capping accrual or paying only from a tracked reserve.
- *Why pay principal even when rewards fall short?* Principal is the user's money; a reward
  shortfall is a broken promise, but losing principal is theft from the other stakers.
- *Is the Sepolia contract fixed?* No. Contracts are immutable; it needs a redeploy from a new key.
