import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRuntimeEnv: vi.fn(),
  requireSessionUserId: vi.fn(),
  getActiveCampaignSettlementIdentity: vi.fn(),
  requireCampaignRuntimeReady: vi.fn(),
  createQuestSession: vi.fn(),
  getQuestForTask: vi.fn(),
}));

vi.mock("@/server/env", () => ({ requireRuntimeEnv: mocks.requireRuntimeEnv }));
vi.mock("@/server/auth/session", () => ({ requireSessionUserId: mocks.requireSessionUserId }));
vi.mock("@/server/chain/monad", () => ({ requireCampaignRuntimeReady: mocks.requireCampaignRuntimeReady }));
vi.mock("@/server/services/campaigns", () => ({
  getActiveCampaignSettlementIdentity: mocks.getActiveCampaignSettlementIdentity,
}));
vi.mock("@/server/services/quests", () => ({
  createQuestSession: mocks.createQuestSession,
  getQuestForTask: mocks.getQuestForTask,
}));

import { POST } from "@/app/api/quests/route";

describe("quest campaign selection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionUserId.mockResolvedValue("00000000-0000-4000-8000-000000000001");
    mocks.getActiveCampaignSettlementIdentity.mockResolvedValue({
      onchainCampaignId: BigInt(2),
      onchainRewardWei: BigInt(1_000),
    });
    mocks.createQuestSession.mockResolvedValue({
      session: {
        id: "00000000-0000-4000-8000-000000000004",
        state: "CREATED",
        accumulatedActiveMs: 0,
        lastHeartbeatAt: null,
        lastHeartbeatSequence: 0,
        lastHeartbeatEligible: false,
        lastAttentionReason: "VIDEO_NOT_PLAYING",
        serverStartedAt: new Date(),
        completionAnsweredAt: null,
        claimedAt: null,
        updatedAt: new Date(),
      },
      campaign: { id: "00000000-0000-4000-8000-000000000002" },
    });
  });

  it("preflights and creates the exact campaign selected by the user", async () => {
    const campaignId = "00000000-0000-4000-8000-000000000002";
    const taskId = "00000000-0000-4000-8000-000000000003";
    const response = await POST(new Request("http://localhost/api/quests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, taskId }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.getActiveCampaignSettlementIdentity).toHaveBeenCalledWith(campaignId);
    expect(mocks.requireCampaignRuntimeReady).toHaveBeenCalledWith(BigInt(2), BigInt(1_000));
    expect(mocks.createQuestSession).toHaveBeenCalledWith({
      campaignId,
      taskId,
      userId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects a request that omits the campaign identity", async () => {
    const response = await POST(new Request("http://localhost/api/quests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "00000000-0000-4000-8000-000000000003" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createQuestSession).not.toHaveBeenCalled();
  });
});
