import { isAddress, getAddress } from 'ethers'

/** Chains the app knows how to add to / switch MetaMask to. */
export interface ChainInfo {
  id: bigint
  name: string
  /** Public RPC used only when asking MetaMask to *add* the chain. No API keys. */
  rpcUrl: string
  explorerUrl: string | null
  currency: { name: string; symbol: string; decimals: 18 }
}

export const CHAINS: Record<string, ChainInfo> = {
  '11155111': {
    id: 11155111n,
    name: 'Sepolia',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    currency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  },
  '31337': {
    id: 31337n,
    name: 'Hardhat local',
    rpcUrl: 'http://127.0.0.1:8545',
    explorerUrl: null,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
}

export interface AppConfig {
  chain: ChainInfo
  stakingAddress: string
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; errors: string[] }

/** Validate build-time env vars. Pure, so it can be unit-tested (M3). */
export function parseConfig(env: Record<string, string | undefined>): ConfigResult {
  const errors: string[] = []

  const chainId = env.VITE_CHAIN_ID ?? '11155111'
  const chain = CHAINS[chainId]
  if (!chain) errors.push(`VITE_CHAIN_ID=${chainId} is not supported. Use one of: ${Object.keys(CHAINS).join(', ')}.`)

  const staking = env.VITE_STAKING_ADDRESS
  if (!staking) errors.push('VITE_STAKING_ADDRESS is not set.')
  else if (!isAddress(staking)) errors.push(`VITE_STAKING_ADDRESS=${staking} is not a valid address.`)

  if (errors.length || !chain || !staking) return { ok: false, errors }
  return { ok: true, config: { chain, stakingAddress: getAddress(staking) } }
}

export const configResult = parseConfig(import.meta.env)

export function txUrl(chain: ChainInfo, hash: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null
}

export function addressUrl(chain: ChainInfo, address: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/address/${address}` : null
}
