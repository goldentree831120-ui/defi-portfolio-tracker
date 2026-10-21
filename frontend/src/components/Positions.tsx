import { useState } from 'react'
import { formatAmount, formatBps, formatCountdown, formatDate, formatLockDuration } from '../lib/format'
import { earlyExitPenalty, isLocked, type Position, type Snapshot } from '../lib/staking'

interface Props {
  snapshot: Snapshot
  now: bigint
  disabled: boolean
  onClaim(p: Position): Promise<boolean>
  onWithdraw(p: Position): Promise<boolean>
}

export function Positions({ snapshot, now, disabled, onClaim, onWithdraw }: Props) {
  const open = snapshot.positions.filter((p) => !p.withdrawn).reverse()
  const closed = snapshot.positions.filter((p) => p.withdrawn).reverse()

  return (
    <section className="positions" aria-labelledby="positions-h">
      <h2 id="positions-h">Your positions</h2>
      {open.length === 0 ? (
        <p className="empty">No open positions. Stake {snapshot.token.symbol} to start earning.</p>
      ) : (
        <ul>
          {open.map((p) => (
            <PositionRow key={p.id} p={p} snapshot={snapshot} now={now} disabled={disabled} onClaim={onClaim} onWithdraw={onWithdraw} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="closed">
          <summary>Withdrawn positions ({closed.length})</summary>
          <ul>
            {closed.map((p) => (
              <li key={p.id}>
                Position {p.id}: {formatAmount(p.amount, snapshot.token.decimals)} {snapshot.token.symbol}, {formatLockDuration(p.lockDuration)} lock,
                staked {formatDate(p.startTime)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function PositionRow({ p, snapshot, now, disabled, onClaim, onWithdraw }: { p: Position } & Omit<Props, 'onClaim' | 'onWithdraw'> & Pick<Props, 'onClaim' | 'onWithdraw'>) {
  const { symbol, decimals } = snapshot.token
  const [confirming, setConfirming] = useState(false)
  const locked = isLocked(p, now)
  const penalty = earlyExitPenalty(p, now)
  const elapsed = now - p.startTime
  const progress = p.lockDuration === 0n ? 100 : Math.min(100, Number((elapsed * 10_000n) / p.lockDuration) / 100)
  const tier = snapshot.lockOptions.findIndex((o) => o.lockDuration === p.lockDuration)

  const withdraw = async () => {
    if (locked && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    await onWithdraw(p)
  }

  return (
    <li className={`position tier-${tier}`}>
      <div className="pos-main">
        <p className="pos-amount">
          {formatAmount(p.amount, decimals)} <span>{symbol}</span>
        </p>
        <p className="pos-terms">
          {formatLockDuration(p.lockDuration)} lock at {formatBps(p.rewardRateBps)} APY
        </p>
      </div>

      <div className="pos-lock">
        <div
          className="lockbar"
          role="progressbar"
          aria-label={`Lock progress for position ${p.id}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
        <p>
          {locked ? (
            <>
              Unlocks {formatDate(p.unlockTime)}, in {formatCountdown(Number(p.unlockTime - now))}
            </>
          ) : (
            <>Unlocked since {formatDate(p.unlockTime)}</>
          )}
        </p>
      </div>

      <div className="pos-rewards">
        <p className="pos-pending">
          {formatAmount(p.pending, decimals, 6)} <span>{symbol}</span>
        </p>
        <p className="pos-terms">rewards accrued</p>
      </div>

      <div className="pos-actions">
        <button type="button" onClick={() => onClaim(p)} disabled={disabled || p.pending === 0n}>
          Claim rewards
        </button>
        <button type="button" className={locked ? 'warn' : ''} onClick={withdraw} disabled={disabled}>
          {locked ? 'Withdraw early' : 'Withdraw'}
        </button>
      </div>

      {confirming && (
        <div className="confirm" role="alertdialog" aria-labelledby={`confirm-${p.id}`}>
          <p id={`confirm-${p.id}`}>
            This position is locked for another {formatCountdown(Number(p.unlockTime - now))}. Withdrawing now keeps a 10% penalty of{' '}
            <strong>
              {formatAmount(penalty, decimals)} {symbol}
            </strong>{' '}
            in the pool. You receive {formatAmount(p.amount - penalty, decimals)} {symbol} plus {formatAmount(p.pending, decimals, 6)} {symbol} in rewards.
          </p>
          <div>
            <button type="button" className="warn" onClick={withdraw} disabled={disabled}>
              Withdraw and pay penalty
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep staking
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
