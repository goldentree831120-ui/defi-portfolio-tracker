// Starts the two things the tests need, unless already provided:
//   Postgres:  TEST_DATABASE_URL (an admin URL; each test file creates its own database),
//              otherwise an embedded Postgres in .pgdata/test (downloaded via npm, no install)
//   Chain:     TEST_RPC_URL, otherwise a Hardhat node on port 8547
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
    rpcUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const stops: (() => Promise<void>)[] = [];

  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const child = spawn(
      join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["test/support/pg-child.ts", join(process.cwd(), ".pgdata", "test"), "54331"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("embedded postgres did not start in 120 s")), 120_000);
      child.stdout!.on("data", (d: Buffer) => {
        if (d.toString().includes("READY")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error(`embedded postgres exited (${code}) before it was ready`)));
    });
    stops.push(
      () =>
        new Promise<void>((resolve) => {
          child.removeAllListeners("exit");
          child.on("exit", () => resolve());
          child.kill("SIGTERM");
        }),
    );
    adminUrl = "postgres://postgres:postgres@127.0.0.1:54331/postgres";
  }

  let rpcUrl = process.env.TEST_RPC_URL;
  let node: ChildProcess | undefined;
  if (!rpcUrl) {
    const port = 8547;
    node = spawn(
      join(process.cwd(), "node_modules", ".bin", "hardhat"),
      ["--config", "test/support/hardhat.config.cjs", "node", "--port", String(port)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("hardhat node did not start in 60 s")), 60_000);
      let out = "";
      node!.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
        if (out.includes("Started HTTP")) {
          clearTimeout(timer);
          resolve();
        }
      });
      node!.on("exit", (code) => reject(new Error(`hardhat node exited (${code}): ${out}`)));
    });
    rpcUrl = `http://127.0.0.1:${port}`;
    stops.push(async () => {
      node!.kill();
    });
  }

  project.provide("adminDatabaseUrl", adminUrl);
  project.provide("rpcUrl", rpcUrl);
  return async () => {
    for (const stop of stops.reverse()) await stop();
  };
}
