import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseEther } from "ethers";
import type { FastifyInstance } from "fastify";
import { buildApi } from "../src/api.ts";
import { createPool, type Db } from "../src/db.ts";
import type { Indexer } from "../src/indexer.ts";
import { as, deployStaking, freshDb, increaseTime, makeIndexer, type Deployment } from "./support/fixtures.ts";

let db: Db;
let drop: () => Promise<void>;
let d: Deployment;
let idx: Indexer;
let app: FastifyInstance;
let alice: string; // checksummed

beforeAll(async () => {
  ({ db, drop } = await freshDb());
  d = await deployStaking();
  alice = await d.alice.getAddress();
  const s = d.staking;
  await (await as(s, d.alice).stake(parseEther("100"), 0)).wait();
  await (await as(s, d.alice).stake(parseEther("200"), 1)).wait();
  await (await as(s, d.alice).stake(parseEther("300"), 2)).wait();
  await increaseTime(d.provider, 5 * 86_400);
  await (await as(s, d.alice).withdraw(1)).wait(); // early: RewardsClaimed + Withdrawn, 10% penalty
  idx = await makeIndexer(db, d);
  await idx.catchUp();
  app = buildApi({
    db,
    chainId: 31337,
    contract: d.stakingAddress,
    confirmations: 0,
    corsOrigins: ["http://localhost:5173"],
    status: () => idx.status,
  });
});
afterAll(async () => {
  await app.close();
  await drop();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });

describe("wallet endpoints", () => {
  test("summary totals open stakes, claimed rewards and penalties", async () => {
    const r = await get(`/v1/wallets/${alice}/summary`);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({
      address: alice,
      openPositions: 2,
      withdrawnPositions: 1,
      totalStaked: parseEther("400").toString(),
      totalPenalties: parseEther("20").toString(),
    });
    expect(BigInt(body.totalRewardsClaimed)).toBeGreaterThan(0n);
    expect(body.indexedToBlock).toBe(await d.provider.getBlockNumber());
  });

  test("addresses are accepted in lower case and returned checksummed", async () => {
    const r = await get(`/v1/wallets/${alice.toLowerCase()}/summary`);
    expect(r.statusCode).toBe(200);
    expect(r.json().address).toBe(alice);
  });

  test("positions can be filtered by status", async () => {
    const all = (await get(`/v1/wallets/${alice}/positions`)).json().positions;
    expect(all.map((p: { positionId: string; status: string }) => [p.positionId, p.status])).toEqual([
      ["0", "open"],
      ["1", "withdrawn"],
      ["2", "open"],
    ]);
    expect(all[1]).toMatchObject({
      amount: parseEther("200").toString(),
      rewardRateBps: 1200,
      lockDurationSeconds: 90 * 86_400,
      penalty: parseEther("20").toString(),
      withdrawnAmount: parseEther("180").toString(),
    });
    const open = (await get(`/v1/wallets/${alice}/positions?status=open`)).json().positions;
    expect(open.map((p: { positionId: string }) => p.positionId)).toEqual(["0", "2"]);
  });

  test("events are paginated newest first with a keyset cursor, no gaps or repeats", async () => {
    const seen: number[] = [];
    let url = `/v1/wallets/${alice}/events?limit=2`;
    for (;;) {
      const body = (await get(url)).json();
      seen.push(...body.events.map((e: { id: number }) => e.id));
      if (body.nextCursor === null) break;
      url = `/v1/wallets/${alice}/events?limit=2&before=${body.nextCursor}`;
    }
    expect(seen).toHaveLength(5); // 3 Staked + RewardsClaimed + Withdrawn
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    expect(new Set(seen).size).toBe(5);
  });

  test("a wallet with no history is a valid, empty answer, not an error", async () => {
    const nobody = "0x000000000000000000000000000000000000dEaD";
    const r = await get(`/v1/wallets/${nobody}/summary`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ openPositions: 0, totalStaked: "0" });
  });
});

describe("typed errors", () => {
  test.each([
    ["not hex", "/v1/wallets/hello/summary"],
    ["too short", "/v1/wallets/0x1234/positions"],
    ["too long", "/v1/wallets/0x000000000000000000000000000000000000dEaD00/events"],
  ])("INVALID_ADDRESS: %s", async (_name, url) => {
    const r = await get(url);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_ADDRESS");
  });

  test("INVALID_ADDRESS: mixed case that doesn't match the checksum (likely a typo)", async () => {
    const i = alice.slice(2).search(/[a-fA-F]/) + 2; // flip the case of one letter
    const c = alice[i]!;
    const typo = alice.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + alice.slice(i + 1);
    const r = await get(`/v1/wallets/${typo}/summary`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatchObject({ code: "INVALID_ADDRESS", details: { address: typo } });
  });

  test.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=abc", "limit"],
    ["before=-1", "before"],
    ["colour=blue", ""],
  ])("INVALID_QUERY: %s", async (query, param) => {
    const r = await get(`/v1/wallets/${alice}/events?${query}`);
    expect(r.statusCode).toBe(400);
    const { error } = r.json();
    expect(error.code).toBe("INVALID_QUERY");
    if (param) expect(error.details[0].param).toBe(param);
  });

  test("status must be one of open, withdrawn, all", async () => {
    const r = await get(`/v1/wallets/${alice}/positions?status=closed`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_QUERY");
  });

  test("unknown routes are a typed 404", async () => {
    const r = await get("/v1/nope");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: { code: "NOT_FOUND", message: "no route GET /v1/nope" } });
  });

  test("a database failure is a 500 INTERNAL that leaks nothing; health reports 503", async () => {
    const dead = createPool("postgres://nobody:wrong@127.0.0.1:1/none");
    const broken = buildApi({ db: dead, chainId: 31337, contract: d.stakingAddress, confirmations: 0, corsOrigins: [], status: () => idx.status });
    const r = await broken.inject({ method: "GET", url: `/v1/wallets/${alice}/summary` });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: { code: "INTERNAL", message: "internal error" } });
    const h = await broken.inject({ method: "GET", url: "/health" });
    expect(h.statusCode).toBe(503);
    expect(h.json().error.code).toBe("SERVICE_UNAVAILABLE");
    await broken.close();
    await dead.end();
  });
});

describe("operational endpoints", () => {
  test("health and status", async () => {
    expect((await get("/health")).json()).toEqual({ status: "ok", indexer: "caught-up" });
    const s = (await get("/v1/status")).json();
    expect(s).toMatchObject({ chainId: 31337, contract: d.stakingAddress, state: "caught-up", lagBlocks: 0 });
  });

  test("CORS only for configured origins, GET only", async () => {
    const ok = await get("/health", { origin: "http://localhost:5173" });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await get("/health", { origin: "https://evil.example" });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await app.inject({ method: "OPTIONS", url: "/v1/status", headers: { origin: "http://localhost:5173" } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-methods"]).toBe("GET");
  });
});
