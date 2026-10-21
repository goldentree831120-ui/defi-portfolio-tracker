import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseEther, type TransactionReceipt } from "ethers";
import type { Db } from "../src/db.ts";
import { ReorgError, type Chain } from "../src/indexer.ts";
import {
  as,
  deployStaking,
  freshDb,
  increaseTime,
  makeIndexer,
  mine,
  snapshotDb,
  type Deployment,
} from "./support/fixtures.ts";

const DAY = 86_400;

/**
 * A realistic history: three stakes in three tiers, a claim, an early withdrawal (10% penalty)
 * and a withdrawal after unlock. Returns the RewardsClaimed amounts read from the receipts,
 * an independent source to check the indexer against.
 */
async function scenario(d: Deployment) {
  const s = d.staking;
  const claims: bigint[] = [];
  const record = (r: TransactionReceipt | null) => {
    for (const l of r!.logs) {
      const p = s.interface.parseLog(l);
      if (p?.name === "RewardsClaimed") claims.push(p.args.amount as bigint);
    }
  };
  await (await as(s, d.alice).stake(parseEther("1000"), 0)).wait(); // alice #0: 30 d, 5%
  await (await as(s, d.alice).stake(parseEther("500"), 2)).wait(); //  alice #1: 180 d, 25%
  await (await as(s, d.bob).stake(parseEther("2000"), 1)).wait(); //   bob #0:   90 d, 12%
  await increaseTime(d.provider, 10 * DAY);
  record(await (await as(s, d.alice).claimRewards(0)).wait());
  record(await (await as(s, d.bob).withdraw(0)).wait()); // early: 10% penalty
  await increaseTime(d.provider, 31 * DAY);
  record(await (await as(s, d.alice).withdraw(0)).wait()); // after unlock: no penalty
  return { claims };
}

/** What a single clean pass over the same chain produces: the reference for every other test. */
async function reference(d: Deployment) {
  const { db, drop } = await freshDb();
  try {
    await (await makeIndexer(db, d)).catchUp();
    return await snapshotDb(db);
  } finally {
    await drop();
  }
}

let db: Db;
let drop: () => Promise<void>;
beforeEach(async () => ({ db, drop } = await freshDb()));
afterEach(async () => drop());

describe("indexing", () => {
  test("builds positions from Staked, RewardsClaimed and Withdrawn events", async () => {
    const d = await deployStaking();
    const { claims } = await scenario(d);
    await (await makeIndexer(db, d)).catchUp();

    const alice = (await d.alice.getAddress()).toLowerCase();
    const bob = (await d.bob.getAddress()).toLowerCase();
    const pos = (await db.query("SELECT * FROM positions ORDER BY user_address = $1 DESC, position_id", [alice])).rows;
    expect(pos.map((p) => [p.user_address, p.position_id, p.amount, p.reward_rate_bps, p.withdrawn, p.penalty])).toEqual([
      [alice, "0", parseEther("1000").toString(), 500, true, "0"],
      [alice, "1", parseEther("500").toString(), 2500, false, null],
      [bob, "0", parseEther("2000").toString(), 1200, true, parseEther("200").toString()],
    ]);
    expect(pos[2].withdrawn_amount).toBe(parseEther("1800").toString());

    // Claimed rewards equal the RewardsClaimed amounts in the transaction receipts.
    const [aliceClaim, bobClaim, aliceWithdrawClaim] = claims;
    expect(pos[0].rewards_claimed).toBe((aliceClaim! + aliceWithdrawClaim!).toString());
    expect(pos[2].rewards_claimed).toBe(bobClaim!.toString());

    // unlock = start + lock duration, start = block time of the stake
    expect(pos[1].unlock_time.getTime() - pos[1].start_time.getTime()).toBe(180 * DAY * 1000);

    const events = (await db.query("SELECT event FROM staking_events ORDER BY id")).rows.map((r) => r.event);
    expect(events).toEqual(["Staked", "Staked", "Staked", "RewardsClaimed", "RewardsClaimed", "Withdrawn", "RewardsClaimed", "Withdrawn"]);
  });

  test("waits for the confirmation depth before indexing a block", async () => {
    const d = await deployStaking();
    await scenario(d);
    const head = await d.provider.getBlockNumber();
    const idx = await makeIndexer(db, d, { confirmations: 5 });
    await idx.catchUp();

    const cursor = Number((await db.query("SELECT last_block FROM indexer_cursor")).rows[0].last_block);
    expect(cursor).toBe(head - 5);
    const maxIndexed = Number((await db.query("SELECT max(block_number) AS m FROM staking_events")).rows[0].m);
    expect(maxIndexed).toBeLessThanOrEqual(head - 5);
    const before = (await db.query("SELECT count(*)::int AS n FROM staking_events")).rows[0].n;
    expect(before).toBeLessThan(8); // the last withdrawal is only a few blocks deep

    await mine(d.provider, 5);
    await idx.catchUp();
    const { events, positions } = await snapshotDb(db);
    const ref = await reference(d);
    expect({ events, positions }).toEqual({ events: ref.events, positions: ref.positions });
  });
});

