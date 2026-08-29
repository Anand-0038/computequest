import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRuntimeEnv: vi.fn(),
  requireSessionUserId: vi.fn(),
  requireCampaignRuntimeReady: vi.fn(),
  getQuestCampaignSettlementIdentity: vi.fn(),
  settleQuestCompletion: vi.fn(),
  runPresentationJob: vi.fn(),
  getTaskForUser: vi.fn(),
}));

vi.mock("@/server/env", () => ({ requireRuntimeEnv: mocks.requireRuntimeEnv }));
vi.mock("@/server/auth/session", () => ({ requireSessionUserId: mocks.requireSessionUserId }));
vi.mock("@/server/chain/monad", () => ({ requireCampaignRuntimeReady: mocks.requireCampaignRuntimeReady }));
vi.mock("@/server/services/campaigns", () => ({
  getQuestCampaignSettlementIdentity: mocks.getQuestCampaignSettlementIdentity,
}));
vi.mock("@/server/services/settlements", () => ({ settleQuestCompletion: mocks.settleQuestCompletion }));
vi.mock("@/server/services/jobs", () => ({ runPresentationJob: mocks.runPresentationJob }));
vi.mock("@/server/services/tasks", () => ({ getTaskForUser: mocks.getTaskForUser }));

import { POST } from "@/app/api/quests/[sessionId]/settle/route";

const sessionId = "00000000-0000-4000-8000-000000000010";
const taskId = "00000000-0000-4000-8000-000000000020";
const userId = "00000000-0000-4000-8000-000000000030";
const now = new Date("2026-08-29T06:00:00.000Z");
const settlement = {
  settlementId: "00000000-0000-4000-8000-000000000040",
  transactionHash: `0x${"a".repeat(64)}`,
  blockNumber: BigInt(10),
  status: "CONFIRMED" as const,
  taskId,
  taskStatus: "FUNDED",
};
const task = {
  id: taskId,
  userId,
  prompt: "Create a deck for ComputeQuest.",
  taskType: "PITCH_DECK",
  estimatedCost: 24,
  status: "COMPLETED",
  result: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
};
const job = {
  id: "00000000-0000-4000-8000-000000000050",
  taskId,
  status: "COMPLETED",
  provider: "gemini",
  providerRequestId: "gemini-response-id",
  attemptCount: 1,
  processingStartedAt: null,
  processingToken: null,
  structuredResult: { title: "Generated deck" },
  failureReason: null,
  refundedAt: null,
  createdAt: now,
  updatedAt: now,
};

function context() {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUserId.mockResolvedValue(userId);
  mocks.getQuestCampaignSettlementIdentity.mockResolvedValue({
    onchainCampaignId: BigInt(1),
    onchainRewardWei: BigInt(1),
  });
  mocks.settleQuestCompletion.mockResolvedValue(settlement);
});

describe("quest settlement route", () => {
  it("refuses settlement before touching state when the observed Monad preflight fails", async () => {
    mocks.requireCampaignRuntimeReady.mockRejectedValueOnce(
      new Error("MONAD_PREFLIGHT_FAILED:RELAYER_BALANCE_INSUFFICIENT"),
    );
    const response = await POST(new Request("http://localhost/api/quests/session/settle", { method: "POST" }), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "MONAD_PREFLIGHT_FAILED:RELAYER_BALANCE_INSUFFICIENT",
    });
    expect(mocks.settleQuestCompletion).not.toHaveBeenCalled();
  });

  it("automatically runs the funded job after confirmed settlement", async () => {
    mocks.runPresentationJob.mockResolvedValue({ task, job, execute: true });

    const response = await POST(new Request("http://localhost/api/quests/session/settle", { method: "POST" }), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runPresentationJob).toHaveBeenCalledWith({ taskId, userId });
    expect(body.generation).toMatchObject({ error: null, job: { status: "COMPLETED" } });
    expect(body.generation.job).not.toHaveProperty("providerRequestId");
    expect(body.generation.job).not.toHaveProperty("processingToken");
  });

  it("preserves confirmed settlement truth when Gemini fails and the spend is refunded", async () => {
    const refundedJob = { ...job, status: "REFUNDED", structuredResult: null, failureReason: "GEMINI_REQUEST_FAILED" };
    const failedTask = { ...task, status: "FAILED", failureReason: "GEMINI_REQUEST_FAILED" };
    mocks.runPresentationJob.mockRejectedValue(new Error("JOB_FAILED_AND_REFUNDED:GEMINI_REQUEST_FAILED"));
    mocks.getTaskForUser.mockResolvedValue({ task: failedTask, job: refundedJob });

    const response = await POST(new Request("http://localhost/api/quests/session/settle", { method: "POST" }), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("CONFIRMED");
    expect(body.transactionHash).toBe(settlement.transactionHash);
    expect(body.generation).toMatchObject({
      error: "JOB_FAILED_AND_REFUNDED:GEMINI_REQUEST_FAILED",
      job: { status: "REFUNDED" },
    });
  });
});
