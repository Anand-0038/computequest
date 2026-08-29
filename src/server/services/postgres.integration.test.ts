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
  jobs,
  providerAttempts,
  sponsorInquiries,
} from "@/server/db/schema";
import * as gemini from "@/server/ai/gemini";
import * as monad from "@/server/chain/monad";
import { listEligibleCampaigns, upsertDemoCampaign } from "@/server/services/campaigns";
import { retryRefundedJob, runPresentationJob } from "@/server/services/jobs";
import { createQuestSession, recordHeartbeat } from "@/server/services/quests";
import { authorizeQuestCompletion, settleQuestCompletion } from "@/server/services/settlements";
import { createSponsorInquiry } from "@/server/services/sponsor-inquiries";
import { createPresentationTask, getCreditBalance } from "@/server/services/tasks";

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;

async function grantStarterCredits(userId: string) {
  await getDatabase().insert(creditEntries).values({
    id: crypto.randomUUID(),
    userId,
    amount: INITIAL_DEMO_BALANCE,
    type: "INITIAL_GRANT",
    referenceId: userId,
    idempotencyKey: `initial-grant:${userId}`,
  });
}

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
      CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK: "57853062",
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

  it("stores sponsor inquiries idempotently and enforces the daily per-session limit under concurrency", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    const base = {
      userId,
      companyName: "A2Z DTC",
      contactName: "Product Founder",
      contactEmail: "FOUNDER@example.com",
      companyWebsite: "https://www.a2zdtc.com",
      destinationUrl: "https://www.a2zdtc.com/products",
      creativeType: "VIDEO" as const,
      creativeUrl: "https://www.a2zdtc.com/creative.mp4",
      campaignTitle: "Commerce built for modern brands",
      description: "Introduce founders to a practical commerce product and invite them to learn more.",
      authorizationConfirmed: true as const,
      now: new Date("2026-08-29T10:00:00.000Z"),
    };
    const firstRequestId = crypto.randomUUID();
    const first = await createSponsorInquiry({ ...base, clientRequestId: firstRequestId });
    const retried = await createSponsorInquiry({ ...base, clientRequestId: firstRequestId });

    expect(first.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(retried.inquiry.id).toBe(first.inquiry.id);
    expect(first.inquiry.contactEmail).toBe("founder@example.com");

    const attempts = await Promise.allSettled([
      createSponsorInquiry({ ...base, clientRequestId: crypto.randomUUID(), campaignTitle: "Second campaign" }),
      createSponsorInquiry({ ...base, clientRequestId: crypto.randomUUID(), campaignTitle: "Third campaign" }),
      createSponsorInquiry({ ...base, clientRequestId: crypto.randomUUID(), campaignTitle: "Fourth campaign" }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: "SPONSOR_INQUIRY_RATE_LIMITED" }),
    });
    expect(await db.select().from(sponsorInquiries)).toHaveLength(3);
  });

  it("lists multiple funded campaigns and excludes a campaign already claimed by the user", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const firstCampaignId = crypto.randomUUID();
    const secondCampaignId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const questSessionId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await db.insert(tasks).values({
      id: taskId,
      userId,
      prompt: "Create a sponsor eligibility test deck.",
      estimatedCost: TASK_COST,
      status: "AWAITING_CREDITS",
    });
    await db.insert(campaigns).values([
      {
        id: firstCampaignId,
        onchainCampaignId: BigInt(1),
        creditReward: QUEST_REWARD,
        onchainRewardWei: BigInt(1),
        requiredActiveSeconds: 20,
        sponsorName: "Monad",
        creativeTitle: "Monad campaign",
        completionQuestion: "",
        completionAnswerHash: "0x01",
        remainingBudget: 400,
      },
      {
        id: secondCampaignId,
        onchainCampaignId: BigInt(2),
        creditReward: QUEST_REWARD,
        onchainRewardWei: BigInt(1),
        requiredActiveSeconds: 15,
        sponsorName: "PayZoll",
        creativeTitle: "PayZoll campaign",
        completionQuestion: "",
        completionAnswerHash: "0x02",
        remainingBudget: 400,
      },
    ]);
    await db.insert(questSessions).values({
      id: questSessionId,
      campaignId: firstCampaignId,
      userId,
      taskId,
      nonce: crypto.randomUUID(),
      serverStartedAt: new Date(),
    });
    await db.insert(campaignRewardClaims).values({
      id: crypto.randomUUID(),
      campaignId: firstCampaignId,
      userId,
      questSessionId,
      status: "CONFIRMED",
    });

    const eligible = await listEligibleCampaigns(userId);

    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({ id: secondCampaignId, sponsorName: "PayZoll", creditReward: 20 });
    expect(await listEligibleCampaigns(userId, 21)).toEqual([]);
  });

  it("rejects a campaign that cannot fully close the queued task funding gap", async () => {
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
    const task = await createPresentationTask({
      userId,
      prompt: "Create a task that requires the full twenty credit sponsor reward.",
    });
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: 10,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 15,
      creativeTitle: "Undersized reward",
      completionQuestion: "",
      completionAnswerHash: "0x01",
      remainingBudget: 100,
    });

    await expect(createQuestSession({ campaignId, taskId: task.task.id, userId })).rejects.toThrow(
      "CAMPAIGN_REWARD_TOO_SMALL_FOR_TASK",
    );
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
    expect(created.map((entry) => entry.balance)).toEqual([0, 0]);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("refunds every failed Gemini attempt exactly once and enforces the retry cap", async () => {
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
    const created = await createPresentationTask({
      userId,
      prompt: "Create a technical deck whose provider fails twice.",
    });
    const [job] = await db.select().from(jobs).where(eq(jobs.taskId, created.task.id));
    let providerCall = 0;
    vi.spyOn(gemini, "generatePresentation").mockImplementation(async () => {
      providerCall += 1;
      throw new gemini.GeminiAttemptError("GEMINI_REQUEST_FAILED:UNAVAILABLE", {
        providerRequestId: `failed-provider-request-${providerCall}`,
        requestedModel: "gemini-3.5-flash-lite",
        responseModelVersion: "gemini-3.5-flash-lite-001",
        usage: {
          promptTokenCount: 100,
          cachedContentTokenCount: null,
          candidatesTokenCount: 20,
          toolUsePromptTokenCount: null,
          thoughtsTokenCount: null,
          totalTokenCount: 120,
          serviceTier: "STANDARD",
        },
      });
    });

    await expect(runPresentationJob({ taskId: created.task.id, userId })).rejects.toThrow(
      "JOB_FAILED_AND_REFUNDED",
    );
    expect(await getCreditBalance(userId)).toBe(TASK_COST);

    await retryRefundedJob({ jobId: job.id, userId });
    expect(await getCreditBalance(userId)).toBe(0);
    await expect(runPresentationJob({ taskId: created.task.id, userId })).rejects.toThrow(
      "JOB_FAILED_AND_REFUNDED",
    );
    expect(await getCreditBalance(userId)).toBe(TASK_COST);

    await retryRefundedJob({ jobId: job.id, userId });
    expect(await getCreditBalance(userId)).toBe(0);
    await expect(runPresentationJob({ taskId: created.task.id, userId })).rejects.toThrow(
      "JOB_FAILED_AND_REFUNDED",
    );
    expect(await getCreditBalance(userId)).toBe(TASK_COST);
    await expect(retryRefundedJob({ jobId: job.id, userId })).rejects.toThrow("JOB_RETRY_LIMIT_REACHED");

    const refunds = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.type, "JOB_REFUND"));
    expect(refunds).toHaveLength(3);
    expect(refunds.map((entry) => entry.idempotencyKey).sort()).toEqual([
      `job-refund:${job.id}:1`,
      `job-refund:${job.id}:2`,
      `job-refund:${job.id}:3`,
    ]);
    const attempts = await db.select().from(providerAttempts).where(eq(providerAttempts.jobId, job.id));
    expect(attempts).toHaveLength(3);
    expect(
      attempts.every(
        (attempt) =>
          attempt.status === "FAILED" &&
          !attempt.canonical &&
          attempt.pricingStatus === "PRICED" &&
          attempt.publishedCostUsdMicros === BigInt(80),
      ),
    ).toBe(true);
  });

  it("records Gemini usage and published replacement cost separately from CE", async () => {
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
    const created = await createPresentationTask({ userId, prompt: "Create a metered technical deck." });
    const presentation = {
      title: "Metered compute",
      subtitle: "Provider usage stays separate from CE",
      theme: "technical",
      slides: Array.from({ length: 6 }, (_, index) => ({
        title: `Slide ${index + 1}`,
        bullets: ["A concrete point"],
        speakerNote: "Explain the evidence.",
        visualDirection: "Show one proof object.",
      })),
    };
    vi.spyOn(gemini, "generatePresentation").mockResolvedValue({
      presentation,
      providerRequestId: "provider-request-metered",
      requestedModel: "gemini-3.5-flash-lite",
      responseModelVersion: "gemini-3.5-flash-lite-001",
      usage: {
        promptTokenCount: 1_000,
        cachedContentTokenCount: null,
        candidatesTokenCount: 1_500,
        toolUsePromptTokenCount: null,
        thoughtsTokenCount: 500,
        totalTokenCount: 3_000,
        serviceTier: "STANDARD",
      },
    });

    const result = await runPresentationJob({ taskId: created.task.id, userId });
    expect(result.job.status).toBe("COMPLETED");
    const [attempt] = await db.select().from(providerAttempts).where(eq(providerAttempts.jobId, result.job.id));
    expect(attempt).toMatchObject({
      status: "SUCCEEDED",
      canonical: true,
      providerRequestId: "provider-request-metered",
      responseModelVersion: "gemini-3.5-flash-lite-001",
      pricingStatus: "PRICED",
      publishedCostUsdMicros: BigInt(5_300),
      actualBilledCostUsdMicros: null,
    });
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("allows a recovered funded job to start exactly one provider request", async () => {
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
    const created = await createPresentationTask({
      userId,
      prompt: "Recover this funded provider job after a lost settlement response.",
    });
    const providerResult: Awaited<ReturnType<typeof gemini.generatePresentation>> = {
      presentation: {
        title: "Recovered job",
        subtitle: "One persisted job creates one provider request",
        theme: "technical",
        slides: Array.from({ length: 6 }, (_, index) => ({
          title: `Slide ${index + 1}`,
          bullets: ["Recovery remains idempotent"],
          speakerNote: "Explain the lease boundary.",
          visualDirection: "Show one recovered job.",
        })),
      },
      providerRequestId: "provider-request-recovered",
      requestedModel: "gemini-3.5-flash-lite",
      responseModelVersion: "gemini-3.5-flash-lite-001",
      usage: {
        promptTokenCount: 100,
        cachedContentTokenCount: null,
        candidatesTokenCount: 100,
        toolUsePromptTokenCount: null,
        thoughtsTokenCount: null,
        totalTokenCount: 200,
        serviceTier: "STANDARD",
      },
    };
    let releaseProvider!: (value: typeof providerResult) => void;
    const provider = vi.spyOn(gemini, "generatePresentation").mockImplementation(
      () => new Promise((resolve) => {
        releaseProvider = resolve;
      }),
    );

    const firstRun = runPresentationJob({ taskId: created.task.id, userId });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const duplicateRun = await runPresentationJob({ taskId: created.task.id, userId });

    expect(duplicateRun).toMatchObject({ execute: false, job: { status: "PROCESSING" } });
    releaseProvider(providerResult);
    await expect(firstRun).resolves.toMatchObject({ job: { status: "COMPLETED" } });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("does not reclaim a stale provider lease after the attempt cap", async () => {
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
    const created = await createPresentationTask({ userId, prompt: "Create a capped stale-lease deck." });
    const [job] = await db
      .update(jobs)
      .set({
        status: "PROCESSING",
        attemptCount: 3,
        processingStartedAt: new Date(Date.now() - 6 * 60_000),
        processingToken: crypto.randomUUID(),
      })
      .where(eq(jobs.taskId, created.task.id))
      .returning();
    await db.insert(providerAttempts).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      attemptNumber: 3,
      status: "STARTED",
      provider: "gemini",
      requestedModel: "gemini-3.5-flash-lite",
      startedAt: new Date(Date.now() - 6 * 60_000),
    });
    const provider = vi.spyOn(gemini, "generatePresentation");

    await expect(runPresentationJob({ taskId: created.task.id, userId })).rejects.toThrow(
      "JOB_ATTEMPT_LIMIT_REACHED_CREDITS_REFUNDED",
    );
    expect(provider).not.toHaveBeenCalled();
    const [reconciledJob] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(reconciledJob).toMatchObject({
      status: "FAILED",
      failureReason: "PROVIDER_ATTEMPT_TIMED_OUT_AT_CAP",
      processingStartedAt: null,
      processingToken: null,
    });
    const [attempt] = await db.select().from(providerAttempts).where(eq(providerAttempts.jobId, job.id));
    expect(attempt).toMatchObject({
      status: "FAILED",
      pricingStatus: "UNPRICED",
      pricingReason: "USAGE_METADATA_UNAVAILABLE_AFTER_PROCESS_LOSS",
    });
    expect(await getCreditBalance(userId)).toBe(TASK_COST);
  });

  it("allows one campaign reward per user while preserving the original quest authorization", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await grantStarterCredits(userId);
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex("legacy campaign metadata")),
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
    });
    await expect(
      authorizeQuestCompletion({ sessionId: secondQuest.session.id, userId }),
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
    const [reservedCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(reservedCampaign).toMatchObject({
      remainingBudget: QUEST_REWARD * 2,
      reservedBudget: QUEST_REWARD,
    });
  });

  it("never signs more CE receipts than the campaign can fund", async () => {
    const db = getDatabase();
    const campaignId = crypto.randomUUID();
    const firstUserId = crypto.randomUUID();
    const secondUserId = crypto.randomUUID();
    await db.insert(users).values([{ id: firstUserId }, { id: secondUserId }]);
    await Promise.all([grantStarterCredits(firstUserId), grantStarterCredits(secondUserId)]);
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex("legacy campaign metadata")),
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const [firstTask, secondTask] = await Promise.all([
      createPresentationTask({ userId: firstUserId, prompt: "Create the first budget-bound deck." }),
      createPresentationTask({ userId: secondUserId, prompt: "Create the second budget-bound deck." }),
    ]);
    const [firstQuest, secondQuest] = await Promise.all([
      createQuestSession({ campaignId, taskId: firstTask.task.id, userId: firstUserId }),
      createQuestSession({ campaignId, taskId: secondTask.task.id, userId: secondUserId }),
    ]);
    await db
      .update(questSessions)
      .set({ state: "ACTIVE", accumulatedActiveMs: 30_000 })
      .where(eq(questSessions.campaignId, campaignId));
    const signTypedData = vi.fn().mockResolvedValue(`0x${"4".repeat(130)}`);
    vi.spyOn(monad, "assertOnchainVerifier").mockResolvedValue({ signTypedData } as never);

    await authorizeQuestCompletion({ sessionId: firstQuest.session.id, userId: firstUserId });
    await expect(
      authorizeQuestCompletion({ sessionId: secondQuest.session.id, userId: secondUserId }),
    ).rejects.toThrow("OFFCHAIN_CAMPAIGN_BUDGET_UNAVAILABLE");
    expect(signTypedData).toHaveBeenCalledOnce();
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(campaign).toMatchObject({ remainingBudget: QUEST_REWARD, reservedBudget: QUEST_REWARD });
    expect(await db.select().from(campaignRewardClaims)).toHaveLength(1);
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
      reservedBudget: QUEST_REWARD,
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

    const [settled] = await Promise.all([
      settleQuestCompletion({ sessionId: quest.session.id, userId }),
      createPresentationTask({ userId, prompt: "Create a task racing the confirmed settlement." }),
    ]);

    expect(settled.balanceAfterCredit).toBe(0);
    const userTasks = await db.select().from(tasks).where(eq(tasks.userId, userId));
    expect(userTasks.map((task) => task.status).sort()).toEqual(["AWAITING_CREDITS", "FUNDED"]);
    expect(await getCreditBalance(userId)).toBe(0);
  });

  it("preserves campaign identity and requires a new UUID for a new onchain campaign", async () => {
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
    await db
      .update(campaigns)
      .set({ remainingBudget: 260, reservedBudget: 40 })
      .where(eq(campaigns.id, campaignId));

    const restarted = await upsertDemoCampaign(metadata);
    expect(restarted.remainingBudget).toBe(260);
    expect(restarted.reservedBudget).toBe(40);

    await expect(upsertDemoCampaign({ ...metadata, onchainCampaignId: BigInt(2) })).rejects.toThrow(
      "CAMPAIGN_IDENTITY_IMMUTABLE_USE_NEW_UUID",
    );
    const [preserved] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(preserved).toMatchObject({
      onchainCampaignId: BigInt(1),
      remainingBudget: 260,
      reservedBudget: 40,
    });
    await expect(upsertDemoCampaign({ ...metadata, creditReward: QUEST_REWARD + 1 })).rejects.toThrow(
      "CAMPAIGN_IDENTITY_IMMUTABLE_USE_NEW_UUID",
    );
    const [economicsPreserved] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(economicsPreserved).toMatchObject({
      creditReward: QUEST_REWARD,
      remainingBudget: 260,
      reservedBudget: 40,
    });
    await expect(
      upsertDemoCampaign({ ...metadata, completionQuestion: "A different completion question?" }),
    ).rejects.toThrow("CAMPAIGN_IDENTITY_IMMUTABLE_USE_NEW_UUID");
    const [verificationPreserved] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(verificationPreserved).toMatchObject({
      completionQuestion: metadata.completionQuestion,
      completionAnswerHash: metadata.completionAnswerHash,
      remainingBudget: 260,
      reservedBudget: 40,
    });

    const nextCampaignId = crypto.randomUUID();
    const next = await upsertDemoCampaign({
      ...metadata,
      id: nextCampaignId,
      onchainCampaignId: BigInt(2),
    });
    expect(next).toMatchObject({
      id: nextCampaignId,
      onchainCampaignId: BigInt(2),
      remainingBudget: 400,
      reservedBudget: 0,
    });
  });

  it("persists a pause boundary and credits only the following continuous eligible interval", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await grantStarterCredits(userId);
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

  it("caps credited attention at the campaign requirement and freezes further heartbeats", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await grantStarterCredits(userId);
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 5,
      creativeTitle: "Five-second attention cap",
      completionQuestion: "Legacy campaign metadata",
      completionAnswerHash: "not-used-in-this-test",
      remainingBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({
      userId,
      prompt: "Create a pitch deck proving capped attention accounting.",
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
      heartbeat: { sequence: 2, ...active, mediaTimeMs: 3_000 },
      now: new Date(startedAt.getTime() + 3_000),
    });
    const verified = await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 3, ...active, mediaTimeMs: 6_000 },
      now: new Date(startedAt.getTime() + 6_000),
    });
    const frozen = await recordHeartbeat({
      sessionId: quest.session.id,
      userId,
      heartbeat: { sequence: 4, ...active, mediaTimeMs: 9_000 },
      now: new Date(startedAt.getTime() + 9_000),
    });

    expect(verified).toMatchObject({
      state: "ATTENTION_VERIFIED",
      accumulatedActiveMs: 5_000,
      lastHeartbeatEligible: false,
      lastAttentionReason: "ATTENTION_VERIFIED",
    });
    expect(frozen).toMatchObject({ state: "ATTENTION_VERIFIED", accumulatedActiveMs: 5_000 });
    const evidence = await db
      .select()
      .from(attentionEvents)
      .where(eq(attentionEvents.questSessionId, quest.session.id));
    expect(evidence).toHaveLength(3);
    expect(evidence.at(-1)).toMatchObject({
      sequence: 3,
      reason: "ATTENTION_VERIFIED",
      creditedMs: 2_000,
    });
  });

  it("expires a stale attempt and safely renews the same task with a fresh nonce", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await grantStarterCredits(userId);
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
    await grantStarterCredits(userId);
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

  it("reauthorizes an expired pre-relay receipt after verified attention without a quiz answer", async () => {
    const db = getDatabase();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    await db.insert(users).values({ id: userId });
    await grantStarterCredits(userId);
    await db.insert(campaigns).values({
      id: campaignId,
      onchainCampaignId: BigInt(1),
      creditReward: QUEST_REWARD,
      onchainRewardWei: BigInt(1),
      requiredActiveSeconds: 30,
      creativeTitle: "Monad parallel execution",
      completionQuestion: "What model runs independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex("legacy campaign metadata")),
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
      .set({ state: "SETTLEMENT_FAILED", accumulatedActiveMs: 65_000 })
      .where(eq(questSessions.id, quest.session.id));
    const signTypedData = vi.fn().mockResolvedValue(`0x${"4".repeat(130)}`);
    vi.spyOn(monad, "assertOnchainVerifier").mockResolvedValue({ signTypedData } as never);
    const now = new Date("2026-08-29T06:00:00.000Z");

    const refreshed = await authorizeQuestCompletion({ sessionId: quest.session.id, userId, now });

    expect(refreshed.id).toBe(settlementId);
    expect(refreshed.status).toBe("AUTHORIZED");
    expect(refreshed.failureReason).toBeNull();
    expect(refreshed.transactionHash).toBeNull();
    expect(refreshed.sessionHash).toBe(expiredReceipt.sessionHash);
    expect(signTypedData).toHaveBeenCalledOnce();
    const [refreshedQuest] = await db.select().from(questSessions).where(eq(questSessions.id, quest.session.id));
    expect(refreshedQuest.state).toBe("AUTHORIZED");
    expect(refreshedQuest.accumulatedActiveMs).toBe(30_000);
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
      reservedBudget: QUEST_REWARD,
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
    vi.spyOn(monad, "findSettlementBySessionHash").mockResolvedValue(null);
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

  it("recovers a broadcast settlement from its indexed onchain event", async () => {
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
      reservedBudget: QUEST_REWARD,
      active: true,
    });
    const task = await createPresentationTask({ userId, prompt: "Create a crash-recovery deck." });
    const quest = await createQuestSession({ campaignId, taskId: task.task.id, userId });
    const receipt = buildCompletionReceipt({
      campaignId: BigInt(1),
      sessionId: quest.session.id,
      sessionNonce: quest.session.nonce,
      userId,
      reward: BigInt(1),
      issuedAtSeconds: BigInt(Math.floor(Date.now() / 1_000)),
    });
    const settlementId = crypto.randomUUID();
    const recoveredHash = `0x${"8".repeat(64)}` as `0x${string}`;
    await db.insert(settlements).values({
      id: settlementId,
      questSessionId: quest.session.id,
      sessionHash: receipt.sessionHash,
      receipt: storeCompletionReceipt(receipt),
      signature: `0x${"1".repeat(130)}`,
      chainId: 10143,
      status: "SUBMITTING",
      authorizedAt: new Date(),
      updatedAt: new Date(Date.now() - 31_000),
    });
    await db.insert(settlementAttempts).values({
      id: crypto.randomUUID(),
      settlementId,
      attemptNumber: 1,
      status: "SUBMITTING",
    });
    await db.update(questSessions).set({ state: "SETTLING" }).where(eq(questSessions.id, quest.session.id));
    vi.spyOn(monad, "findSettlementBySessionHash").mockResolvedValue({
      transactionHash: recoveredHash,
      blockNumber: BigInt(222),
    });
    vi.spyOn(monad, "waitForSettlement").mockResolvedValue({
      status: "success",
      blockNumber: BigInt(222),
    } as never);
    vi.spyOn(monad, "isSessionConsumed").mockResolvedValue(true);

    const recovered = await settleQuestCompletion({ sessionId: quest.session.id, userId });
    expect(recovered).toMatchObject({
      status: "CONFIRMED",
      transactionHash: recoveredHash,
      blockNumber: BigInt(222),
      taskStatus: "FUNDED",
      balanceAfterCredit: 0,
    });
    const [attempt] = await db
      .select()
      .from(settlementAttempts)
      .where(eq(settlementAttempts.settlementId, settlementId));
    expect(attempt).toMatchObject({
      status: "CONFIRMED",
      transactionHash: recoveredHash,
      blockNumber: BigInt(222),
    });
  });
});
