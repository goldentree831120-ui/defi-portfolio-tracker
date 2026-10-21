import { Interface, isError } from 'ethers'
import { OZ_ERRORS } from './abi'

/**
 * ethers decodes require("...") strings by itself, but on a *send* it does not
 * decode custom errors with the contract's ABI (it only does that for
 * staticCall). So custom errors are decoded here from the raw revert data.
 */
const KNOWN_ERRORS = new Interface(OZ_ERRORS)

function revertKey(e: { reason: string | null; revert: { name: string } | null; data: string | null }): string | undefined {
  if (e.reason) return e.reason // require("...") message
  if (e.revert && e.revert.name !== 'Error' && e.revert.name !== 'Panic') return e.revert.name
  if (e.data) {
    try {
      return KNOWN_ERRORS.parseError(e.data)?.name
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Every failure the UI can show is turned into one of these. The `kind` drives
 * behaviour (e.g. a rejected signature is not shown as red), `message` is what
 * the user reads, and `detail` is the raw technical text for the curious.
 */
export type AppErrorKind =
  | 'user-rejected' // user pressed Reject in MetaMask
  | 'request-pending' // MetaMask already has an open prompt
  | 'wrong-network'
  | 'no-wallet'
  | 'insufficient-gas' // not enough ETH to pay gas
  | 'reverted' // the contract said no
  | 'replaced' // tx was cancelled / replaced in the wallet
  | 'network' // RPC unreachable, timeout
  | 'invalid-input'
  | 'unknown'

export interface AppError {
  kind: AppErrorKind
  message: string
  detail?: string
}

export class WrongNetworkError extends Error {
  readonly expected: string
  constructor(expected: string) {
    super(`Switch MetaMask to ${expected} to continue.`)
    this.expected = expected
  }
}

export class InputError extends Error {}

/** Revert reasons and custom errors from Staking.sol / OpenZeppelin, in plain words. */
const REVERT_MESSAGES: Record<string, string> = {
  'amount must be > 0': 'Enter an amount greater than zero.',
  'invalid lock option': 'That lock period does not exist on this contract.',
  'no rewards accrued': 'This position has no rewards to claim yet.',
  'already withdrawn': 'This position has already been withdrawn.',
  'empty position': 'This position is empty.',
  ERC20InsufficientBalance:
    'Not enough tokens. If this happened on withdraw or claim, the staking contract’s reward pool may be empty.',
  ERC20InsufficientAllowance: 'The approval is lower than the amount. Approve again, then stake.',
  SafeERC20FailedOperation: 'The token transfer failed.',
  ReentrancyGuardReentrantCall: 'The contract blocked a re-entrant call.',
  OwnableUnauthorizedAccount: 'Only the contract owner can do that.',
}

/** EIP-1193 / MetaMask error codes, which can appear raw or nested inside an ethers error. */
function rpcCode(e: unknown): number | undefined {
  const seen = new Set<unknown>()
  let cur: unknown = e
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const c = (cur as { code?: unknown }).code
    if (typeof c === 'number') return c
    cur = (cur as { error?: unknown; info?: { error?: unknown } }).error ?? (cur as { info?: { error?: unknown } }).info?.error
  }
  return undefined
}

function shortMessage(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const o = e as { shortMessage?: unknown; message?: unknown }
    if (typeof o.shortMessage === 'string') return o.shortMessage
    if (typeof o.message === 'string') return o.message
  }
  return typeof e === 'string' ? e : undefined
}

/** Pure: turn anything thrown by ethers / MetaMask / our own guards into an AppError. */
export function classifyError(e: unknown): AppError {
  if (e instanceof WrongNetworkError) return { kind: 'wrong-network', message: e.message }
  if (e instanceof InputError) return { kind: 'invalid-input', message: e.message }

  const detail = shortMessage(e)

  if (isError(e, 'ACTION_REJECTED') || rpcCode(e) === 4001) {
    return { kind: 'user-rejected', message: 'You rejected the request in MetaMask. Nothing was sent.' }
  }
  if (rpcCode(e) === -32002) {
    return {
      kind: 'request-pending',
      message: 'MetaMask already has a request waiting. Open the extension to approve or reject it.',
    }
  }
  if (isError(e, 'INSUFFICIENT_FUNDS')) {
    return {
      kind: 'insufficient-gas',
      message: 'Not enough ETH to pay for gas. Get Sepolia ETH from a faucet and try again.',
      detail,
    }
  }
  if (isError(e, 'TRANSACTION_REPLACED')) {
    return {
      kind: 'replaced',
      message: e.cancelled
        ? 'The transaction was cancelled or replaced in your wallet.'
        : 'The transaction was sped up and replaced.',
      detail,
    }
  }
  if (isError(e, 'CALL_EXCEPTION')) {
    const key = revertKey(e)
    const known = key ? REVERT_MESSAGES[key] : undefined
    return {
      kind: 'reverted',
      message: known ?? (key ? `The contract rejected the transaction: ${key}.` : 'The contract rejected the transaction.'),
      detail,
    }
  }
  if (isError(e, 'NETWORK_ERROR') || isError(e, 'TIMEOUT') || isError(e, 'SERVER_ERROR')) {
    return { kind: 'network', message: 'Could not reach the network. Check your connection and try again.', detail }
  }
  return { kind: 'unknown', message: detail ?? 'Something went wrong.', detail }
}
