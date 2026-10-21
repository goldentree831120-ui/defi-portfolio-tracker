// Read-only REST API over the indexed data. Every input is validated with zod; every error
// is a typed { error: { code, message, details? } } body. Nothing here touches the RPC or
// any secret: the API only reads Postgres.

import Fastify, { type FastifyInstance } from "fastify";
import { getAddress, isAddress } from "ethers";
import { z } from "zod";
import type { Db } from "./db.ts";
import { ApiError } from "./errors.ts";
import type { IndexerStatus } from "./indexer.ts";

export interface ApiDeps {
  db: Db;
  chainId: number;
  contract: string;
  confirmations: number;
  corsOrigins: string[];
  status: () => IndexerStatus;
  logger?: boolean | object;
}

const addressParam = z.object({ address: z.string() });

const positionsQuery = z
  .object({ status: z.enum(["open", "withdrawn", "all"]).default("all") })
  .strict();

const eventsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.coerce.number().int().min(1).optional(), // keyset cursor: event id
  })
  .strict();

function parseAddress(params: unknown): string {
  const { address } = addressParam.parse(params);
  if (!isAddress(address)) {
    throw new ApiError(400, "INVALID_ADDRESS", "not a valid Ethereum address (40 hex chars; mixed case must match its checksum)", {
      address,
    });
  }
  return getAddress(address);
}

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const r = schema.safeParse(query ?? {});
  if (!r.success) {
    throw new ApiError(
      400,
      "INVALID_QUERY",
      "invalid query parameters",
      r.error.issues.map((i) => ({ param: i.path.join(".") || null, problem: i.message })),
    );
  }
  return r.data;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const num = (v: string | null) => (v === null ? null : Number(v));

export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const scope = [deps.chainId, deps.contract];

  // CORS: GET only, for the configured front-end origins. No credentials, nothing to protect
  // beyond public chain data, but no reason to let every site read it either.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && deps.corsOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin");
    }
    reply.header("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET").header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send(err.toBody());
    if (err instanceof z.ZodError) {
      return reply.code(400).send(new ApiError(400, "INVALID_QUERY", "invalid request", err.issues).toBody());
    }
    req.log.error(err);
    return reply.code(500).send(new ApiError(500, "INTERNAL", "internal error").toBody());
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send(new ApiError(404, "NOT_FOUND", `no route ${req.method} ${req.url.split("?")[0]}`).toBody()),
  );

  app.get("/health", async (_req, reply) => {
    try {
      await deps.db.query("SELECT 1");
    } catch {
      return reply.code(503).send(new ApiError(503, "SERVICE_UNAVAILABLE", "database unreachable").toBody());
    }
    const s = deps.status();
    return { status: s.state === "halted" ? "degraded" : "ok", indexer: s.state };
  });

  app.get("/v1/status", async () => {
    const s = deps.status();
    const lag = s.headBlock !== null && s.lastIndexedBlock !== null ? s.headBlock - s.lastIndexedBlock : null;
    return {
      chainId: deps.chainId,
      contract: deps.contract,
      confirmations: deps.confirmations,
      ...s,
      lagBlocks: lag,
    };
  });

  app.get("/v1/wallets/:address/positions", async (req) => {
    const address = parseAddress(req.params);
    const { status } = parseQuery(positionsQuery, req.query);
    const filter = status === "all" ? "" : `AND withdrawn = ${status === "withdrawn"}`;
    const r = await deps.db.query(
      `SELECT * FROM positions WHERE chain_id = $1 AND contract = $2 AND user_address = $3 ${filter}
       ORDER BY position_id`,
      [...scope, address.toLowerCase()],
    );
    return {
      address,
      positions: r.rows.map((p) => ({
        positionId: p.position_id as string,
        amount: p.amount as string,
        lockDurationSeconds: Number(p.lock_duration),
        rewardRateBps: p.reward_rate_bps as number | null,
        startTime: iso(p.start_time),
        unlockTime: iso(p.unlock_time),
        rewardsClaimed: p.rewards_claimed as string,
        status: p.withdrawn ? "withdrawn" : "open",
        withdrawnAmount: p.withdrawn_amount as string | null,
        penalty: p.penalty as string | null,
        openedBlock: Number(p.opened_block),
        closedBlock: num(p.closed_block),
      })),
    };
  });

  app.get("/v1/wallets/:address/summary", async (req) => {
    const address = parseAddress(req.params);
    parseQuery(z.object({}).strict(), req.query);
    const r = await deps.db.query(
      `SELECT
         count(*) FILTER (WHERE NOT withdrawn)                         AS open_positions,
         count(*) FILTER (WHERE withdrawn)                             AS withdrawn_positions,
         coalesce(sum(amount) FILTER (WHERE NOT withdrawn), 0)::text   AS total_staked,
         coalesce(sum(rewards_claimed), 0)::text                       AS total_rewards_claimed,
         coalesce(sum(penalty), 0)::text                               AS total_penalties
       FROM positions WHERE chain_id = $1 AND contract = $2 AND user_address = $3`,
      [...scope, address.toLowerCase()],
    );
    const row = r.rows[0];
    return {
      address,
      openPositions: Number(row.open_positions),
      withdrawnPositions: Number(row.withdrawn_positions),
      totalStaked: row.total_staked as string,
      totalRewardsClaimed: row.total_rewards_claimed as string,
      totalPenalties: row.total_penalties as string,
      indexedToBlock: deps.status().lastIndexedBlock,
      note: "Indexed from confirmed events. Pending (unclaimed) rewards accrue every second and are read live from the contract, not stored here.",
    };
  });

  app.get("/v1/wallets/:address/events", async (req) => {
    const address = parseAddress(req.params);
    const { limit, before } = parseQuery(eventsQuery, req.query);
    const r = await deps.db.query(
      `SELECT id, event, block_number, block_time, tx_hash, log_index, position_id, amount, lock_duration, penalty
       FROM staking_events
       WHERE chain_id = $1 AND contract = $2 AND user_address = $3 AND ($4::bigint IS NULL OR id < $4)
       ORDER BY id DESC LIMIT $5`,
      [...scope, address.toLowerCase(), before ?? null, limit],
    );
    const events = r.rows.map((e) => ({
      id: Number(e.id),
      event: e.event as string,
      blockNumber: Number(e.block_number),
      blockTime: iso(e.block_time),
      txHash: e.tx_hash as string,
      logIndex: e.log_index as number,
      positionId: e.position_id as string,
      amount: e.amount as string,
      lockDurationSeconds: num(e.lock_duration),
      penalty: e.penalty as string | null,
    }));
    return {
      address,
      events,
      nextCursor: events.length === limit ? events[events.length - 1]!.id : null,
    };
  });

  return app;
}
