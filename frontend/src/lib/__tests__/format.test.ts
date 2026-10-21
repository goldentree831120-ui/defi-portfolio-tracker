import { describe, expect, test } from 'vitest'
import { parseEther } from 'ethers'
import {
  formatAmount,
  formatAmountExact,
  formatBps,
  formatCountdown,
  formatLockDuration,
  parseAmount,
  shortAddress,
} from '../format'
import { InputError } from '../errors'

describe('formatAmount', () => {
  test('thousands separators and at most 4 decimals, truncated not rounded', () => {
    expect(formatAmount(parseEther('1234567.123456'), 18)).toBe('1,234,567.1234')
    expect(formatAmount(parseEther('0.99999'), 18)).toBe('0.9999')
  })
  test('drops trailing zeros and a bare decimal point', () => {
    expect(formatAmount(parseEther('100'), 18)).toBe('100')
    expect(formatAmount(parseEther('2.5'), 18)).toBe('2.5')
    expect(formatAmount(0n, 18)).toBe('0')
  })
  test('dust below the shown precision is not displayed as 0', () => {
    expect(formatAmount(1n, 18)).toBe('<0.0001')
    expect(formatAmount(parseEther('0.00001'), 18, 2)).toBe('<0.01')
  })
  test('works for non-18-decimal tokens', () => {
    expect(formatAmount(1_500_000n, 6)).toBe('1.5')
  })
})

describe('parseAmount', () => {
  test('parses decimals exactly into base units', () => {
    expect(parseAmount('12.5', 18)).toBe(parseEther('12.5'))
    expect(parseAmount(' 100 ', 18)).toBe(parseEther('100'))
    expect(parseAmount('.5', 18)).toBe(parseEther('0.5'))
    expect(parseAmount('0.000000000000000001', 18)).toBe(1n)
  })
  test.each([
    ['', 'Enter an amount.'],
    ['   ', 'Enter an amount.'],
    ['abc', 'Enter a number, like 100 or 12.5.'],
    ['1.2.3', 'Enter a number, like 100 or 12.5.'],
    ['-5', 'Enter a number, like 100 or 12.5.'],
    ['1e18', 'Enter a number, like 100 or 12.5.'],
    ['.', 'Enter a number, like 100 or 12.5.'],
    ['0', 'Enter an amount greater than zero.'],
    ['0.000', 'Enter an amount greater than zero.'],
    ['1.1234567', 'Use at most 6 decimal places.'],
  ])('rejects %j with a readable message', (input, message) => {
    const decimals = message.includes('6 decimal') ? 6 : 18
    expect(() => parseAmount(input, decimals)).toThrow(InputError)
    expect(() => parseAmount(input, decimals)).toThrow(message)
  })
  test('round-trips with formatAmountExact (the Max button leaves no dust)', () => {
    const balance = 123_456_789_012_345_678_901n
    expect(parseAmount(formatAmountExact(balance, 18), 18)).toBe(balance)
    expect(formatAmountExact(parseEther('5'), 18)).toBe('5')
  })
})

describe('durations, rates, addresses', () => {
  test('lock durations in days, hours otherwise', () => {
    expect(formatLockDuration(2_592_000n)).toBe('30 days')
    expect(formatLockDuration(86_400n)).toBe('1 day')
    expect(formatLockDuration(7_200n)).toBe('2 hours')
  })
  test('basis points as percent', () => {
    expect(formatBps(500n)).toBe('5%')
    expect(formatBps(2500n)).toBe('25%')
    expect(formatBps(1234n)).toBe('12.34%')
  })
  test('countdown picks the two largest useful units', () => {
    expect(formatCountdown(0)).toBe('now')
    expect(formatCountdown(-5)).toBe('now')
    expect(formatCountdown(45)).toBe('45s')
    expect(formatCountdown(20 * 60)).toBe('20m')
    expect(formatCountdown(3 * 3600 + 20 * 60)).toBe('3h 20m')
    expect(formatCountdown(12 * 86400 + 4 * 3600 + 59)).toBe('12d 4h')
  })
  test('short address', () => {
    expect(shortAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe('0x7099…79C8')
  })
})
