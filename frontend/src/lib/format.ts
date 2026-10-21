import { formatUnits, parseUnits } from 'ethers'
import { InputError } from './errors'

/** "1234.5678" with at most `maxFrac` decimals, thousands separators, no float rounding. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 4): string {
  const [whole, frac = ''] = formatUnits(value, decimals).split('.')
  const wholeFmt = BigInt(whole).toLocaleString('en-US')
  const fracTrim = frac.slice(0, maxFrac).replace(/0+$/, '')
  if (!fracTrim && value > 0n && BigInt(whole) === 0n) return `<0.${'0'.repeat(maxFrac - 1)}1`
  return fracTrim ? `${wholeFmt}.${fracTrim}` : wholeFmt
}

/** Parse what the user typed. Throws InputError with a readable message. */
export function parseAmount(input: string, decimals: number): bigint {
  const s = input.trim()
  if (!s) throw new InputError('Enter an amount.')
  if (!/^\d*\.?\d*$/.test(s) || s === '.') throw new InputError('Enter a number, like 100 or 12.5.')
  const frac = s.split('.')[1] ?? ''
  if (frac.length > decimals) throw new InputError(`Use at most ${decimals} decimal places.`)
  const v = parseUnits(s, decimals)
  if (v === 0n) throw new InputError('Enter an amount greater than zero.')
  return v
}

/** 2592000 -> "30 days" */
export function formatLockDuration(seconds: bigint): string {
  const days = Number(seconds) / 86400
  if (Number.isInteger(days)) return `${days} day${days === 1 ? '' : 's'}`
  return `${Math.round(Number(seconds) / 3600)} hours`
}

/** 1200 bps -> "12%" */
export function formatBps(bps: bigint): string {
  const pct = Number(bps) / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`
}

/** Seconds remaining -> "12d 4h", "3h 20m", "45s" */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(seconds)}s`
}

export function formatDate(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Full precision, no separators: what the Max button puts in the input so no dust is left. */
export function formatAmountExact(value: bigint, decimals: number): string {
  return formatUnits(value, decimals).replace(/\.0$/, '')
}
