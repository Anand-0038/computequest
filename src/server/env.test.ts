import { describe, expect, it } from "vitest";

import { inspectRuntimeEnv, requireDatabaseEnv, requireMonadEnv, requireRuntimeEnv } from "@/server/env";

const complete = {
  DATABASE_URL: "postgresql://user:pass@example.com:5432/computequest",
  SESSION_SIGNING_SECRET: "a-secure-test-secret-with-at-least-32-characters",
  GEMINI_API_KEY: "test-key-not-used",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
  MONAD_RPC_URL: "https://example.com/rpc",
  MONAD_CHAIN_ID: "10143",
  MONAD_EXPLORER_BASE_URL: "https://testnet.monadvision.com",
  CAMPAIGN_ESCROW_ADDRESS: `0x${"1".repeat(40)}`,
  CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK: "57853062",
  VERIFIER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
  RELAYER_PRIVATE_KEY: `0x${"3".repeat(64)}`,
  DEMO_CAMPAIGN_ID: "00000000-0000-4000-8000-000000000002",
  DEMO_ONCHAIN_CAMPAIGN_ID: "1",
  DEMO_ONCHAIN_REWARD_WEI: "1000000000000000",
  DEMO_QUEST_SECONDS: "30",
  DEMO_MAX_COMPLETIONS: "20",
  DEMO_QUEST_ANSWER: "parallel execution",
};

describe("runtime environment", () => {
  it("fails closed and names missing integrations", () => {
    const status = inspectRuntimeEnv({});
    expect(status.configured).toBe(false);
    expect(status.missing).toContain("DATABASE_URL");
    expect(status.missing).toContain("MONAD_RPC_URL");
    expect(() => requireRuntimeEnv({})).toThrow("runtime is not configured");
  });

  it("accepts a complete real-service configuration shape", () => {
    const status = inspectRuntimeEnv(complete);
    expect(status).toEqual({ configured: true, missing: [] });
    expect(requireRuntimeEnv(complete).MONAD_CHAIN_ID).toBe(10143);
  });
});

describe("database environment", () => {
  it("allows isolated database tooling without unrelated provider credentials", () => {
    expect(requireDatabaseEnv({ DATABASE_URL: complete.DATABASE_URL })).toEqual({
      DATABASE_URL: complete.DATABASE_URL,
    });
  });

  it("rejects a missing or non-PostgreSQL database URL", () => {
    expect(() => requireDatabaseEnv({})).toThrow("DATABASE_URL");
    expect(() => requireDatabaseEnv({ DATABASE_URL: "https://example.com" })).toThrow("DATABASE_URL");
  });
});

describe("Monad environment", () => {
  it("allows isolated deployment validation without database or Gemini credentials", () => {
    const monad = requireMonadEnv(complete);
    expect(monad).toMatchObject({ MONAD_CHAIN_ID: 10143, DEMO_ONCHAIN_CAMPAIGN_ID: BigInt(1) });
    expect(monad).not.toHaveProperty("DATABASE_URL");
    expect(monad).not.toHaveProperty("GEMINI_API_KEY");
  });
});
