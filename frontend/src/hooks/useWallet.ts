import { BrowserProvider, getAddress, toQuantity, type Eip1193Provider } from 'ethers'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChainInfo } from '../lib/config'
import { classifyError, type AppError } from '../lib/errors'

interface InjectedProvider extends Eip1193Provider {
  isMetaMask?: boolean
  providers?: InjectedProvider[]
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

/** If several wallet extensions are installed, prefer MetaMask. */
function getInjected(): InjectedProvider | undefined {
  const eth = window.ethereum
  if (!eth) return undefined
  return eth.providers?.find((p) => p.isMetaMask) ?? eth
}

export type WalletStatus = 'no-wallet' | 'disconnected' | 'connecting' | 'connected'

export interface Wallet {
  status: WalletStatus
  account: string | null
  chainId: bigint | null
  onExpectedChain: boolean
  /** Recreated whenever the account or chain changes, so stale providers never leak into reads. */
  provider: BrowserProvider | null
  error: AppError | null
  connect(): Promise<void>
  switchChain(): Promise<void>
  clearError(): void
}

export function useWallet(expected: ChainInfo): Wallet {
  const injected = useMemo(() => getInjected(), [])
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<bigint | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  // Restore an existing connection silently (eth_accounts never opens a prompt),
  // then keep state in sync with what the user does inside MetaMask.
  useEffect(() => {
    if (!injected) return
    let alive = true

    const onAccounts = (...args: unknown[]) => {
      const accts = args[0] as string[]
      setAccount(accts.length ? getAddress(accts[0]) : null)
    }
    const onChain = (...args: unknown[]) => setChainId(BigInt(args[0] as string))

    injected
      .request({ method: 'eth_accounts' })
      .then((a) => alive && onAccounts(a))
      .catch(() => {})
    injected
      .request({ method: 'eth_chainId' })
      .then((c) => alive && onChain(c))
      .catch(() => {})

    injected.on?.('accountsChanged', onAccounts)
    injected.on?.('chainChanged', onChain)
    return () => {
      alive = false
      injected.removeListener?.('accountsChanged', onAccounts)
      injected.removeListener?.('chainChanged', onChain)
    }
  }, [injected])

  const provider = useMemo(
    () => (injected && account && chainId !== null ? new BrowserProvider(injected) : null),
    // chainId and account are deliberate dependencies: a new provider per (account, chain).
    [injected, account, chainId],
  )

  const connect = useCallback(async () => {
    if (!injected) return
    setError(null)
    setConnecting(true)
    try {
      const accts = (await injected.request({ method: 'eth_requestAccounts' })) as string[]
      setAccount(accts.length ? getAddress(accts[0]) : null)
      setChainId(BigInt((await injected.request({ method: 'eth_chainId' })) as string))
    } catch (e) {
      setError(classifyError(e))
    } finally {
      setConnecting(false)
    }
  }, [injected])

  const switchChain = useCallback(async () => {
    if (!injected) return
    setError(null)
    const chainIdHex = toQuantity(expected.id)
    try {
      await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    } catch (e) {
      // 4902: MetaMask doesn't know this chain yet, so offer to add it.
      if ((e as { code?: number }).code === 4902) {
        try {
          await injected.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainIdHex,
                chainName: expected.name,
                rpcUrls: [expected.rpcUrl],
                nativeCurrency: expected.currency,
                blockExplorerUrls: expected.explorerUrl ? [expected.explorerUrl] : undefined,
              },
            ],
          })
        } catch (e2) {
          setError(classifyError(e2))
        }
      } else {
        setError(classifyError(e))
      }
    }
  }, [injected, expected])

  const status: WalletStatus = !injected ? 'no-wallet' : connecting ? 'connecting' : account ? 'connected' : 'disconnected'

  return {
    status,
    account,
    chainId,
    onExpectedChain: chainId === expected.id,
    provider,
    error,
    connect,
    switchChain,
    clearError: () => setError(null),
  }
}
