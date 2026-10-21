import { isError, type TransactionReceipt, type TransactionResponse } from 'ethers'
import { useCallback, useState } from 'react'
import { classifyError, type AppError } from '../lib/errors'

/**
 * Lifecycle of one transaction:
 *
 *   awaiting-signature ──(user signs)──▶ pending ──(mined, status 1)──▶ confirmed
 *          │                                │
 *          └──(rejected / gas estimate      └──(mined with status 0, replaced
 *              reverted / wrong network)        as cancelled, network error)──▶ failed
 */
export type TxStatus = 'awaiting-signature' | 'pending' | 'confirmed' | 'failed'

export interface TxEntry {
  id: number
  label: string
  status: TxStatus
  hash?: string
  error?: AppError
}

let nextId = 1

export function useTransactions(onSettled: () => void) {
  const [txs, setTxs] = useState<TxEntry[]>([])

  const update = (id: number, patch: Partial<TxEntry>) => setTxs((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  /**
   * Run `send` (which must prompt the wallet and return the submitted tx) and
   * track it to completion. Resolves true only if the tx was mined successfully.
   */
  const run = useCallback(
    async (label: string, send: () => Promise<TransactionResponse>): Promise<boolean> => {
      const id = nextId++
      setTxs((all) => [{ id, label, status: 'awaiting-signature' as const }, ...all].slice(0, 5))

      let tx: TransactionResponse
      try {
        // ethers estimates gas before opening MetaMask, so a tx that would
        // revert fails here with the decoded reason, before costing any gas.
        tx = await send()
      } catch (e) {
        update(id, { status: 'failed', error: classifyError(e) })
        return false
      }

      update(id, { status: 'pending', hash: tx.hash })
      try {
        const receipt: TransactionReceipt | null = await tx.wait(1)
        if (receipt?.status === 1) {
          update(id, { status: 'confirmed' })
          return true
        }
        update(id, { status: 'failed', error: { kind: 'reverted', message: 'The transaction was mined but reverted.' } })
        return false
      } catch (e) {
        // Speed-up in MetaMask replaces the tx with a new hash: that is a success.
        if (isError(e, 'TRANSACTION_REPLACED') && !e.cancelled && e.receipt.status === 1) {
          update(id, { status: 'confirmed', hash: e.replacement.hash })
          return true
        }
        update(id, { status: 'failed', error: classifyError(e) })
        return false
      } finally {
        onSettled()
      }
    },
    [onSettled],
  )

  const dismiss = useCallback((id: number) => setTxs((all) => all.filter((t) => t.id !== id)), [])
  const busy = txs.some((t) => t.status === 'awaiting-signature' || t.status === 'pending')

  return { txs, run, dismiss, busy }
}
