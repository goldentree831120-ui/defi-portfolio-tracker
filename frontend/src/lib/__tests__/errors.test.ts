import { describe, expect, test } from 'vitest'
import { Interface, makeError } from 'ethers'
import { classifyError, InputError, WrongNetworkError } from '../errors'
import { OZ_ERRORS } from '../abi'

const oz = new Interface(OZ_ERRORS)
const STAKING = '0x00000000000000000000000000000000000000aa'

/** An ethers CALL_EXCEPTION as a failed send produces it. */
function callException(fields: { reason?: string | null; data?: string | null; revert?: { name: string } | null }) {
  return makeError('execution reverted', 'CALL_EXCEPTION', {
    action: 'estimateGas',
    data: fields.data ?? null,
    reason: fields.reason ?? null,
    revert: fields.revert ?? null,
    transaction: { to: STAKING, data: '0x' },
    invocation: null,
  } as never)
}

describe('classifyError', () => {
  test('our own guards keep their kind and message', () => {
    expect(classifyError(new WrongNetworkError('Sepolia'))).toEqual({
      kind: 'wrong-network',
      message: 'Switch MetaMask to Sepolia to continue.',
    })
    expect(classifyError(new InputError('Enter an amount.'))).toEqual({ kind: 'invalid-input', message: 'Enter an amount.' })
  })

  test('user rejection: ethers ACTION_REJECTED, raw 4001, and 4001 nested inside an ethers error', () => {
    const viaEthers = makeError('user rejected action', 'ACTION_REJECTED', { action: 'sendTransaction', reason: 'rejected' })
    const raw = Object.assign(new Error('User denied transaction signature.'), { code: 4001 })
    const nested = makeError('could not coalesce error', 'UNKNOWN_ERROR', { error: { code: 4001, message: 'denied' } })
    for (const e of [viaEthers, raw, nested]) expect(classifyError(e).kind).toBe('user-rejected')
  })

  test('MetaMask already has a prompt open (-32002)', () => {
    const e = Object.assign(new Error('Request already pending'), { code: -32002 })
    expect(classifyError(e).kind).toBe('request-pending')
  })

  test('not enough ETH for gas', () => {
    const e = makeError('insufficient funds', 'INSUFFICIENT_FUNDS', { transaction: {} } as never)
    const r = classifyError(e)
    expect(r.kind).toBe('insufficient-gas')
    expect(r.message).toMatch(/Not enough ETH/)
  })

  test('replaced vs cancelled transactions', () => {
    const base = { hash: '0x1', replacement: {} as never, receipt: {} as never, reason: 'repriced' as const }
    const cancelled = makeError('replaced', 'TRANSACTION_REPLACED', { ...base, reason: 'cancelled', cancelled: true })
    const repriced = makeError('replaced', 'TRANSACTION_REPLACED', { ...base, cancelled: false })
    expect(classifyError(cancelled).message).toMatch(/cancelled or replaced/)
    expect(classifyError(repriced).message).toMatch(/sped up/)
  })

  test('require() reason strings map to plain words', () => {
    const r = classifyError(callException({ reason: 'no rewards accrued' }))
    expect(r).toMatchObject({ kind: 'reverted', message: 'This position has no rewards to claim yet.' })
  })

  test('OpenZeppelin custom errors are decoded from raw revert data', () => {
    const data = oz.encodeErrorResult('ERC20InsufficientAllowance', [STAKING, 0n, 10n])
    const r = classifyError(callException({ data }))
    expect(r).toMatchObject({ kind: 'reverted', message: 'The approval is lower than the amount. Approve again, then stake.' })
  })

  test('a decoded custom error the UI has no text for still names the error', () => {
    const r = classifyError(callException({ revert: { name: 'SomethingNew' } }))
    expect(r.message).toBe('The contract rejected the transaction: SomethingNew.')
  })

  test('a revert with undecodable data is still a revert, not a crash', () => {
    const r = classifyError(callException({ data: '0xdeadbeef' }))
    expect(r).toMatchObject({ kind: 'reverted', message: 'The contract rejected the transaction.' })
  })

  test('network failures', () => {
    for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR'] as const) {
      const e = makeError('down', code, {} as never)
      expect(classifyError(e).kind).toBe('network')
    }
  })

  test('anything else is unknown but keeps its message', () => {
    expect(classifyError(new Error('boom'))).toEqual({ kind: 'unknown', message: 'boom', detail: 'boom' })
    expect(classifyError('plain string')).toMatchObject({ kind: 'unknown', message: 'plain string' })
    expect(classifyError(undefined)).toEqual({ kind: 'unknown', message: 'Something went wrong.', detail: undefined })
  })

  test('a cyclic error object does not hang the classifier', () => {
    const a: Record<string, unknown> = { message: 'cyclic' }
    a.error = a
    expect(classifyError(a).kind).toBe('unknown')
  })
})
