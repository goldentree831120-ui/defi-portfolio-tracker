import { describe, expect, test } from 'vitest'
import { parseEther } from 'ethers'
import { chainNow, earlyExitPenalty, isLocked, totals, type Position, type Snapshot } from '../staking'

const DAY = 86_400n

function position(over: Partial<Position> & { id: number }): Position {
  const startTime = over.startTime ?? 1_000_000n
  const lockDuration = over.lockDuration ?? 30n * DAY
  return {
    amount: parseEther('100'),
    startTime,
    lockDuration,
    rewardRateBps: 500n,
    lastClaimTime: startTime,
    withdrawn: false,
    unlockTime: startTime + lockDuration,
    pending: 0n,
    ...over,
  }
}

describe('chainNow', () => {
  test('is the block time plus wall-clock time since it was read (not the local clock)', () => {
    const snap = { blockTimestamp: 2_000_000n, fetchedAt: 1_700_000_000n } as Snapshot
    expect(chainNow(snap, 1_700_000_000n)).toBe(2_000_000n)
    expect(chainNow(snap, 1_700_000_042n)).toBe(2_000_042n)
  })
})

describe('earlyExitPenalty mirrors Staking.sol (10% of principal before unlock)', () => {
  const p = position({ id: 0, amount: parseEther('250') })
  test('one second before unlock: 10%', () => {
    expect(earlyExitPenalty(p, p.unlockTime - 1n)).toBe(parseEther('25'))
  })
  test('at and after unlock: nothing (the contract uses block.timestamp < unlockTime)', () => {
    expect(earlyExitPenalty(p, p.unlockTime)).toBe(0n)
    expect(earlyExitPenalty(p, p.unlockTime + DAY)).toBe(0n)
  })
  test('rounds down like integer division on-chain', () => {
    expect(earlyExitPenalty(position({ id: 1, amount: 19n }), 0n)).toBe(1n)
  })
})

describe('isLocked', () => {
  const p = position({ id: 0 })
  test('locked until unlockTime, then not', () => {
    expect(isLocked(p, p.unlockTime - 1n)).toBe(true)
    expect(isLocked(p, p.unlockTime)).toBe(false)
  })
  test('a withdrawn position is never locked', () => {
    expect(isLocked({ ...p, withdrawn: true }, p.startTime)).toBe(false)
  })
})

describe('totals', () => {
  const now = 1_000_000n + 10n * DAY
  const a = position({ id: 0, amount: parseEther('100'), pending: parseEther('1'), lockDuration: 30n * DAY })
  const b = position({ id: 1, amount: parseEther('50'), pending: parseEther('2'), lockDuration: 90n * DAY })
  const matured = position({ id: 2, amount: parseEther('10'), pending: parseEther('0.5'), lockDuration: 5n * DAY })
  const gone = position({ id: 3, amount: parseEther('999'), pending: 0n, withdrawn: true })

  test('sums open positions only and finds the earliest unlock among locked ones', () => {
    expect(totals([a, b, matured, gone], now)).toEqual({
      staked: parseEther('160'),
      pending: parseEther('3.5'),
      openCount: 3,
      nextUnlock: a.unlockTime, // matured has already unlocked; b unlocks later
    })
  })
  test('no positions, or nothing locked', () => {
    expect(totals([], now)).toEqual({ staked: 0n, pending: 0n, openCount: 0, nextUnlock: null })
    expect(totals([matured], now).nextUnlock).toBeNull()
  })
})
