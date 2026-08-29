import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { keccak256, stringToHex } from "viem";

import { INITIAL_DEMO_BALANCE, QUEST_REWARD, TASK_COST } from "@/domain/constants";
import { QUEST_SESSION_TTL_MS } from "@/domain/quest";
import { buildCompletionReceipt, storeCompletionReceipt } from "@/domain/settlement";
import { closeDatabase, getDatabase } from "@/server/db/client";
import {
  attentionEvents,
  campaignRewardClaims,
  campaigns,
  creditEntries,
  questSessions,
  settlementAttempts,
  settlements,
  tasks,
  users,
} from "@/server/db/schema";
import * as monad from "@/server/chain/monad";
import { upsertDemoCampaign } from "@/server/services/campaigns";
import { createQuestSession, recordHeartbeat } from "@/server/services/quests";
import { authorizeQuestCompletion, settleQuestCompletion } from "@/server/services/settlements";
import { createPresentationTask, getCreditBalance } from "@/server/services/tasks";

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;

describe.skipIf(!integrationDatabaseUrl)("PostgreSQL service integration", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env[`GEMINI_${"API_KEY"}`] = "x";
    Object.assign(process.env, {
      SESSION_SIGNING_SECRET: "x".repeat(32),
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
      MONAD_CHAIN_ID: "10143",
      MONAD_EXPLORER_BASE_URL: "https://testnet.monadvision.com",
      CAMPAIGN_ESCROW_ADDRESS: `0x${"1".repeat(40)}`,
      VERIFIER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
      RELAYER_PRIVATE_KEY: `0x${"3".repeat(64)}`,
      DEMO_CAMPAIGN_ID: "00000000-0000-4000-8000-000000000002",
      DEMO_ONCHAIN_CAMPAIGN_ID: "1",
      DEMO_ONCHAIN_REWARD_WEI: "1",
      DEMO_QUEST_SECONDS: "30",
      DEMO_MAX_COMPLETIONS: "20",
      DEMO_QUEST_ANSWER: "parallel execution",
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await getDatabase().execute(sql`
      truncate table campaign_reward_claims, settlement_attempts, settlements, quest_sessions, jobs, tasks, credit_entries, campaigns, users cascade
    `);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDatabase();
  });

  it("persists the canonical 4 CE balance and 20 CE task shortage", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(creditEntries).values({
      id: crypto.randomUUID(),
      userId,
      amount: INITIAL_DEMO_BALANCE,
      type: "INITIAL_GRANT",
      referenceId: userId,
      idempotencyKey: `initial-grant:${userId}`,
    });

    const created = await createPresentationTask({
      userId,
      prompt: "Create a concise launch deck for a developer infrastructure product.",
    });

    expect(created.task.status).toBe("AWAITING_CREDITS");
    expect(created.task.estimatedCost).toBe(TASK_COST);
    expect(created.balance).toBe(INITIAL_DEMO_BALANCE);
    expect(created.shortage).toBe(TASK_COST - INITIAL_DEMO_BALANCE);
    expect(await getCreditBalance(userId)).toBe(INITIAL_DEMO_BALANCE);
  });

  it("serializes concurrent task spending so credits never become negative", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(creditEntries).values({
      id: crypto.randomUUID(),
      userId,
      amount: TASK_COST,
      type: "INITIAL_GRANT",
      referenceId: userId,
      idempotencyKey: `initial-grant:${userId}`,
    });

    const created = await Promise.all([
      createPresentationTask({ userId, prompt: "Create the first concurrent infrastructure deck." }),
      createPresentationTask({ userId, prompt: "Create the second concurrent infrastructure deck." }),
    ]);

    expect(created.map((entry) => entry.task.status).sort()).toEqual(["AWAITING_CREDITS", "FUNDED"]);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("allows one campaign reward per user while preserving the original quest authorization", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const answer = "parallel execution";
    await db.insert(users).values({ id: userId });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex(answer)),
      remainingBudget: QUEST_REWARD * 2,
      active: true,
    });
    const [firstTask, secondTask] = await Promise.all([
      createPresentationTask({ userId, prompt: "Create the first campaign-funded deck." }),
      createPresentationTask({ userId, prompt: "Create the second campaign-funded deck." }),
    ]);
    const firstQuest = await createQuestSession({ campaignId, taskId: firstTask.task.id, userId });
    const secondQuest = await createQuestSession({ campaignId, taskId: secondTask.task.id, userId });
    await db
      .update(questSessions)
      .set({ state: "ACTIVE", accumulatedActiveMs: 30_000 })
      .where(eq(questSessions.userId, userId));
    vi.spyOn(monad, "assertOnchainVerifier").mockResolvedValue({
      signTypedData: vi.fn().mockResolvedValue(`0x${"4".repeat(130)}`),
    } as never);

    const firstAuthorization = await authorizeQuestCompletion({
      sessionId: firstQuest.session.id,
      userId,
      answer,
    });
    await expect(
      authorizeQuestCompletion({ sessionId: secondQuest.session.id, userId, answer }),
    ).rejects.toThrow("CAMPAIGN_REWARD_ALREADY_CLAIMED");

    expect(firstAuthorization.status).toBe("AUTHORIZED");
    const claims = await db
      .select()
      .from(campaignRewardClaims)
      .where(eq(campaignRewardClaims.userId, userId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      campaignId,
      questSessionId: firstQuest.session.id,
      settlementId: firstAuthorization.id,
      status: "RESERVED",
    });
  });

  it("serializes settlement crediting against concurrent task creation", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(creditEntries).values({
      id: crypto.randomUUID(),
      userId,
      amount: INITIAL_DEMO_BALANCE,
      type: "INITIAL_GRANT",
      referenceId: userId,
      idempotencyKey: `initial-grant:${userId}`,
    });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const fundedByQuest = await createPresentationTask({
      userId,
      prompt: "Create the campaign-funded infrastructure deck.",
    });
    const quest = await createQuestSession({ campaignId, taskId: fundedByQuest.task.id, userId });
    const settlementId = crypto.randomUUID();
    const transactionHash = `0x${"7".repeat(64)}`;
    const receipt = buildCompletionReceipt({
      campaignId: BigInt(1),
      sessionId: quest.session.id,
      sessionNonce: quest.session.nonce,
      userId,
      reward: BigInt(1),
      issuedAtSeconds: BigInt(Math.floor(Date.now() / 1_000)),
    });
    await db.insert(settlements).values({
      id: settlementId,
      questSessionId: quest.session.id,
      sessionHash: receipt.sessionHash,
      receipt: storeCompletionReceipt(receipt),
      signature: `0x${"1".repeat(130)}`,
      transactionHash,
      chainId: 10143,
      status: "CONFIRMED",
      authorizedAt: new Date(),
      confirmedAt: new Date(),
    });
    await db.update(questSessions).set({ state: "SETTLED" }).where(eq(questSessions.id, quest.session.id));

    await Promise.all([
      settleQuestCompletion({ sessionId: quest.session.id, userId }),
      createPresentationTask({ userId, prompt: "Create a task racing the confirmed settlement." }),
    ]);

    const userTasks = await db.select().from(tasks).where(eq(tasks.userId, userId));
    expect(userTasks.map((task) => task.status).sort()).toEqual(["AWAITING_CREDITS", "FUNDED"]);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("preserves consumed campaign budget across restarts and resets only for a new onchain campaign", async () => {
    const db = getDatabase();
    const campaignId = crypto.randomUUID();
    const metadata = {
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution in 30 seconds",
      completionQuestion: "What execution model runs independent work concurrently?",
      completionAnswerHash: "hash",
      fullBudget: 400,
    };
    await upsertDemoCampaign(metadata);
    await db.update(campaigns).set({ remainingBudget: 260 }).where(eq(campaigns.id, campaignId));

    const restarted = await upsertDemoCampaign(metadata);
    expect(restarted.remainingBudget).toBe(260);

    const rolledOver = await upsertDemoCampaign({ ...metadata, onchainCampaignId: BigInt(2) });
    expect(rolledOver.remainingBudget).toBe(400);
    expect(rolledOver.onchainCampaignId).toBe(BigInt(2));
  });

  it("persists a pause boundary and credits only the following continuous eligible interval", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({
      userId,
      prompt: "Create a pitch deck for ComputeQuest.",
    });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });

    const active = {
      documentVisible: true,
      windowFocused: true,
      mediaPlaying: true,
      fullscreen: true,
      pictureInPicture: false,
      buffering: false,
      playbackRate: 1,
      durationMs: 40_000,
    };
    const startedAt = quest.session.serverStartedAt;
    await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 1, ...active, mediaTimeMs: 0 },
      now: startedAt,
    });
    await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 2, ...active, mediaTimeMs: 3_000, documentVisible: false },
      now: new Date(startedAt.getTime() + 3_000),
    });
    await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 3, ...active, mediaTimeMs: 6_000 },
      now: new Date(startedAt.getTime() + 6_000),
    });
    const continuous = await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 4, ...active, mediaTimeMs: 9_000 },
      now: new Date(startedAt.getTime() + 9_000),
    });

    expect(continuous.accumulatedActiveMs).toBe(3_000);
    expect(continuous.lastHeartbeatEligible).toBe(true);
    expect(continuous.state).toBe("ACTIVE");
    const [persisted] = await db
      .select()
      .from(questSessions)
      .where(eq(questSessions.id, quest.session.id));
    expect(persisted.accumulatedActiveMs).toBe(3_000);
    const evidence = await db
      .select()
      .from(attentionEvents)
      .where(eq(attentionEvents.questSessionId, quest.session.id));
    expect(evidence).toHaveLength(4);
    expect(evidence.map((event) => event.reason)).toEqual([
      "VERIFIED",
      "DOCUMENT_HIDDEN",
      "VERIFIED",
      "VERIFIED",
    ]);
    expect(evidence.every((event) => /^[0-9a-f]{64}$/.test(event.eventHash))).toBe(true);
  });

  it("expires a stale attempt and safely renews the same task with a fresh nonce", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({ userId, prompt: "Create a pitch deck for ComputeQuest." });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    const staleStart = new Date("2026-08-29T06:00:00.000Z");
    await db
      .update(questSessions)
      .set({ serverStartedAt: staleStart })
      .where(eq(questSessions.id, quest.session.id));

    await expect(
      recordHeartbeat({
        sessionId: quest.session.id,
        userId,
        heartbeat: {
          sequence: 1,
          documentVisible: true,
          windowFocused: true,
          mediaPlaying: true,
          fullscreen: true,
          pictureInPicture: false,
          buffering: false,
          playbackRate: 1,
          mediaTimeMs: 0,
          durationMs: 40_000,
        },
        now: new Date(staleStart.getTime() + QUEST_SESSION_TTL_MS),
      }),
    ).rejects.toThrow("QUEST_EXPIRED");
    const [expired] = await db.select().from(questSessions).where(eq(questSessions.id, quest.session.id));
    expect(expired.state).toBe("EXPIRED");

    const renewed = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    expect(renewed.session.id).toBe(quest.session.id);
    expect(renewed.session.nonce).not.toBe(quest.session.nonce);
    expect(renewed.session.state).toBe("CREATED");
    expect(renewed.session.accumulatedActiveMs).toBe(0);
    expect(renewed.session.lastHeartbeatSequence).toBe(0);

    await db
      .update(questSessions)
      .set({ state: "AUTHORIZED", serverStartedAt: staleStart })
      .where(eq(questSessions.id, quest.session.id));
    await expect(createQuestSession({ campaignId, taskId: task.task.id, userId })).rejects.toThrow(
      "QUEST_ALREADY_EXISTS",
    );
  });

  it("persists an expired pre-relay authorization as a recoverable settlement failure", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({ userId, prompt: "Create a pitch deck for ComputeQuest." });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    const receipt = buildCompletionReceipt({
      campaignId: BigInt(1),
      sessionId: quest.session.id,
      sessionNonce: quest.session.nonce,
      userId,
      reward: BigInt(1),
      issuedAtSeconds: BigInt(1),
    });
    const settlementId = crypto.randomUUID();
    await db.insert(settlements).values({
      id: settlementId,
      questSessionId: quest.session.id,
      sessionHash: receipt.sessionHash,
      receipt: storeCompletionReceipt(receipt),
      signature: `0x${"1".repeat(130)}`,
      chainId: 10143,
      status: "AUTHORIZED",
      authorizedAt: new Date(1_000),
    });
    await db.update(questSessions).set({ state: "AUTHORIZED" }).where(eq(questSessions.id, quest.session.id));

    await expect(settleQuestCompletion({ sessionId: quest.session.id, userId })).rejects.toThrow(
      "SETTLEMENT_RECEIPT_EXPIRED_REAUTHORIZE",
    );
    const [failed] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
    const [failedQuest] = await db.select().from(questSessions).where(eq(questSessions.id, quest.session.id));
    expect(failed).toMatchObject({ status: "FAILED", failureReason: "RECEIPT_EXPIRED", transactionHash: null });
    expect(failedQuest.state).toBe("SETTLEMENT_FAILED");
  });

  it("reauthorizes an expired pre-relay receipt only after answer validation", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const answer = "parallel execution";
    await db.insert(users).values({ id: userId });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex(answer)),
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({ userId, prompt: "Create a pitch deck for ComputeQuest." });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    const expiredReceipt = buildCompletionReceipt({
      campaignId: BigInt(1),
      sessionId: quest.session.id,
      sessionNonce: quest.session.nonce,
      userId,
      reward: BigInt(1),
      issuedAtSeconds: BigInt(1),
    });
    const settlementId = crypto.randomUUID();
    await db.insert(settlements).values({
      id: settlementId,
      questSessionId: quest.session.id,
      sessionHash: expiredReceipt.sessionHash,
      receipt: storeCompletionReceipt(expiredReceipt),
      signature: `0x${"1".repeat(130)}`,
      chainId: 10143,
      status: "FAILED",
      authorizedAt: new Date(1_000),
      failureReason: "RECEIPT_EXPIRED",
    });
    await db
      .update(questSessions)
      .set({ state: "SETTLEMENT_FAILED", accumulatedActiveMs: 30_000 })
      .where(eq(questSessions.id, quest.session.id));
    const signTypedData = vi.fn().mockResolvedValue(`0x${"4".repeat(130)}`);
    vi.spyOn(monad, "assertOnchainVerifier").mockResolvedValue({ signTypedData } as never);
    const now = new Date("2026-08-29T06:00:00.000Z");

    await expect(
      authorizeQuestCompletion({ sessionId: quest.session.id, userId, answer: "wrong answer", now }),
    ).rejects.toThrow("QUEST_ANSWER_INCORRECT");
    const refreshed = await authorizeQuestCompletion({ sessionId: quest.session.id, userId, answer, now });

    expect(refreshed.id).toBe(settlementId);
    expect(refreshed.status).toBe("AUTHORIZED");
    expect(refreshed.failureReason).toBeNull();
    expect(refreshed.transactionHash).toBeNull();
    expect(refreshed.sessionHash).toBe(expiredReceipt.sessionHash);
    expect(signTypedData).toHaveBeenCalledOnce();
    const [refreshedQuest] = await db.select().from(questSessions).where(eq(questSessions.id, quest.session.id));
    expect(refreshedQuest.state).toBe("AUTHORIZED");
  });

  it("preserves a reverted transaction and confirms a later relay attempt", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(creditEntries).values({
      id: crypto.randomUUID(),
      userId,
      amount: INITIAL_DEMO_BALANCE,
      type: "INITIAL_GRANT",
      referenceId: userId,
      idempotencyKey: `initial-grant:${userId}`,
    });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD * 2,
      active: true,
    });
    const task = await createPresentationTask({ userId, prompt: "Create a pitch deck for ComputeQuest." });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    const nowSeconds = BigInt(Math.floor(Date.now() / 1_000));
    const receipt = buildCompletionReceipt({
      campaignId: BigInt(1),
      sessionId: quest.session.id,
      sessionNonce: quest.session.nonce,
      userId,
      reward: BigInt(1),
      issuedAtSeconds: nowSeconds,
    });
    const settlementId = crypto.randomUUID();
    const revertedHash = `0x${"5".repeat(64)}`;
    const confirmedHash = `0x${"6".repeat(64)}` as `0x${string}`;
    await db.insert(settlements).values({
      id: settlementId,
      questSessionId: quest.session.id,
      sessionHash: receipt.sessionHash,
      receipt: storeCompletionReceipt(receipt),
      signature: `0x${"1".repeat(130)}`,
      transactionHash: revertedHash,
      chainId: 10143,
      status: "SUBMITTED",
      authorizedAt: new Date(),
    });
    await db.insert(settlementAttempts).values({
      id: crypto.randomUUID(),
      settlementId,
      attemptNumber: 1,
      transactionHash: revertedHash,
      status: "SUBMITTED",
      submittedAt: new Date(),
    });
    await db.update(questSessions).set({ state: "SETTLING" }).where(eq(questSessions.id, quest.session.id));
    vi.spyOn(monad, "waitForSettlement")
      .mockResolvedValueOnce({ status: "reverted", blockNumber: BigInt(120) } as never)
      .mockResolvedValueOnce({ status: "success", blockNumber: BigInt(121) } as never);

    await expect(settleQuestCompletion({ sessionId: quest.session.id, userId })).rejects.toThrow(
      "SETTLEMENT_TRANSACTION_REVERTED",
    );
    const [afterRevert] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
    expect(afterRevert).toMatchObject({
      status: "FAILED",
      transactionHash: null,
      failureReason: "TRANSACTION_REVERTED",
    });

    await db
      .update(settlements)
      .set({ updatedAt: new Date(Date.now() - 31_000) })
      .where(eq(settlements.id, settlementId));
    vi.spyOn(monad, "isSessionConsumed")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.spyOn(monad, "simulateCompletionSettlement").mockResolvedValue(undefined);
    vi.spyOn(monad, "submitCompletionSettlement").mockResolvedValue(confirmedHash);

    const confirmed = await settleQuestCompletion({ sessionId: quest.session.id, userId });
    expect(confirmed).toMatchObject({ status: "CONFIRMED", transactionHash: confirmedHash, taskStatus: "FUNDED" });
    const attempts = await db
      .select()
      .from(settlementAttempts)
      .where(eq(settlementAttempts.settlementId, settlementId))
      .orderBy(settlementAttempts.attemptNumber);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, status: "REVERTED", transactionHash: revertedHash });
    expect(attempts[1]).toMatchObject({ attemptNumber: 2, status: "CONFIRMED", transactionHash: confirmedHash });
    const [fundedTask] = await db.select().from(tasks).where(eq(tasks.id, task.task.id));
    expect(fundedTask.status).toBe("FUNDED");
  });
});
