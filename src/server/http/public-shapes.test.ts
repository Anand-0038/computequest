import { describe, expect, it } from "vitest";

import {
  publicJob,
  publicQuestSession,
  publicSettlementAttempt,
  publicSettlementResult,
  publicSettlementSnapshot,
} from "@/server/http/public-shapes";

const now = new Date("2026-08-28T12:00:00Z");

describe("public API shapes", () => {
  it("does not expose provider lease ownership", () => {
    const source = {
      id: "job-id",
      status: "PROCESSING",
      provider: "gemini",
      structuredResult: null,
      failureReason: null,
      refundedAt: null,
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
      processingToken: "server-only-token",
      processingStartedAt: now,
      providerRequestId: "provider-internal-id",
    };
    const result = publicJob(source);
    expect(result).not.toHaveProperty("processingToken");
    expect(result).not.toHaveProperty("processingStartedAt");
    expect(result).not.toHaveProperty("providerRequestId");
  });

  it("does not expose quest receipt material or ownership identifiers", () => {
    const source = {
      id: "quest-id",
      state: "ACTIVE",
      accumulatedActiveMs: 3_000,
      lastHeartbeatAt: now,
      lastHeartbeatSequence: 2,
      lastHeartbeatEligible: true,
      lastAttentionReason: "VERIFIED",
      serverStartedAt: now,
      completionAnsweredAt: null,
      claimedAt: null,
      updatedAt: now,
      nonce: "server-only-nonce",
      userId: "server-only-user",
      taskId: "server-only-task",
      campaignId: "server-only-campaign",
    };
    const result = publicQuestSession(source);
    expect(result).not.toHaveProperty("nonce");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("taskId");
    expect(result).not.toHaveProperty("campaignId");
  });

  it("serializes a settlement block number without a JSON-incompatible bigint", () => {
    const result = publicSettlementResult({
      settlementId: "00000000-0000-4000-8000-000000000001",
      transactionHash: `0x${"a".repeat(64)}`,
      blockNumber: BigInt(42),
      status: "CONFIRMED",
      taskId: "00000000-0000-4000-8000-000000000002",
      taskStatus: "FUNDED",
      balanceAfterCredit: 24,
    });

    expect(result.blockNumber).toBe("42");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("serializes persisted settlement snapshots for task recovery", () => {
    const result = publicSettlementSnapshot({
      id: "00000000-0000-4000-8000-000000000004",
      status: "CONFIRMED",
      sessionHash: "0xsession",
      transactionHash: "0xtx",
      blockNumber: BigInt(57_855_386),
      confirmedAt: new Date("2026-08-29T06:38:00.491Z"),
    });

    expect(result).toMatchObject({ status: "CONFIRMED", blockNumber: "57855386" });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("publishes sanitized append-only relay evidence with a serializable block number", () => {
    const result = publicSettlementAttempt({
      id: "00000000-0000-4000-8000-000000000003",
      attemptNumber: 2,
      transactionHash: `0x${"b".repeat(64)}`,
      status: "CONFIRMED",
      failureReason: null,
      blockNumber: BigInt(43),
      submittedAt: now,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(result).toMatchObject({ attemptNumber: 2, status: "CONFIRMED", blockNumber: "43" });
    expect(result).not.toHaveProperty("settlementId");
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
