import { isAddress, getAddress } from "ethers";
import { z } from "zod";

const int = (min: number) => z.coerce.number().int().min(min);

const schema = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
  CHAIN_ID: int(1),
  STAKING_ADDRESS: z
    .string()
    .refine(isAddress, "must be a valid address")
    .transform((a) => getAddress(a)),
  START_BLOCK: int(0).default(0),
  CONFIRMATIONS: int(0).default(12),
  POLL_INTERVAL_MS: int(250).default(12_000),
  BATCH_SIZE: int(1).default(500),
  HOST: z.string().default("127.0.0.1"),
  PORT: int(0).default(3001),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

/** Parse and validate the environment. Fails fast with every problem listed, never echoing values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`invalid configuration:\n${problems.join("\n")}`);
  }
  return parsed.data;
}
