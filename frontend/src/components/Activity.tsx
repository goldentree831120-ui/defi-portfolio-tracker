import type { TxEntry } from '../hooks/useTransactions'
import { txUrl, type ChainInfo } from '../lib/config'

const STATUS_TEXT: Record<TxEntry['status'], string> = {
  'awaiting-signature': 'Confirm in MetaMask',
  pending: 'Waiting for the block',
  confirmed: 'Confirmed',
  failed: 'Failed',
}

export function Activity({ txs, chain, onDismiss }: { txs: TxEntry[]; chain: ChainInfo; onDismiss(id: number): void }) {
  if (txs.length === 0) return null
  return (
    <section className="activity" aria-labelledby="activity-h">
      <h2 id="activity-h">Transactions</h2>
      {/* aria-live so screen readers hear "Confirmed" / "Failed" without moving focus */}
      <ul aria-live="polite">
        {txs.map((t) => {
          const url = t.hash ? txUrl(chain, t.hash) : null
          const quiet = t.error?.kind === 'user-rejected'
          return (
            <li key={t.id} className={`tx tx-${t.status}${quiet ? ' tx-quiet' : ''}`}>
              <span className="tx-dot" aria-hidden="true" />
              <div>
                <p className="tx-label">{t.label}</p>
                <p className="tx-status">
                  {quiet ? 'Rejected in MetaMask' : STATUS_TEXT[t.status]}
                  {url && (
                    <>
                      {' '}
                      <a href={url} target="_blank" rel="noreferrer">
                        View on Etherscan
                      </a>
                    </>
                  )}
                  {!url && t.hash && <code> {t.hash.slice(0, 10)}…</code>}
                </p>
                {t.error && !quiet && (
                  <p className="tx-error" title={t.error.detail}>
                    {t.error.message}
                  </p>
                )}
              </div>
              {(t.status === 'confirmed' || t.status === 'failed') && (
                <button type="button" className="link" onClick={() => onDismiss(t.id)} aria-label={`Dismiss ${t.label}`}>
                  Dismiss
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
