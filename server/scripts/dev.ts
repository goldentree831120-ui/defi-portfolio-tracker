// One-command local stack: Postgres + Hardhat chain + the real contracts + some activity +
// the server, so you can curl the API without any accounts or keys.
//
//   npm run dev:local
//
// Postgres: DATABASE_URL if set, otherwise an embedded Postgres in .pgdata/dev (kept between
// runs, delete the folder to start over). Chain: a Hardhat node on :8545 (started here unless
// one is already running). Contracts: deployed fresh each run (test/support/contracts.ts picks the build).
// Every 20 s one of the test accounts stakes 1 TRK, so you can watch the indexer pick it up.

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { startEmbeddedPostgres } from "../test/support/embedded-pg.ts";
import { loadContract } from "../test/support/contracts.ts";
import { BaseContract, ContractFactory, JsonRpcProvider, parseEther, type ContractTransactionResponse } from "ethers";

const root = process.cwd();
const children: ChildProcess[] = [];
const stops: (() => Promise<void>)[] = [];
const say = (m: string) => console.log(`[dev] ${m}`);

async function rpcUp(url: string) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const artifact = loadContract;

type Send = Promise<ContractTransactionResponse>;
type Token = BaseContract & { approve(s: string, a: bigint): Send; transfer(t: string, a: bigint): Send };
type Staking = BaseContract & {
  stake(a: bigint, o: number): Send;
  withdraw(id: number): Send;
  claimRewards(id: number): Send;
  fundRewardPool(a: bigint): Send;
};

async function main() {
  // ---- Postgres
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const pg = await startEmbeddedPostgres({ dir: join(root, ".pgdata", "dev"), port: 54329, persistent: true, database: "tracker" });
    stops.push(pg.stop);
    databaseUrl = pg.url;
    say(`postgres   ${databaseUrl} (embedded, data in .pgdata/dev)`);
  }

  // ---- chain
  const rpcUrl = "http://127.0.0.1:8545";
  if (!(await rpcUp(rpcUrl))) {
    const node = spawn(join(root, "node_modules", ".bin", "hardhat"), ["--config", "test/support/hardhat.config.cjs", "node", "--port", "8545"], {
      stdio: "ignore",
    });
    children.push(node);
    for (let i = 0; i < 60 && !(await rpcUp(rpcUrl)); i++) await new Promise((r) => setTimeout(r, 1000));
    say("chain      hardhat node on :8545 (started)");
  } else {
    say("chain      using the node already running on :8545");
  }
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const [owner, alice, bob] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));

  // ---- contracts + activity
  const T = artifact("TrackerToken");
  const S = artifact("Staking");
  const tokenDeploy = await new ContractFactory(T.abi, T.bytecode, owner!).deploy();
  const token = (await tokenDeploy.waitForDeployment()) as unknown as Token;
  const startBlock = (await tokenDeploy.deploymentTransaction()!.wait())!.blockNumber; // index from here
  const staking = (await (await new ContractFactory(S.abi, S.bytecode, owner!).deploy(await token.getAddress())).waitForDeployment()) as unknown as Staking;
  const stakingAddress = await staking.getAddress();
  await (await token.approve(stakingAddress, parseEther("200000"))).wait();
  await (await staking.fundRewardPool(parseEther("200000"))).wait();
  for (const u of [alice!, bob!]) {
    await (await token.transfer(await u.getAddress(), parseEther("10000"))).wait();
    await (await (token.connect(u) as Token).approve(stakingAddress, parseEther("10000"))).wait();
  }
  const as = (s: typeof alice) => staking.connect(s!) as Staking;
  await (await as(alice).stake(parseEther("1000"), 0)).wait();
  await (await as(alice).stake(parseEther("250"), 2)).wait();
  await (await as(bob).stake(parseEther("2000"), 1)).wait();
  await provider.send("evm_increaseTime", [7 * 86_400]);
  await (await as(bob).withdraw(0)).wait(); // early exit: 10% penalty
  say(`contracts  Staking ${stakingAddress} (from block ${startBlock}); alice ${await alice!.getAddress()}`);

  const ticker = setInterval(async () => {
    try {
      await (await as(alice).stake(parseEther("1"), 0)).wait();
      say("activity   alice staked 1 TRK");
    } catch (e) {
      say(`activity   failed: ${(e as Error).message}`);
    }
  }, 20_000);
  stops.push(async () => clearInterval(ticker));

  // ---- server
  const server = spawn(join(root, "node_modules", ".bin", "tsx"), ["src/main.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RPC_URL: rpcUrl,
      CHAIN_ID: "31337",
      STAKING_ADDRESS: stakingAddress,
      START_BLOCK: String(startBlock),
      CONFIRMATIONS: "0",
      POLL_INTERVAL_MS: "2000",
      LOG_LEVEL: "warn",
    },
  });
  children.push(server);
  const a = await alice!.getAddress();
  setTimeout(() => {
    say("try:");
    for (const p of ["/v1/status", `/v1/wallets/${a}/summary`, `/v1/wallets/${a}/positions`, `/v1/wallets/${a}/events?limit=5`]) {
      console.log(`  curl -s localhost:3001${p} | jq`);
    }
    say("Ctrl+C stops everything");
  }, 3000);
}

async function shutdown() {
  for (const c of children.reverse()) c.kill("SIGTERM");
  for (const s of stops.reverse()) await s().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (e) => {
  console.error(`[dev] failed: ${(e as Error).message}`);
  await shutdown();
});
