// Start a throwaway or persistent Postgres from the `embedded-postgres` npm package: no install,
// no Docker. Used by the tests (global-setup.ts) and by `npm run dev:local`.
import { existsSync } from "node:fs";

export async function startEmbeddedPostgres(opts: { dir: string; port: number; persistent: boolean; database?: string }) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const fresh = !existsSync(opts.dir);
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dir,
    user: "postgres",
    password: "postgres",
    port: opts.port,
    persistent: opts.persistent,
    // The library passes --lc-messages=en_US.UTF-8, which many Linux/WSL installs don't have
    // ("invalid locale name"). Later flags win, so force the always-present C locale.
    initdbFlags: ["--lc-messages=C", "--locale=C", "--encoding=UTF8"],
    // initdb refuses to run as root; the library can create a "postgres" user for it.
    createPostgresUser: process.getuid?.() === 0,
    onLog: () => {},
  });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh && opts.database) await pg.createDatabase(opts.database);
  const base = `postgres://postgres:postgres@127.0.0.1:${opts.port}`;
  return { url: `${base}/${opts.database ?? "postgres"}`, stop: () => pg.stop() };
}
