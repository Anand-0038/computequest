import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCachedMonadPreflight: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/chain/monad", () => ({ getCachedMonadPreflight: mocks.getCachedMonadPreflight }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({ execute: mocks.execute }) }));

import { GET } from "@/app/api/health/route";

const completeRuntime = {
  DATABASE_URL: "postgresql://user:pass@example.com:5432/computequest",
  SESSION_SIGNING_SECRET: "a-secure-test-secret-with-at-least-32-characters",
  GEMINI_API_KEY: "configured-but-not-called",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
  MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  MONAD_CHAIN_ID: "10143",
  MONAD_EXPLORER_BASE_URL: "https://testnet.monadvision.com",
  CAMPAIGN_ESCROW_ADDRESS: `0x${"1".repeat(40)}`,
  VERIFIER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
  RELAYER_PRIVATE_KEY: `0x${"3".repeat(64)}`,
  RELAYER_MIN_BALANCE_WEI: "100",
  DEMO_CAMPAIGN_ID: "00000000-0000-4000-8000-000000000002",
  DEMO_ONCHAIN_CAMPAIGN_ID: "1",
  DEMO_ONCHAIN_REWARD_WEI: "1",
  DEMO_QUEST_SECONDS: "30",
  DEMO_MAX_COMPLETIONS: "20",
  DEMO_QUEST_ANSWER: "parallel execution",
};

const monadReady = {
  ready: true,
  checkedAt: "2026-08-29T06:00:00.000Z",
  chainId: 10143,
  escrowAddress: `0x${"1".repeat(40)}`,
  campaignId: "1",
  bytecodePresent: true,
  verifierMatches: true,
  campaignActive: true,
  rewardMatches: true,
  capacityAvailable: true,
  budgetSufficient: true,
  payoutRecipientMatchesRelayer: true,
  remainingBudgetWei: "20",
  remainingCompletions: "20",
  relayerAddress: `0x${"4".repeat(40)}`,
  relayerBalanceWei: "1000",
  minimumRelayerBalanceWei: "100",
  relayerBalanceSufficient: true,
  issues: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime health", () => {
  it("does not touch external services when configuration is incomplete", async () => {
    for (const key of Object.keys(completeRuntime)) vi.stubEnv(key, "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "configuration_required", monad: null });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.getCachedMonadPreflight).not.toHaveBeenCalled();
  });

  it("reports ready only after both database and observed Monad preflights pass", async () => {
    for (const [key, value] of Object.entries(completeRuntime)) vi.stubEnv(key, value);
    mocks.execute.mockResolvedValue([{ ready: 1 }]);
    mocks.getCachedMonadPreflight.mockResolvedValue(monadReady);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      services: { database: "observed_ready", escrow: "observed_deployed", relayer: "observed_funded" },
      issues: [],
    });
  });

  it("fails closed when observed Monad state is unsafe", async () => {
    for (const [key, value] of Object.entries(completeRuntime)) vi.stubEnv(key, value);
    mocks.execute.mockResolvedValue([{ ready: 1 }]);
    mocks.getCachedMonadPreflight.mockResolvedValue({
      ...monadReady,
      ready: false,
      relayerBalanceSufficient: false,
      issues: ["RELAYER_BALANCE_INSUFFICIENT"],
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "preflight_failed",
      issues: ["RELAYER_BALANCE_INSUFFICIENT"],
    });
  });
});
