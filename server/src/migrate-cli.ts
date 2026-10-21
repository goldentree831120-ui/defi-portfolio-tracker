import { createPool, migrate } from "./db.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const db = createPool(url);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema is up to date");
} finally {
  await db.end();
}
