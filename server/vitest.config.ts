import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/support/global-setup.ts"],
    // One shared Hardhat chain, and the reorg test rewinds it: run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
