import { randomBytes } from "node:crypto";
import {
  BaseContract,
  ContractFactory,
  JsonRpcProvider,
  parseEther,
  type ContractTransactionResponse,
  type JsonRpcSigner,
} from "ethers";
import pg from "pg";
import { inject } from "vitest";
import { createPool, migrate, type Db } from "../../src/db.ts";
import { Indexer, loadRewardRates, type Chain } from "../../src/indexer.ts";
import { loadContract } from "./contracts.ts";

// ---------------------------------------------------------------- database

/** A brand-new, migrated database for one test file. */
export async function freshDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const admin = inject("adminDatabaseUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const db = createPool(url.toString());
  await migrate(db);
  return {
    db,
    drop: async () => {
      await db.end();
      const c2 = new pg.Client({ connectionString: admin });
      await c2.connect();
      await c2.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c2.end();
    },
  };
}

// ---------------------------------------------------------------- chain

const artifact = loadContract;

type Send = Promise<ContractTransactionResponse>;
export type Token = BaseContract & {
  approve(spender: string, amount: bigint): Send;
  transfer(to: string, amount: bigint): Send;
};
export type Staking = BaseContract & {
  stake(amount: bigint, optionIndex: number): Send;
  claimRewards(positionId: number): Send;
  withdraw(positionId: number): Send;
  fundRewardPool(amount: bigint): Send;
};

export interface Deployment {
  provider: JsonRpcProvider;
  token: Token;
  staking: Staking;
  stakingAddress: string;
  owner: JsonRpcSigner;
  alice: JsonRpcSigner;
  bob: JsonRpcSigner;
  startBlock: number;
}

export function provider(): JsonRpcProvider {
  // cacheTimeout -1: never serve a cached block number (tests mine blocks between calls)
  return new JsonRpcProvider(inject("rpcUrl"), undefined, { staticNetwork: true, cacheTimeout: -1 });
}

/** Deploy TrackerToken + Staking (the real contracts), fund the pool, give alice and bob tokens. */
export async function deployStaking(): Promise<Deployment> {
  const p = provider();
  const [owner, alice, bob] = await Promise.all([p.getSigner(0), p.getSigner(1), p.getSigner(2)]);
  const T = artifact("TrackerToken");
  const S = artifact("Staking");
  const token = (await (await new ContractFactory(T.abi, T.bytecode, owner).deploy()).waitForDeployment()) as unknown as Token;
  const startBlock = await p.getBlockNumber(); // the token deploy block; the staking deploy is after
  const staking = (await (
    await new ContractFactory(S.abi, S.bytecode, owner).deploy(await token.getAddress())
  ).waitForDeployment()) as unknown as Staking;
  const stakingAddress = await staking.getAddress();
  await (await token.approve(stakingAddress, parseEther("200000"))).wait();
  await (await staking.fundRewardPool(parseEther("200000"))).wait();
  for (const u of [alice, bob]) {
    await (await token.transfer(await u.getAddress(), parseEther("10000"))).wait();
    await (await as(token, u).approve(stakingAddress, parseEther("10000"))).wait();
  }
  return { provider: p, token, staking, stakingAddress, owner, alice, bob, startBlock };
}

/** The same contract, sending from another account. */
export const as = <C extends BaseContract>(c: C, s: JsonRpcSigner) => c.connect(s) as C;

export async function mine(p: JsonRpcProvider, blocks = 1) {
  await p.send("hardhat_mine", [`0x${blocks.toString(16)}`]);
}

export async function increaseTime(p: JsonRpcProvider, seconds: number) {
  await p.send("evm_increaseTime", [seconds]);
  await mine(p);
}

// ---------------------------------------------------------------- indexer

export async function makeIndexer(
  db: Db,
  d: Deployment,
  opts: { confirmations?: number; batchSize?: number; chain?: Chain; startBlock?: number } = {},
) {
  const rewardRates = await loadRewardRates((data) => d.provider.call({ to: d.stakingAddress, data }));
  return new Indexer(db, opts.chain ?? d.provider, {
    chainId: 31337,
    contract: d.stakingAddress,
    startBlock: opts.startBlock ?? d.startBlock,
    confirmations: opts.confirmations ?? 0,
    batchSize: opts.batchSize ?? 500,
    rewardRates,
  });
}

/** Everything the indexer derived, in a stable form to compare runs. */
export async function snapshotDb(db: Db) {
  const events = await db.query(
    "SELECT event, user_address, position_id, amount, penalty, block_number, log_index FROM staking_events ORDER BY id",
  );
  const positions = await db.query(
    `SELECT user_address, position_id, amount, rewards_claimed, withdrawn, withdrawn_amount, penalty, reward_rate_bps
     FROM positions ORDER BY user_address, position_id`,
  );
  const cursor = await db.query("SELECT last_block FROM indexer_cursor");
  return { events: events.rows, positions: positions.rows, cursor: cursor.rows };
}
