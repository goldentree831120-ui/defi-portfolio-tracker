import { defineConfig } from '@playwright/test'

// Ports chosen so they don't clash with `npm run dev` (5173) or the server's default (3001).
// The chain must be on 8545: that's the RPC the injected test wallet and the app's Hardhat
// chain entry use.
export const PORTS = { chain: 8545, api: 3101, web: 5174, pg: 54341 } as const

export default defineConfig({
  testDir: 'tests',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1, // one shared chain and database
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORTS.web}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Set PW_CHROMIUM to use an already-installed Chromium instead of `npx playwright install`.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
