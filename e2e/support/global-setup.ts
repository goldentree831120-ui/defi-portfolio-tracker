// Starts the whole stack once for all tests, and stops it afterwards:
//   1. Postgres (embedded, from the server's own test helper; throwaway data dir)
//   2. a Hardhat node on :8545 (fresh chain, automine)
//   3. TrackerToken + Staking deployed, reward pool funded, 1,000 TRK sent to the test user
//   4. the real server (indexer + API), CONFIRMATIONS=0
//   5. the real frontend (Vite dev server) pointed at the new Staking address
// Prerequisite: `npm ci` in ../server and ../frontend.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContractFactory, JsonRpcProvider, parseEther, type BaseContract, type ContractTransactionResponse } from 'ethers'
import { PORTS } from '../playwright.config'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const server = join(repo, 'server')
const frontend = join(repo, 'frontend')
export const STATE_FILE = join(here, '..', '.e2e-state.json')
export const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // Hardhat account #1, also in inject.js

const children: ChildProcess[] = []

function start(name: string, cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; ready: RegExp }) {
  const bin = join(opts.cwd, 'node_modules', '.bin', cmd)
  if (!existsSync(bin)) throw new Error(`${name}: ${bin} not found. Run \`npm ci\` in ${opts.cwd} first.`)
  // NO_COLOR: in CI (where the CI env var is set) tools colour their output, and colour codes
  // between words break the readiness patterns below. They're also stripped, to be safe.
  const child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, NO_COLOR: '1', ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not start in 120 s:\n${out.slice(-2000)}`)), 120_000)
    const onData = (d: Buffer) => {
      out += d.toString().replace(/\x1b\[[0-9;]*m/g, '')
      const m = out.match(opts.ready)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${name} exited (${code}) before it was ready:\n${out.slice(-2000)}`))
    })
  })
}

async function portFree(port: number) {
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })
    return false
  } catch (e) {
    return (e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED'
  }
}

type Send = Promise<ContractTransactionResponse>
type Token = BaseContract & { approve(s: string, a: bigint): Send; transfer(t: string, a: bigint): Send }
type Staking = BaseContract & { fundRewardPool(a: bigint): Send }

async function deploy(rpcUrl: string) {
  const load = (n: string) => JSON.parse(readFileSync(join(server, 'test', 'contracts', `${n}.json`), 'utf8'))
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
  const owner = await provider.getSigner(0)
  const T = load('TrackerToken')
  const S = load('Staking')
  const tokenTx = await new ContractFactory(T.abi, T.bytecode, owner).deploy()
  const token = (await tokenTx.waitForDeployment()) as unknown as Token
  const deployBlock = (await tokenTx.deploymentTransaction()!.wait())!.blockNumber
  const staking = (await (await new ContractFactory(S.abi, S.bytecode, owner).deploy(await token.getAddress())).waitForDeployment()) as unknown as Staking
  const stakingAddress = await staking.getAddress()
  await (await token.approve(stakingAddress, parseEther('200000'))).wait()
  await (await staking.fundRewardPool(parseEther('200000'))).wait()
  await (await token.transfer(USER, parseEther('1000'))).wait()
  provider.destroy()
  return { stakingAddress, tokenAddress: await token.getAddress(), deployBlock }
}

export default async function globalSetup() {
  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await portFree(port))) throw new Error(`port ${port} (${name}) is in use. Stop \`npm run dev:local\` or whatever is using it.`)
  }
  const stop = async () => {
    for (const c of children.reverse()) {
      if (c.exitCode !== null) continue
      await new Promise<void>((resolve) => {
        c.once('exit', () => resolve())
        c.kill('SIGTERM')
        setTimeout(() => (c.kill('SIGKILL'), resolve()), 10_000)
      })
    }
  }
  try {
    // 1. Postgres
    const pgReady = await start('postgres', 'tsx', ['test/support/pg-child.ts', join(server, '.pgdata', 'e2e'), String(PORTS.pg)], {
      cwd: server,
      ready: /READY \S+/,
    })
    const databaseUrl = pgReady.replace('READY ', '')

    // 2. chain
    await start('hardhat node', 'hardhat', ['--config', 'test/support/hardhat.config.cjs', 'node', '--port', String(PORTS.chain)], {
      cwd: server,
      ready: /Started HTTP/,
    })
    const rpcUrl = `http://127.0.0.1:${PORTS.chain}`

    // 3. contracts
    const d = await deploy(rpcUrl)

    // 4. server
    await start('server', 'tsx', ['src/main.ts'], {
      cwd: server,
      env: {
        DATABASE_URL: databaseUrl,
        RPC_URL: rpcUrl,
        CHAIN_ID: '31337',
        STAKING_ADDRESS: d.stakingAddress,
        START_BLOCK: String(d.deployBlock),
        CONFIRMATIONS: '0',
        POLL_INTERVAL_MS: '500',
        PORT: String(PORTS.api),
        CORS_ORIGINS: `http://127.0.0.1:${PORTS.web}`,
        LOG_LEVEL: 'warn',
      },
      ready: /"msg":"started"/,
    })

    // 5. frontend (env vars override any .env file in ../frontend)
    await start('vite', 'vite', ['--port', String(PORTS.web), '--strictPort', '--host', '127.0.0.1'], {
      cwd: frontend,
      env: { VITE_CHAIN_ID: '31337', VITE_STAKING_ADDRESS: d.stakingAddress },
      ready: /Local:\s+http/,
    })

    writeFileSync(STATE_FILE, JSON.stringify({ ...d, rpcUrl, apiUrl: `http://127.0.0.1:${PORTS.api}` }, null, 2))
  } catch (e) {
    await stop()
    throw e
  }
  return stop
}
