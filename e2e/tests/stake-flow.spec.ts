// The whole stack, through the real UI: a stake made in the browser must show up in the UI,
// on-chain, and in the indexer's API; a rejected transaction must change nothing anywhere.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, JsonRpcProvider, formatEther, parseEther } from 'ethers'

const here = dirname(fileURLToPath(import.meta.url))
const state = () =>
  JSON.parse(readFileSync(join(here, '..', '.e2e-state.json'), 'utf8')) as {
    stakingAddress: string
    rpcUrl: string
    apiUrl: string
  }
const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const NINETY_DAYS = 90 * 86_400

test.describe.configure({ mode: 'serial' })

let page: Page

/** The API is eventually consistent with the chain (poll interval 0.5 s): retry until it agrees. */
async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${state().apiUrl}${path}`)
  expect(r.ok, `${path} -> ${r.status}`).toBe(true)
  return (await r.json()) as T
}
type Positions = { positions: { positionId: string; amount: string; lockDurationSeconds: number; status: string; penalty: string | null }[] }
type Summary = { openPositions: number; withdrawnPositions: number; totalStaked: string; totalPenalties: string }
type Events = { events: { event: string }[] }

async function txSettled(label: string) {
  const row = page.locator('.tx', { hasText: label }).first()
  await expect(row.locator('.tx-status')).toHaveText(/Confirmed|Failed|Rejected/, { timeout: 30_000 })
  return (await row.locator('.tx-status').innerText()).trim()
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.addInitScript({ path: join(here, '..', 'support', 'inject.js') })
  await page.goto('/')
})

test.afterAll(async () => {
  await page.close()
})

test('rejecting the connection shows a notice; approving shows the dashboard', async () => {
  await page.evaluate(() => ((window as any).__wallet.reject = true))
  await page.getByRole('button', { name: 'Connect MetaMask' }).click()
  await expect(page.locator('.notice')).toContainText('rejected')
  await page.evaluate(() => ((window as any).__wallet.reject = false))
  await page.getByRole('button', { name: 'Connect MetaMask' }).click()
  await expect(page.locator('.figures')).toBeVisible()
})

test('stake 100 TRK for 90 days in the UI: visible in the UI, on-chain and in the API', async () => {
  await page.getByLabel('Amount').fill('100')
  await page.locator('.tier', { hasText: '90 days' }).click()
  await page.getByRole('button', { name: 'Approve 100 TRK' }).click()
  expect(await txSettled('Approve 100 TRK')).toMatch(/Confirmed/)
  await page.getByRole('button', { name: 'Stake 100 TRK' }).click()
  expect(await txSettled('Stake 100 TRK')).toMatch(/Confirmed/)

  // UI
  await expect(page.locator('.position')).toHaveCount(1)
  await expect(page.locator('.position').first()).toContainText('100')

  // chain
  const { stakingAddress, rpcUrl } = state()
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
  const staking = new Contract(stakingAddress, ['function positionsOf(address) view returns (tuple(uint256 amount, uint256 startTime, uint256 lockDuration, uint256 rewardRateBps, uint256 lastClaimTime, bool withdrawn)[])'], provider)
  const onChain = await staking.positionsOf(USER)
  expect(onChain).toHaveLength(1)
  expect(onChain[0].amount).toBe(parseEther('100'))
  provider.destroy()

  // indexer API
  await expect
    .poll(async () => (await api<Positions>(`/v1/wallets/${USER}/positions`)).positions, { timeout: 15_000 })
    .toEqual([
      expect.objectContaining({
        positionId: '0',
        amount: parseEther('100').toString(),
        lockDurationSeconds: NINETY_DAYS,
        status: 'open',
      }),
    ])
  const summary = await api<Summary>(`/v1/wallets/${USER}/summary`)
  expect(summary).toMatchObject({ openPositions: 1, totalStaked: parseEther('100').toString() })
})

test('a transaction the user rejects sends nothing: chain and API unchanged', async () => {
  const before = (await api<Events>(`/v1/wallets/${USER}/events?limit=100`)).events.length
  const sentBefore = await page.evaluate(() => (window as any).__wallet.sent as number)

  await page.getByLabel('Amount').fill('5')
  await page.locator('.tier', { hasText: '30 days' }).click()
  await page.evaluate(() => ((window as any).__wallet.reject = true))
  await page.locator('.stake button[type=submit]').click()
  expect(await txSettled('5 TRK')).toMatch(/Rejected/)
  await page.evaluate(() => ((window as any).__wallet.reject = false))

  expect(await page.evaluate(() => (window as any).__wallet.sent as number)).toBe(sentBefore)
  await page.waitForTimeout(1500) // longer than the indexer's poll interval
  expect((await api<Events>(`/v1/wallets/${USER}/events?limit=100`)).events).toHaveLength(before)
})

test('early withdrawal: UI asks for confirmation, the API records the 10% penalty', async () => {
  await page.getByRole('button', { name: 'Withdraw early' }).click()
  await expect(page.locator('.confirm')).toContainText(/10/)
  await page.getByRole('button', { name: 'Withdraw and pay penalty' }).click()
  expect(await txSettled('Withdraw position 0')).toMatch(/Confirmed/)

  await expect
    .poll(async () => (await api<Positions>(`/v1/wallets/${USER}/positions`)).positions[0], { timeout: 15_000 })
    .toMatchObject({ status: 'withdrawn', penalty: parseEther('10').toString() })
  const summary = await api<Summary>(`/v1/wallets/${USER}/summary`)
  expect(summary).toMatchObject({ openPositions: 0, withdrawnPositions: 1, totalPenalties: parseEther('10').toString() })
  console.log(`penalty recorded by the indexer: ${formatEther(summary.totalPenalties)} TRK`)
})
