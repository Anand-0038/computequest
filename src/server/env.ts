import { z } from "zod";

const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x-prefixed private key");

const runtimeEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  SESSION_SIGNING_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  MONAD_RPC_URL: z.string().url(),
  MONAD_CHAIN_ID: z.coerce.number().int().positive().default(10143),
  MONAD_EXPLORER_BASE_URL: z.string().url(),
  CAMPAIGN_ESCROW_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative(),
  VERIFIER_PRIVATE_KEY: privateKey,
  RELAYER_PRIVATE_KEY: privateKey,
  RELAYER_MIN_BALANCE_WEI: z.coerce.bigint().positive().default(BigInt("500000000000000000")),
  DEMO_CAMPAIGN_ID: z.string().uuid(),
  DEMO_ONCHAIN_CAMPAIGN_ID: z.coerce.bigint().positive(),
  DEMO_ONCHAIN_REWARD_WEI: z.coerce.bigint().positive(),
  DEMO_QUEST_SECONDS: z.coerce.number().int().min(10).max(300).default(20),
  DEMO_MAX_COMPLETIONS: z.coerce.number().int().min(1).max(1_000).default(20),
  DEMO_QUEST_ANSWER: z.string().trim().min(2).max(100),
});

const databaseEnvSchema = runtimeEnvSchema.pick({ DATABASE_URL: true });
const monadEnvSchema = runtimeEnvSchema.pick({
  MONAD_RPC_URL: true,
  MONAD_CHAIN_ID: true,
  MONAD_EXPLORER_BASE_URL: true,
  CAMPAIGN_ESCROW_ADDRESS: true,
  CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK: true,
  VERIFIER_PRIVATE_KEY: true,
  RELAYER_PRIVATE_KEY: true,
  RELAYER_MIN_BALANCE_WEI: true,
  DEMO_ONCHAIN_CAMPAIGN_ID: true,
  DEMO_ONCHAIN_REWARD_WEI: true,
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

export const requiredRuntimeKeys = Object.keys(runtimeEnvSchema.shape) as Array<
  keyof RuntimeEnv
>;

type EnvironmentSource = Record<string, string | undefined>;

export function inspectRuntimeEnv(source: EnvironmentSource = process.env) {
  const result = runtimeEnvSchema.safeParse(source);
  if (result.success) {
    return { configured: true as const, missing: [] as string[] };
  }

  const missing = result.error.issues.map((issue) => issue.path.join("."));
  return { configured: false as const, missing: [...new Set(missing)] };
}

export function requireRuntimeEnv(source: EnvironmentSource = process.env): RuntimeEnv {
  const result = runtimeEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`ComputeQuest runtime is not configured: ${names.join(", ")}`);
  }
  return result.data;
}

export function requireDatabaseEnv(source: EnvironmentSource = process.env) {
  const result = databaseEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error("ComputeQuest database is not configured: DATABASE_URL");
  }
  return result.data;
}

export function requireMonadEnv(source: EnvironmentSource = process.env) {
  const result = monadEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`ComputeQuest Monad runtime is not configured: ${names.join(", ")}`);
  }
  return result.data;
}
