// Polling indexer for the Staking contract.
//
// Guarantees (each one has a test in test/indexer.test.ts):
// 1. Confirmation depth: a block is only read once it has CONFIRMATIONS blocks on top of it,
//    so ordinary reorgs (which replace recent blocks) never reach the database.
// 2. Exactly-once effects: the events of a block range AND the cursor that says "indexed up
//    to here" are written in ONE transaction. A crash anywhere rolls back both, and the next
//    run re-reads the same range. Each event row is unique on (chain, tx hash, log index) and
//    the positions projection is only updated for rows that were actually inserted, so even
//    re-reading an already-indexed range (cursor rewound by hand) cannot double count.
// 3. One writer: the cursor row is locked FOR UPDATE and re-checked inside the transaction,
//    so two indexer processes can't both apply the same range.
// 4. Deep-reorg detection: before each batch the stored hash of the last indexed block is
//    compared with the chain. If they differ, a reorg deeper than the confirmation depth
//    happened; the indexer halts and reports it instead of building on a dead branch.

import type { Log } from "ethers";
import { EVENT_TOPICS, stakingAbi } from "./abi.ts";
import { withTx, type Db, type Tx } from "./db.ts";

/** The RPC calls the indexer needs; ethers' JsonRpcProvider satisfies it, tests can wrap it. */
export interface Chain {
  getBlockNumber(): Promise<number>;
  getBlock(n: number): Promise<{ hash: string | null; timestamp: number } | null>;
  getLogs(filter: {
    address: string;
    fromBlock: number;
    toBlock: number;
    topics: (string | string[] | null)[];
  }): Promise<Log[]>;
}

export interface IndexerOptions {
  chainId: number;
  contract: string; // checksummed
  startBlock: number;
  confirmations: number;
  batchSize: number;
  /** lockDuration (seconds) -> reward rate in bps, read from the contract at startup. */
  rewardRates: Map<bigint, number>;
}

export type IndexerState = "starting" | "running" | "caught-up" | "halted";

export interface IndexerStatus {
  state: IndexerState;
  lastIndexedBlock: number | null;
  headBlock: number | null;
  safeHead: number | null;
  lastError: string | null;
  lastTickAt: string | null;
}

export class ReorgError extends Error {
  constructor(block: number, stored: string, current: string | null) {
    super(
      `block ${block} changed after it was indexed (stored ${stored}, chain now ${current ?? "missing"}): ` +
        `a reorg deeper than the confirmation depth. Indexing halted; see README "Deep reorgs".`,
    );
    this.name = "ReorgError";
  }
}

export interface TickResult {
  from: number;
  to: number;
  events: number;
  inserted: number;
  caughtUp: boolean;
}

/** Test hook: called after each event row is written, inside the transaction. */
export type AfterEventHook = (index: number) => Promise<void> | void;