describe("restarts never double count", () => {
  test("stopping part-way and starting a new process resumes from the cursor", async () => {
    const d = await deployStaking();
    await scenario(d);
    const first = await makeIndexer(db, d, { batchSize: 3 });
    await first.tick();
    await first.tick(); // "crash" here: the process is gone, the DB holds a partial index

    await (await makeIndexer(db, d, { batchSize: 3 })).catchUp(); // a new process
    expect(await snapshotDb(db)).toEqual(await reference(d));
  });

  test("a crash in the middle of a batch rolls back the events AND the cursor", async () => {
    const d = await deployStaking();
    await scenario(d);
    const idx = await makeIndexer(db, d);
    idx.afterEvent = (i) => {
      if (i === 4) throw new Error("simulated crash after writing 5 events");
    };
    await expect(idx.tick()).rejects.toThrow("simulated crash");
    expect((await db.query("SELECT count(*)::int AS n FROM staking_events")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM positions")).rows[0].n).toBe(0);
    expect(Number((await db.query("SELECT last_block FROM indexer_cursor")).rows[0].last_block)).toBe(d.startBlock - 1);

    idx.afterEvent = null;
    await idx.catchUp();
    expect(await snapshotDb(db)).toEqual(await reference(d));
  });

  test("re-reading an already indexed range (cursor rewound by hand) changes nothing", async () => {
    const d = await deployStaking();
    await scenario(d);
    const idx = await makeIndexer(db, d);
    await idx.catchUp();
    const once = await snapshotDb(db);

    await db.query("UPDATE indexer_cursor SET last_block = $1, last_block_hash = NULL", [d.startBlock - 1]);
    const r = await idx.tick();
    expect(r?.events).toBe(8);
    expect(r?.inserted).toBe(0); // every event was already there: no projection updates
    expect(await snapshotDb(db)).toEqual(once);
  });

  test("two indexers racing on the same database apply each batch once", async () => {
    const d = await deployStaking();
    await scenario(d);
    const [a, b] = [await makeIndexer(db, d, { batchSize: 2 }), await makeIndexer(db, d, { batchSize: 2 })];
    await Promise.all([a.catchUp(), b.catchUp()]);
    expect(await snapshotDb(db)).toEqual(await reference(d));
  });
  test("an indexer that read a stale cursor skips its batch instead of moving the cursor back", async () => {
    const d = await deployStaking();
    await scenario(d);
    const a = await makeIndexer(db, d);
    const slow: Chain = {
      getBlockNumber: () => d.provider.getBlockNumber(),
      getBlock: (n) => d.provider.getBlock(n),
      getLogs: async (f) => {
        await a.catchUp(); // A indexes everything while B is mid-request with an old cursor
        return d.provider.getLogs(f);
      },
    };
    const b = await makeIndexer(db, d, { chain: slow, batchSize: 3 });
    const r = await b.tick();
    expect(r?.inserted).toBe(0);
    const head = await d.provider.getBlockNumber();
    expect(Number((await db.query("SELECT last_block FROM indexer_cursor")).rows[0].last_block)).toBe(head);
    expect(await snapshotDb(db)).toEqual(await reference(d));
  });
});

describe("RPC limits and failures", () => {
  test("shrinks the getLogs range when the RPC rejects it as too large", async () => {
    const d = await deployStaking();
    await scenario(d);
    let rejected = 0;
    const limited: Chain = {
      getBlockNumber: () => d.provider.getBlockNumber(),
      getBlock: (n) => d.provider.getBlock(n),
      getLogs: async (f) => {
        if (f.toBlock - f.fromBlock + 1 > 3) {
          rejected++;
          throw new Error("eth_getLogs is limited to a 3 block range"); // Alchemy-style message
        }
        return d.provider.getLogs(f);
      },
    };
    const idx = await makeIndexer(db, d, { chain: limited, batchSize: 100 });
    await idx.catchUp();
    expect(rejected).toBeGreaterThan(0);
    expect(idx.currentBatchSize).toBeLessThanOrEqual(3);
    expect(await snapshotDb(db)).toEqual(await reference(d));
  });

  test("other RPC errors are not mistaken for range errors", async () => {
    const d = await deployStaking();
    const broken: Chain = {
      getBlockNumber: () => d.provider.getBlockNumber(),
      getBlock: (n) => d.provider.getBlock(n),
      getLogs: async () => {
        throw new Error("connection refused");
      },
    };
    const idx = await makeIndexer(db, d, { chain: broken, batchSize: 100 });
    await expect(idx.tick()).rejects.toThrow("connection refused");
    expect(idx.currentBatchSize).toBe(100);
  });

  test("a reorg deeper than the confirmation depth halts the indexer", async () => {
    const d = await deployStaking();
    const snap = await d.provider.send("evm_snapshot", []);
    await (await as(d.staking, d.alice).stake(parseEther("1000"), 0)).wait();
    const idx = await makeIndexer(db, d, { confirmations: 0 });
    await idx.catchUp();
    const indexed = await snapshotDb(db);

    // Replace the indexed blocks with a different history (what a deep reorg looks like).
    await d.provider.send("evm_revert", [snap]);
    await (await as(d.staking, d.bob).stake(parseEther("5"), 1)).wait();
    await mine(d.provider, 3);

    await expect(idx.tick()).rejects.toBeInstanceOf(ReorgError);
    expect(idx.status.state).toBe("halted");
    expect(idx.status.lastError).toMatch(/reorg deeper than the confirmation depth/);
    expect(await snapshotDb(db)).toEqual(indexed); // nothing written from the new branch
    await expect(idx.run(10)).resolves.toBeUndefined(); // run() exits instead of looping
  });

  test("an event for a position it never saw staked means START_BLOCK is wrong", async () => {
    const d = await deployStaking();
    await (await as(d.staking, d.alice).stake(parseEther("1000"), 0)).wait();
    const late = await d.provider.getBlockNumber();
    await increaseTime(d.provider, DAY);
    await (await as(d.staking, d.alice).claimRewards(0)).wait();
    const idx = await makeIndexer(db, d, { startBlock: late + 1 });
    await expect(idx.catchUp()).rejects.toThrow(/START_BLOCK/);
    expect((await db.query("SELECT count(*)::int AS n FROM staking_events")).rows[0].n).toBe(0);
  });
});

