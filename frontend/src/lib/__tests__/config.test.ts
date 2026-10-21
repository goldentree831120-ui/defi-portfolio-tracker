import { describe, expect, test } from 'vitest'
import { CHAINS, parseConfig, txUrl } from '../config'

const ADDR = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'

describe('parseConfig', () => {
  test('valid config; the address is returned checksummed', () => {
    const r = parseConfig({ VITE_CHAIN_ID: '31337', VITE_STAKING_ADDRESS: ADDR })
    expect(r).toEqual({
      ok: true,
      config: { chain: CHAINS['31337'], stakingAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' },
    })
  })
  test('defaults to Sepolia', () => {
    const r = parseConfig({ VITE_STAKING_ADDRESS: ADDR })
    expect(r.ok && r.config.chain.name).toBe('Sepolia')
  })
  test('lists every problem at once', () => {
    const r = parseConfig({ VITE_CHAIN_ID: '1', VITE_STAKING_ADDRESS: '0x123' })
    expect(r).toEqual({
      ok: false,
      errors: [
        'VITE_CHAIN_ID=1 is not supported. Use one of: 31337, 11155111.',
        'VITE_STAKING_ADDRESS=0x123 is not a valid address.',
      ],
    })
  })
  test('missing address', () => {
    expect(parseConfig({ VITE_CHAIN_ID: '11155111' })).toEqual({ ok: false, errors: ['VITE_STAKING_ADDRESS is not set.'] })
  })
  test('the only RPC URLs in the front end are public ones, with no API key', () => {
    for (const c of Object.values(CHAINS)) expect(c.rpcUrl).not.toMatch(/alchemy|infura|key=|\/v2\/[A-Za-z0-9_-]{20,}/i)
  })
})

describe('explorer links', () => {
  test('Sepolia links to Etherscan; the local chain has none', () => {
    expect(txUrl(CHAINS['11155111'], '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc')
    expect(txUrl(CHAINS['31337'], '0xabc')).toBeNull()
  })
})