export class Indexer {
  readonly status: IndexerStatus = {
    state: "starting",
    lastIndexedBlock: null,
    headBlock: null,
    safeHead: null,
    lastError: null,
    lastTickAt: null,
  };
  private batch: number;
  private stopped = false;
  private wake: (() => void) | null = null;
  afterEvent: AfterEventHook | null = null;

  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly opts: IndexerOptions,
    private readonly log: (msg: string, extra?: object) => void = () => {},
  ) {
    this.batch = opts.batchSize;
  }

  get currentBatchSize() {
    return this.batch;
  }

  /** Index at most one batch. Returns what it did, or null if there was nothing new. */
  async tick(): Promise<TickResult | null> {
    if (this.status.state === "halted") throw new Error("indexer is halted");
    const { chainId, contract, confirmations } = this.opts;

    const head = await this.chain.getBlockNumber();
    const safe = head - confirmations;
    const cursor = await this.readCursor(this.db);
    this.status.headBlock = head;
    this.status.safeHead = safe;
    this.status.lastIndexedBlock = cursor.lastBlock >= this.opts.startBlock ? cursor.lastBlock : null;
    this.status.lastTickAt = new Date().toISOString();

    // Deep-reorg guard: is the block we last indexed still part of the chain?
    if (cursor.lastBlockHash) {
      const b = await this.chain.getBlock(cursor.lastBlock);
      if (b?.hash !== cursor.lastBlockHash) {
        const err = new ReorgError(cursor.lastBlock, cursor.lastBlockHash, b?.hash ?? null);
        this.status.state = "halted";
        this.status.lastError = err.message;
        throw err;
      }
    }

    if (safe <= cursor.lastBlock) {
      this.status.state = "caught-up";
      return null;
    }

    const from = cursor.lastBlock + 1;
    const { to, logs } = await this.fetchLogs(from, Math.min(cursor.lastBlock + this.batch, safe));
    const toBlock = await this.chain.getBlock(to);
    if (!toBlock?.hash) throw new Error(`block ${to} not available from the RPC`);

    // Block timestamps, one RPC call per distinct block that has events.
    const times = new Map<number, number>();
    for (const n of new Set(logs.map((l) => l.blockNumber))) {
      const b = await this.chain.getBlock(n);
      if (!b) throw new Error(`block ${n} not available from the RPC`);
      times.set(n, b.timestamp);
    }

    const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const inserted = await withTx(this.db, async (tx) => {
      const locked = await this.readCursor(tx, true);
      if (locked.lastBlock !== cursor.lastBlock) return -1; // another indexer got there first
      let count = 0;
      for (const [i, log] of ordered.entries()) {
        if (await this.applyLog(tx, log, times.get(log.blockNumber)!)) count++;
        await this.afterEvent?.(i);
      }
      await tx.query(
        `UPDATE indexer_cursor SET last_block = $3, last_block_hash = $4, updated_at = now()
         WHERE chain_id = $1 AND contract = $2`,
        [chainId, contract, to, toBlock.hash],
      );
      return count;
    });

    if (inserted < 0) {
      this.log("cursor moved under us (another indexer?); skipping batch", { from, to });
      return { from, to, events: 0, inserted: 0, caughtUp: false };
    }
    this.status.lastIndexedBlock = to;
    this.status.state = to >= safe ? "caught-up" : "running";
    this.status.lastError = null;
    if (ordered.length) this.log("indexed", { from, to, events: ordered.length, inserted });
    return { from, to, events: ordered.length, inserted, caughtUp: to >= safe };
  }

  /** Tick until caught up with the safe head. Used by tests and at startup. */
  async catchUp(): Promise<void> {
    for (;;) {
      const r = await this.tick();
      if (!r || r.caughtUp) return;
    }
  }

  /** Poll forever (until stop()). Transient RPC/DB errors back off and retry; a deep reorg halts. */
  async run(pollIntervalMs: number): Promise<void> {
    let backoff = pollIntervalMs;
    while (!this.stopped && this.status.state !== "halted") {
      try {
        const r = await this.tick();
        backoff = pollIntervalMs;
        if (r && !r.caughtUp) continue; // more to do: no sleep
      } catch (e) {
        if (e instanceof ReorgError) {
          this.log("HALTED", { error: e.message });
          break;
        }
        this.status.lastError = (e as Error).message;
        this.log("tick failed, retrying", { error: (e as Error).message, retryInMs: backoff });
        backoff = Math.min(backoff * 2, 60_000);
      }
      await this.sleep(backoff);
    }
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  /** eth_getLogs, halving the range while the RPC says it's too large (free tiers cap it). */
  private async fetchLogs(from: number, to: number): Promise<{ to: number; logs: Log[] }> {
    for (;;) {
      try {
        const logs = await this.chain.getLogs({
          address: this.opts.contract,
          fromBlock: from,
          toBlock: to,
          topics: [EVENT_TOPICS],
        });
        return { to, logs };
      } catch (e) {
        const size = to - from + 1;
        if (size <= 1 || !isRangeError(e)) throw e;
        this.batch = Math.max(1, Math.floor(size / 2));
        to = from + this.batch - 1;
        this.log("getLogs range too large; shrinking batch", { batchSize: this.batch });
      }
    }
  }

  private async readCursor(q: Db | Tx, forUpdate = false) {
    const { chainId, contract, startBlock } = this.opts;
    await q.query(
      `INSERT INTO indexer_cursor (chain_id, contract, last_block) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [chainId, contract, startBlock - 1],
    );
    const r = await q.query<{ last_block: string; last_block_hash: string | null }>(
      `SELECT last_block, last_block_hash FROM indexer_cursor WHERE chain_id = $1 AND contract = $2
       ${forUpdate ? "FOR UPDATE" : ""}`,
      [chainId, contract],
    );
    const row = r.rows[0]!;
    return { lastBlock: Number(row.last_block), lastBlockHash: row.last_block_hash };
  }

  /** Store one log; update the projection only if the row is new. Returns whether it was new. */
  private async applyLog(tx: Tx, log: Log, timestamp: number): Promise<boolean> {
    const { chainId, contract } = this.opts;
    const parsed = stakingAbi.parseLog(log);
    if (!parsed) return false;
    const user = (parsed.args.user as string).toLowerCase();
    const positionId = (parsed.args.positionId as bigint).toString();
    const amount = (parsed.args.amount as bigint).toString();
    const lockDuration = parsed.name === "Staked" ? (parsed.args.lockDuration as bigint) : null;
    const penalty = parsed.name === "Withdrawn" ? (parsed.args.penalty as bigint).toString() : null;
    const blockTime = new Date(timestamp * 1000);

    const ins = await tx.query(
      `INSERT INTO staking_events
         (chain_id, contract, block_number, block_hash, block_time, tx_hash, log_index,
          event, user_address, position_id, amount, lock_duration, penalty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
       RETURNING id`,
      [
        chainId, contract, log.blockNumber, log.blockHash, blockTime, log.transactionHash, log.index,
        parsed.name, user, positionId, amount, lockDuration?.toString() ?? null, penalty,
      ],
    );
    if (ins.rowCount === 0) return false;

    const key = [chainId, contract, user, positionId];
    switch (parsed.name) {
      case "Staked": {
        const lock = lockDuration!;
        await tx.query(
          `INSERT INTO positions (chain_id, contract, user_address, position_id, amount, lock_duration,
                                  reward_rate_bps, start_time, unlock_time, opened_block)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            ...key, amount, lock.toString(), this.opts.rewardRates.get(lock) ?? null,
            blockTime, new Date((timestamp + Number(lock)) * 1000), log.blockNumber,
          ],
        );
        break;
      }
      case "RewardsClaimed":
        await this.updatePosition(tx, key, "rewards_claimed = rewards_claimed + $5", [amount]);
        break;
      case "Withdrawn":
        await this.updatePosition(
          tx,
          key,
          "withdrawn = true, withdrawn_amount = $5, penalty = $6, closed_block = $7",
          [amount, penalty, log.blockNumber],
        );
        break;
    }
    return true;
  }

  private async updatePosition(tx: Tx, key: unknown[], set: string, values: unknown[]) {
    const r = await tx.query(
      `UPDATE positions SET ${set}
       WHERE chain_id = $1 AND contract = $2 AND user_address = $3 AND position_id = $4`,
      [...key, ...values],
    );
    // Every claim/withdraw follows a Staked event in an earlier or the same batch. If not, the
    // indexer started after the contract's first stake: START_BLOCK is wrong.
    if (r.rowCount !== 1) {
      throw new Error(
        `event for unknown position ${String(key[3])} of ${String(key[2])}: is START_BLOCK after the deploy block?`,
      );
    }
  }
}

function isRangeError(e: unknown): boolean {
  const text = JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})) + String(e);
  return /block range|range (is )?too (large|wide)|too many (blocks|results|logs)|more than \d+ (results|logs)|response size|limit exceeded|exceed(s|ed)? (the )?max/i.test(
    text,
  );
}

/** Read the lock tiers from the contract so positions can show their APY. */
export async function loadRewardRates(
  call: (data: string) => Promise<string>,
): Promise<Map<bigint, number>> {
  const dec = (fn: string, data: string) => stakingAbi.decodeFunctionResult(fn, data);
  const count = dec("lockOptionsCount", await call(stakingAbi.encodeFunctionData("lockOptionsCount")))[0] as bigint;
  const rates = new Map<bigint, number>();
  for (let i = 0n; i < count; i++) {
    const r = dec("lockOptions", await call(stakingAbi.encodeFunctionData("lockOptions", [i])));
    rates.set(r[0] as bigint, Number(r[1] as bigint));
  }
  return rates;
}
