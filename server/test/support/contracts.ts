// Compiled Staking + TrackerToken for the tests and `npm run dev:local`.
// Prefers ../contracts/artifacts (fresh from `npx hardhat compile` in the contracts folder);
// falls back to the snapshot in test/contracts/, so the server works on a fresh clone where
// artifacts are git-ignored. If both exist and differ, it says so: the snapshot is stale.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InterfaceAbi } from "ethers";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const compiledDir =
  process.env.CONTRACT_ARTIFACTS ?? join(serverRoot, "..", "contracts", "artifacts", "contracts");
const snapshotDir = join(serverRoot, "test", "contracts");
const warned = new Set<string>();

export function loadContract(name: "Staking" | "TrackerToken"): { abi: InterfaceAbi; bytecode: string } {
  const snapshot = JSON.parse(readFileSync(join(snapshotDir, `${name}.json`), "utf8"));
  const compiledPath = join(compiledDir, `${name}.sol`, `${name}.json`);
  if (!existsSync(compiledPath)) return snapshot;
  const compiled = JSON.parse(readFileSync(compiledPath, "utf8"));
  if (compiled.bytecode !== snapshot.bytecode && !warned.has(name)) {
    warned.add(name);
    console.warn(
      `[contracts] ${name}: ../contracts/artifacts differs from test/contracts/${name}.json; using the ` +
        `compiled one. Refresh the snapshot if the contract changed on purpose.`,
    );
  }
  return compiled;
}
