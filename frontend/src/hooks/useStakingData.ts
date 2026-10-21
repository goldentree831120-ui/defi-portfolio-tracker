import type { BrowserProvider } from 'ethers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyError, type AppError } from '../lib/errors'
import { readLockOptions, readSnapshot, readTokenInfo, type LockOption, type Snapshot, type TokenInfo } from '../lib/staking'

export interface StakingData {
  snapshot: Snapshot | null
  loading: boolean
  error: AppError | null
  refresh(): Promise<void>
}

interface Loaded {
  /** The provider the result was read with. A new provider means a new account or chain. */
  owner: BrowserProvider
  snapshot: Snapshot | null
  error: AppError | null
}

/**
 * Reads the dashboard state for `account`, then re-reads on every new block.
 * Only runs when the wallet is on the expected chain: calling the contract on
 * the wrong chain would hit an empty address and return garbage.
 *
 * Results are tagged with the provider that produced them, so when the user
 * switches account in MetaMask the old account's numbers vanish immediately
 * (derived during render) instead of flashing until the new read lands.
 */
export function useStakingData(provider: BrowserProvider | null, stakingAddress: string, account: string | null, enabled: boolean): StakingData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const statics = useRef<{ owner: BrowserProvider; token: TokenInfo; lockOptions: LockOption[] } | null>(null)
  const inFlight = useRef<BrowserProvider | null>(null)
  // A refresh requested while one is running (e.g. right after a tx confirms)
  // must not be dropped: the running one may have read the block before the tx.
  const rerun = useRef(false)

  const refresh = useCallback(async () => {
    if (!provider || !account || !enabled) return
    if (inFlight.current === provider) {
      rerun.current = true
      return
    }
    inFlight.current = provider
    try {
      do {
        rerun.current = false
        try {
          if (statics.current?.owner !== provider) {
            const [token, lockOptions] = await Promise.all([readTokenInfo(provider, stakingAddress), readLockOptions(provider, stakingAddress)])
            statics.current = { owner: provider, token, lockOptions }
          }
          const { token, lockOptions } = statics.current
          const snapshot = await readSnapshot(provider, stakingAddress, account, token, lockOptions)
          setLoaded({ owner: provider, snapshot, error: null })
        } catch (e) {
          // Keep the last good snapshot on a transient error; just surface the error.
          setLoaded((prev) => ({ owner: provider, snapshot: prev?.owner === provider ? prev.snapshot : null, error: classifyError(e) }))
        }
      } while (rerun.current)
    } finally {
      if (inFlight.current === provider) inFlight.current = null
    }
  }, [provider, stakingAddress, account, enabled])

  useEffect(() => {
    if (!provider || !account || !enabled) return
    void refresh()
    const onBlock = () => void refresh()
    void provider.on('block', onBlock)
    return () => {
      void provider.off('block', onBlock)
    }
  }, [provider, account, enabled, refresh])

  const current = enabled && provider && loaded?.owner === provider ? loaded : null
  return {
    snapshot: current?.snapshot ?? null,
    error: current?.error ?? null,
    loading: enabled && !!provider && !current,
    refresh,
  }
}
