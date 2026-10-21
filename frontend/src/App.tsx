import type { TransactionResponse } from 'ethers'
import { useCallback } from 'react'
import { Activity } from './components/Activity'
import { Positions } from './components/Positions'
import { StakeForm } from './components/StakeForm'
import { useNow } from './hooks/useNow'
import { useStakingData } from './hooks/useStakingData'
import { useTransactions } from './hooks/useTransactions'
import { useWallet } from './hooks/useWallet'
import { addressUrl, type AppConfig } from './lib/config'
import { WrongNetworkError, type AppError } from './lib/errors'
import { formatAmount, formatCountdown, formatDate, shortAddress } from './lib/format'
import { chainNow, stakingContract, tokenContract, totals, type Position } from './lib/staking'

export default function App({ config }: { config: AppConfig }) {
  const { chain, stakingAddress } = config
  const wallet = useWallet(chain)
  const data = useStakingData(wallet.provider, stakingAddress, wallet.account, wallet.onExpectedChain)
  const { txs, run, dismiss, busy } = useTransactions(data.refresh)
  const wallNow = useNow()

  /** Get a signer, re-checking the chain at the moment of sending (the user may have switched since render). */
  const signer = useCallback(async () => {
    const provider = wallet.provider
    if (!provider) throw new Error('Wallet not connected.')
    const net = await provider.getNetwork()
    if (net.chainId !== chain.id) throw new WrongNetworkError(chain.name)
    return provider.getSigner()
  }, [wallet.provider, chain])

  const snap = data.snapshot
  const now = snap ? chainNow(snap, wallNow) : wallNow
  const sym = snap?.token.symbol ?? ''
  const fmt = (v: bigint, frac?: number) => (snap ? formatAmount(v, snap.token.decimals, frac) : '')

  const approve = (amount: bigint) =>
    run(`Approve ${fmt(amount)} ${sym}`, async () =>
      // Approve exactly the amount being staked, not an unlimited allowance.
      tokenContract(snap!.token.address, await signer()).approve(stakingAddress, amount) as Promise<TransactionResponse>,
    )
  const stake = (amount: bigint, option: number) =>
    run(`Stake ${fmt(amount)} ${sym}`, async () => stakingContract(stakingAddress, await signer()).stake(amount, option) as Promise<TransactionResponse>)
  const claim = (p: Position) =>
    run(`Claim ${fmt(p.pending, 6)} ${sym} from position ${p.id}`, async () =>
      stakingContract(stakingAddress, await signer()).claimRewards(p.id) as Promise<TransactionResponse>,
    )
  const withdraw = (p: Position) =>
    run(`Withdraw position ${p.id}`, async () => stakingContract(stakingAddress, await signer()).withdraw(p.id) as Promise<TransactionResponse>)

  const t = snap ? totals(snap.positions, now) : null
  const contractLink = addressUrl(chain, stakingAddress)

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>TRK Staking</span>
        </div>
        <div className="top-right">
          {wallet.status === 'connected' && (
            <>
              <span className={`net ${wallet.onExpectedChain ? 'ok' : 'bad'}`}>{wallet.onExpectedChain ? chain.name : 'Wrong network'}</span>
              <span className="acct" title={wallet.account!}>
                {shortAddress(wallet.account!)}
              </span>
            </>
          )}
        </div>
      </header>

      <main>
        {wallet.error && <Notice error={wallet.error} onClose={wallet.clearError} />}

        {wallet.status === 'no-wallet' && (
          <Gate title="Install MetaMask to continue">
            <p>This app talks to the staking contract through your browser wallet. No wallet extension was found.</p>
            <a className="primary button" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Get MetaMask
            </a>
          </Gate>
        )}

        {(wallet.status === 'disconnected' || wallet.status === 'connecting') && (
          <Gate title="Stake TRK for 30, 90 or 180 days">
            <p>Longer locks earn more: 5%, 12% or 25% a year. Connect a wallet on {chain.name} to see your balance and positions.</p>
            <button className="primary" onClick={wallet.connect} disabled={wallet.status === 'connecting'}>
              {wallet.status === 'connecting' ? 'Check MetaMask…' : 'Connect MetaMask'}
            </button>
          </Gate>
        )}

        {wallet.status === 'connected' && !wallet.onExpectedChain && (
          <Gate title={`Switch to ${chain.name}`}>
            <p>
              Your wallet is on chain {wallet.chainId?.toString()}. The staking contract lives on {chain.name}, so balances and transactions are
              paused until you switch.
            </p>
            <button className="primary" onClick={wallet.switchChain}>
              Switch to {chain.name}
            </button>
          </Gate>
        )}

        {wallet.status === 'connected' && wallet.onExpectedChain && (
          <>
            {data.error && <Notice error={data.error} onRetry={data.refresh} />}
            {!snap && !data.error && <p className="loading">Reading the staking contract…</p>}
            {snap && t && (
              <>
                <section className="figures" aria-label="Summary">
                  <Figure label="In your wallet" value={fmt(snap.walletBalance)} unit={sym} />
                  <Figure label={`Staked in ${t.openCount} position${t.openCount === 1 ? '' : 's'}`} value={fmt(t.staked)} unit={sym} />
                  <Figure label="Rewards accrued" value={fmt(t.pending, 6)} unit={sym} />
                  <Figure
                    label={t.nextUnlock ? `Next unlock, ${formatDate(t.nextUnlock)}` : 'Next unlock'}
                    value={t.nextUnlock ? formatCountdown(Number(t.nextUnlock - now)) : t.openCount ? 'All unlocked' : 'Nothing locked'}
                  />
                </section>

                <div className="columns">
                  <div className="side">
                    <StakeForm snapshot={snap} disabled={busy} onApprove={approve} onStake={stake} />
                    <Activity txs={txs} chain={chain} onDismiss={dismiss} />
                  </div>
                  <Positions snapshot={snap} now={now} disabled={busy} onClaim={claim} onWithdraw={withdraw} />
                </div>

                <footer className="foot">
                  Block {snap.blockNumber.toLocaleString()}. Contract{' '}
                  {contractLink ? (
                    <a href={contractLink} target="_blank" rel="noreferrer">
                      {shortAddress(stakingAddress)}
                    </a>
                  ) : (
                    shortAddress(stakingAddress)
                  )}
                  .
                </footer>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="figure">
      <p className="figure-value">
        {value} {unit && <span>{unit}</span>}
      </p>
      <p className="figure-label">{label}</p>
    </div>
  )
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gate">
      <h1>{title}</h1>
      {children}
    </section>
  )
}

function Notice({ error, onClose, onRetry }: { error: AppError; onClose?: () => void; onRetry?: () => void }) {
  return (
    <div className={`notice ${error.kind === 'user-rejected' ? 'quiet' : ''}`} role="alert">
      <p title={error.detail}>{error.message}</p>
      {onRetry && (
        <button className="link" onClick={onRetry}>
          Try again
        </button>
      )}
      {onClose && (
        <button className="link" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  )
}
