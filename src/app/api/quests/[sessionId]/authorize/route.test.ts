import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRuntimeEnv: vi.fn(),
  requireSessionUserId: vi.fn(),
  requireCampaignRuntimeReady: vi.fn(),
  getQuestCampaignSettlementIdentity: vi.fn(),
  authorizeQuestCompletion: vi.fn(),
}));

vi.mock("@/server/env", () => ({ requireRuntimeEnv: mocks.requireRuntimeEnv }));
vi.mock("@/server/auth/session", () => ({ requireSessionUserId: mocks.requireSessionUserId }));
vi.mock("@/server/chain/monad", () => ({ requireCampaignRuntimeReady: mocks.requireCampaignRuntimeReady }));
vi.mock("@/server/services/campaigns", () => ({
  getQuestCampaignSettlementIdentity: mocks.getQuestCampaignSettlementIdentity,
}));
vi.mock("@/server/services/settlements", () => ({
  authorizeQuestCompletion: mocks.authorizeQuestCompletion,
}));

import { POST } from "@/app/api/quests/[sessionId]/authorize/route";

const sessionId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000020";

function context() {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUserId.mockResolvedValue(userId);
  mocks.getQuestCampaignSettlementIdentity.mockResolvedValue({
    onchainCampaignId: BigInt(2),
    onchainRewardWei: BigInt(1_000),
  });
  mocks.authorizeQuestCompletion.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000030",
    status: "AUTHORIZED",
    sessionHash: `0x${"a".repeat(64)}`,
    chainId: 10_143,
  });
});

describe("quest authorization route", () => {
  it("preflights the exact campaign attached to the quest before authorization", async () => {
    const response = await POST(
      new Request(`http://localhost/api/quests/${sessionId}/authorize`, { method: "POST" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.getQuestCampaignSettlementIdentity).toHaveBeenCalledWith({ sessionId, userId });
    expect(mocks.requireCampaignRuntimeReady).toHaveBeenCalledWith(BigInt(2), BigInt(1_000));
    expect(mocks.authorizeQuestCompletion).toHaveBeenCalledWith({ sessionId, userId });
  });

  it("does not authorize when the selected campaign is not chain-ready", async () => {
    mocks.requireCampaignRuntimeReady.mockRejectedValueOnce(
      new Error("MONAD_PREFLIGHT_FAILED:CAMPAIGN_CAPACITY_EXHAUSTED"),
    );

    const response = await POST(
      new Request(`http://localhost/api/quests/${sessionId}/authorize`, { method: "POST" }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "MONAD_PREFLIGHT_FAILED:CAMPAIGN_CAPACITY_EXHAUSTED",
    });
    expect(mocks.authorizeQuestCompletion).not.toHaveBeenCalled();
  });
});
