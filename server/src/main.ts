// Entry point: validate config, migrate, check the chain, then run the indexer and the API
// in one process. Ctrl+C / SIGTERM stops both cleanly (the in-flight batch commits or rolls back).

import { JsonRpcProvider } from "ethers";
import { buildApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { createPool, migrate } from "./db.ts";
import { Indexer, loadRewardRates } from "./indexer.ts";

const cfg = loadConfig();
const log = (msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const db = createPool(cfg.DATABASE_URL);
const applied = await migrate(db);
if (applied.length) log("migrated", { applied });

const provider = new JsonRpcProvider(cfg.RPC_URL, undefined, { staticNetwork: true });
const chainId = Number((await provider.getNetwork()).chainId);
if (chainId !== cfg.CHAIN_ID) {
  throw new Error(`RPC is on chain ${chainId} but CHAIN_ID is ${cfg.CHAIN_ID}; refusing to index the wrong chain`);
}
if ((await provider.getCode(cfg.STAKING_ADDRESS)) === "0x") {
  throw new Error(`no contract at STAKING_ADDRESS ${cfg.STAKING_ADDRESS} on chain ${chainId}`);
}
const rewardRates = await loadRewardRates((data) => provider.call({ to: cfg.STAKING_ADDRESS, data }));

const indexer = new Indexer(
  db,
  provider,
  {
    chainId,
    contract: cfg.STAKING_ADDRESS,
    startBlock: cfg.START_BLOCK,
    confirmations: cfg.CONFIRMATIONS,
    batchSize: cfg.BATCH_SIZE,
    rewardRates,
  },
  log,
);

const api = buildApi({
  db,
  chainId,
  contract: cfg.STAKING_ADDRESS,
  confirmations: cfg.CONFIRMATIONS,
  corsOrigins: cfg.CORS_ORIGINS,
  status: () => indexer.status,
  logger: cfg.LOG_LEVEL === "silent" ? false : { level: cfg.LOG_LEVEL },
});

const running = indexer.run(cfg.POLL_INTERVAL_MS);
await api.listen({ host: cfg.HOST, port: cfg.PORT });
log("started", { chainId, contract: cfg.STAKING_ADDRESS, confirmations: cfg.CONFIRMATIONS, port: cfg.PORT });

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    log("stopping", { signal: sig });
    indexer.stop();
    await api.close();
    await running;
    await db.end();
    process.exit(0);
  });
}
