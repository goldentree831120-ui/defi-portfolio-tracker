import { Contract, type ContractRunner, type Provider } from 'ethers'
import { ERC20_ABI, STAKING_ABI } from './abi'

export interface LockOption {
  index: number
  lockDuration: bigint // seconds
  rewardRateBps: bigint
}

export interface Position {
  id: number
  amount: bigint
  startTime: bigint
  lockDuration: bigint
  rewardRateBps: bigint
  lastClaimTime: bigint
  withdrawn: boolean
  /** startTime + lockDuration */
  unlockTime: bigint
  /** pendingRewards(user, id) read from the contract at `Snapshot.blockNumber`. 0 if withdrawn. */
  pending: bigint
}

export interface TokenInfo {
  address: string
  symbol: string
  decimals: number
}

/** Everything the dashboard shows, read at a single block so the numbers agree. */
export interface Snapshot {
  blockNumber: number
  blockTimestamp: bigint
  /** Wall-clock unix seconds when the block was read; used to keep chain time ticking (see chainNow). */
  fetchedAt: bigint
  token: TokenInfo
  walletBalance: bigint
  allowance: bigint
  lockOptions: LockOption[]
  positions: Position[]
}

/**
 * The contract decides locks and penalties by block.timestamp, not by the
 * user's clock. Estimate the chain's current time as the last block's
 * timestamp plus wall-clock time elapsed since we read it. This is also
 * correct when the local clock is wrong, or on a Hardhat node after
 * evm_increaseTime.
 */
export function chainNow(snapshot: Snapshot, wallNow: bigint): bigint {
  return snapshot.blockTimestamp + (wallNow - snapshot.fetchedAt)
}

/** Mirrors Staking.sol: 10% of principal if withdrawn before unlockTime. */
export const EARLY_EXIT_PENALTY_BPS = 1000n

export function earlyExitPenalty(p: Position, now: bigint): bigint {
  return now < p.unlockTime ? (p.amount * EARLY_EXIT_PENALTY_BPS) / 10_000n : 0n
}

export function isLocked(p: Position, now: bigint): boolean {
  return !p.withdrawn && now < p.unlockTime
}

export function totals(positions: Position[], now: bigint) {
  const open = positions.filter((p) => !p.withdrawn)
  const staked = open.reduce((s, p) => s + p.amount, 0n)
  const pending = open.reduce((s, p) => s + p.pending, 0n)
  const locked = open.filter((p) => isLocked(p, now))
  const nextUnlock = locked.length ? locked.reduce((m, p) => (p.unlockTime < m ? p.unlockTime : m), locked[0].unlockTime) : null
  return { staked, pending, openCount: open.length, nextUnlock }
}

export function stakingContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, STAKING_ABI, runner)
}

export function tokenContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, ERC20_ABI, runner)
}

/** Token metadata never changes, so it is read once per session. */
export async function readTokenInfo(provider: Provider, stakingAddress: string): Promise<TokenInfo> {
  const staking = stakingContract(stakingAddress, provider)
  const address: string = await staking.stakingToken()
  const token = tokenContract(address, provider)
  const [symbol, decimals] = await Promise.all([token.symbol() as Promise<string>, token.decimals() as Promise<bigint>])
  return { address, symbol, decimals: Number(decimals) }
}

export async function readLockOptions(provider: Provider, stakingAddress: string): Promise<LockOption[]> {
  const staking = stakingContract(stakingAddress, provider)
  const count = Number(await staking.lockOptionsCount())
  const raw = await Promise.all(Array.from({ length: count }, (_, i) => staking.lockOptions(i)))
  return raw.map((r, i) => ({ index: i, lockDuration: r.lockDuration as bigint, rewardRateBps: r.rewardRateBps as bigint }))
}

/**
 * Read balances and positions, all pinned to the same block (`blockTag`) so a
 * block landing mid-refresh cannot produce a half-old, half-new screen.
 */
export async function readSnapshot(
  provider: Provider,
  stakingAddress: string,
  account: string,
  token: TokenInfo,
  lockOptions: LockOption[],
): Promise<Snapshot> {
  const block = await provider.getBlock('latest')
  if (!block) throw new Error('Could not read the latest block.')
  const blockTag = block.number
  const staking = stakingContract(stakingAddress, provider)
  const erc20 = tokenContract(token.address, provider)

  const [walletBalance, allowance, rawPositions] = await Promise.all([
    erc20.balanceOf(account, { blockTag }) as Promise<bigint>,
    erc20.allowance(account, stakingAddress, { blockTag }) as Promise<bigint>,
    staking.positionsOf(account, { blockTag }) as Promise<Array<Record<string, unknown>>>,
  ])

  const positions: Position[] = await Promise.all(
    rawPositions.map(async (r, id) => {
      const withdrawn = r.withdrawn as boolean
      const startTime = r.startTime as bigint
      const lockDuration = r.lockDuration as bigint
      const pending = withdrawn ? 0n : ((await staking.pendingRewards(account, id, { blockTag })) as bigint)
      return {
        id,
        amount: r.amount as bigint,
        startTime,
        lockDuration,
        rewardRateBps: r.rewardRateBps as bigint,
        lastClaimTime: r.lastClaimTime as bigint,
        withdrawn,
        unlockTime: startTime + lockDuration,
        pending,
      }
    }),
  )

  return {
    blockNumber: block.number,
    blockTimestamp: BigInt(block.timestamp),
    fetchedAt: BigInt(Math.floor(Date.now() / 1000)),
    token,
    walletBalance,
    allowance,
    lockOptions,
    positions,
  }
}
