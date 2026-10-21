import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Run `fn` in a transaction: COMMIT if it resolves, ROLLBACK if it throws. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    const out = await fn(tx);
    await tx.query("COMMIT");
    return out;
  } catch (e) {
    await tx.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

/**
 * Apply every src/migrations/NNN_*.sql not yet applied, in order, each in its own
 * transaction. An advisory lock stops two processes migrating at once.
 */
export async function migrate(db: Db): Promise<string[]> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  const lock = await db.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(72_617_001)");
    await lock.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await lock.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const f of files) {
      if (done.has(f)) continue;
      await lock.query("BEGIN");
      try {
        await lock.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
        await lock.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await lock.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await lock.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await lock.query("SELECT pg_advisory_unlock(72_617_001)").catch(() => {});
    lock.release();
  }
  return applied;
}
