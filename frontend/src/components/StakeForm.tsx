import { useId, useMemo, useState } from 'react'
import { InputError } from '../lib/errors'
import { formatAmount, formatAmountExact, formatBps, formatLockDuration, parseAmount } from '../lib/format'
import type { Snapshot } from '../lib/staking'

const YEAR = 365n * 86400n

interface Props {
  snapshot: Snapshot
  disabled: boolean
  onApprove(amount: bigint): Promise<boolean>
  onStake(amount: bigint, optionIndex: number): Promise<boolean>
}

export function StakeForm({ snapshot, disabled, onApprove, onStake }: Props) {
  const { token, walletBalance, allowance, lockOptions } = snapshot
  const [input, setInput] = useState('')
  const [option, setOption] = useState(lockOptions.length > 1 ? 1 : 0)
  const [touched, setTouched] = useState(false)
  const amountId = useId()

  const parsed = useMemo((): { amount: bigint; error: null } | { amount: null; error: string } => {
    try {
      const amount = parseAmount(input, token.decimals)
      if (amount > walletBalance) return { amount: null, error: `You have ${formatAmount(walletBalance, token.decimals)} ${token.symbol}.` }
      return { amount, error: null }
    } catch (e) {
      return { amount: null, error: e instanceof InputError ? e.message : 'Invalid amount.' }
    }
  }, [input, token, walletBalance])

  const amount = parsed.amount
  const needsApproval = amount !== null && allowance < amount
  const selected = lockOptions[option]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (amount === null || disabled) return
    if (needsApproval) {
      await onApprove(amount) // the snapshot refresh after confirmation flips the button to "Stake"
    } else if (await onStake(amount, option)) {
      setInput('')
      setTouched(false)
    }
  }

  return (
    <form className="stake" onSubmit={submit} noValidate>
      <h2>Stake {token.symbol}</h2>

      <div className="field">
        <div className="field-row">
          <label htmlFor={amountId}>Amount</label>
          <button type="button" className="link" onClick={() => setInput(formatAmountExact(walletBalance, token.decimals))} disabled={walletBalance === 0n}>
            Max {formatAmount(walletBalance, token.decimals)}
          </button>
        </div>
        <div className="amount-input">
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && parsed.error !== null}
            aria-describedby={`${amountId}-err`}
          />
          <span>{token.symbol}</span>
        </div>
        <p id={`${amountId}-err`} className="field-error" role="alert">
          {touched && input !== '' ? parsed.error : walletBalance === 0n ? `This wallet holds no ${token.symbol}.` : ''}
        </p>
      </div>

      <fieldset className="tiers">
        <legend>Lock period</legend>
        {lockOptions.map((o) => (
          <label key={o.index} className={`tier tier-${o.index}`}>
            <input type="radio" name="tier" checked={option === o.index} onChange={() => setOption(o.index)} />
            <span className="tier-lock">{formatLockDuration(o.lockDuration)}</span>
            <span className="tier-apy">{formatBps(o.rewardRateBps)} APY</span>
          </label>
        ))}
      </fieldset>

      {amount !== null && selected && (
        <p className="estimate">
          Earns about{' '}
          <strong>
            {formatAmount((amount * selected.rewardRateBps * selected.lockDuration) / (10_000n * YEAR), token.decimals)} {token.symbol}
          </strong>{' '}
          over {formatLockDuration(selected.lockDuration)}. Withdrawing early costs 10% of the amount.
        </p>
      )}

      {needsApproval && (
        <ol className="steps" aria-label="Two transactions needed">
          <li className="current">Approve the staking contract to move {formatAmount(amount, token.decimals)} {token.symbol}</li>
          <li>Stake</li>
        </ol>
      )}

      <button type="submit" className="primary" disabled={disabled || amount === null}>
        {amount === null
          ? 'Stake'
          : needsApproval
            ? `Approve ${formatAmount(amount, token.decimals)} ${token.symbol}`
            : `Stake ${formatAmount(amount, token.decimals)} ${token.symbol}`}
      </button>
    </form>
  )
}

