// Runs the embedded test Postgres in its OWN process. embedded-postgres installs an exit hook
// (async-exit-hook) that calls process.exit(0) on "beforeExit"; inside the vitest process that
// overwrote vitest's exit code, so failing tests exited 0. Isolated here, it can't.
// Prints "READY <url>" when up; stops Postgres cleanly on SIGTERM.
import { rmSync } from "node:fs";
import { startEmbeddedPostgres } from "./embedded-pg.ts";

const [dir, port] = [process.argv[2]!, Number(process.argv[3])];
rmSync(dir, { recursive: true, force: true });
const pg = await startEmbeddedPostgres({ dir, port, persistent: false });
console.log(`READY ${pg.url}`);
setInterval(() => {}, 1 << 30); // stay alive until the parent sends SIGTERM
