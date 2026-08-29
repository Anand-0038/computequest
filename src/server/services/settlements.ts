import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { keccak256, stringToHex } from "viem";

import { TASK_COST } from "@/domain/constants";
import {
  buildCompletionReceipt,
  completionReceiptDomain,
  completionReceiptTypes,
  isCompletionReceiptExpired,
  restoreCompletionReceipt,
  storeCompletionReceipt,
} from "@/domain/settlement";
import {
  assertOnchainVerifier,
  isSessionConsumed,
  simulateCompletionSettlement,
  submitCompletionSettlement,
  waitForSettlement,
} from "@/server/chain/monad";
import { getDatabase } from "@/server/db/client";
import {
  campaigns,
  campaignRewardClaims,
  creditEntries,
  jobs,
  questSessions,
  settlementAttempts,
  settlements,
  tasks,
} from "@/server/db/schema";
import { requireRuntimeEnv } from "@/server/env";
import { getLockedCreditBalance, lockUserLedger } from "@/server/services/ledger";
import { expireQuestSessionIfNeeded } from "@/server/services/quests";

export async function authorizeQuestCompletion(input: {
  sessionId: string;
  userId: string;
  answer: string;
  now?: Date;
}) {
  const env = requireRuntimeEnv();
  const db = getDatabase();
  const now = input.now ?? new Date();
  if (await expireQuestSessionIfNeeded({ sessionId: input.sessionId, userId: input.userId, now })) {
    throw new Error("QUEST_EXPIRED");
  }
  const verifier = await assertOnchainVerifier();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(questSessions)
      .where(and(eq(questSessions.id, input.sessionId), eq(questSessions.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!session) throw new Error("QUEST_NOT_FOUND");

    const [existing] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.questSessionId, session.id))
      .limit(1);
    const existingReceipt = existing ? restoreCompletionReceipt(existing.receipt) : null;
    const refreshExpiredAuthorization = Boolean(
      existing &&
        existingReceipt &&
        !existing.transactionHash &&
        ["AUTHORIZED", "FAILED"].includes(existing.status) &&
        isCompletionReceiptExpired(existingReceipt, now),
    );
    if (existing && !refreshExpiredAuthorization) return existing;
    const authorizableStates = refreshExpiredAuthorization
      ? ["AUTHORIZED", "SETTLEMENT_FAILED"]
      : ["ACTIVE", "PAUSED"];
    if (!authorizableStates.includes(session.state)) throw new Error(`QUEST_NOT_AUTHORIZABLE:${session.state}`);

    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, session.campaignId), eq(campaigns.active, true)))
      .limit(1);
    if (!campaign || campaign.onchainCampaignId === null) throw new Error("CAMPAIGN_NOT_DEPLOYED");
    if (session.accumulatedActiveMs < campaign.requiredActiveSeconds * 1_000) {
      throw new Error("QUEST_DURATION_INCOMPLETE");
    }
    const normalizedAnswer = input.answer.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    if (keccak256(stringToHex(normalizedAnswer)) !== campaign.completionAnswerHash) {
      throw new Error("QUEST_ANSWER_INCORRECT");
    }

    await tx
      .insert(campaignRewardClaims)
      .values({
        id: crypto.randomUUID(),
        campaignId: campaign.id,
        userId: session.userId,
        questSessionId: session.id,
        status: "RESERVED",
      })
      .onConflictDoNothing({
        target: [campaignRewardClaims.campaignId, campaignRewardClaims.userId],
      });
    const [claim] = await tx
      .select()
      .from(campaignRewardClaims)
      .where(
        and(
          eq(campaignRewardClaims.campaignId, campaign.id),
          eq(campaignRewardClaims.userId, session.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!claim || claim.questSessionId !== session.id) {
      throw new Error("CAMPAIGN_REWARD_ALREADY_CLAIMED");
    }

    const receipt = buildCompletionReceipt({
      campaignId: campaign.onchainCampaignId,
      sessionId: session.id,
      sessionNonce: session.nonce,
      userId: session.userId,
      reward: campaign.onchainRewardWei,
      issuedAtSeconds: BigInt(Math.floor(now.getTime() / 1_000)),
    });
    const signature = await verifier.signTypedData({
      domain: completionReceiptDomain({
        chainId: env.MONAD_CHAIN_ID,
        verifyingContract: env.CAMPAIGN_ESCROW_ADDRESS as Address,
      }),
      types: completionReceiptTypes,
      primaryType: "CompletionReceipt",
      message: receipt,
    });

    const [settlement] = existing
      ? await tx
          .update(settlements)
          .set({
            receipt: storeCompletionReceipt(receipt),
            signature,
            status: "AUTHORIZED",
            authorizedAt: now,
            failureReason: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(settlements.id, existing.id),
              sql`${settlements.transactionHash} is null`,
              sql`${settlements.status} in ('AUTHORIZED', 'FAILED')`,
            ),
          )
          .returning()
      : await tx
          .insert(settlements)
          .values({
            id: crypto.randomUUID(),
            questSessionId: session.id,
            sessionHash: receipt.sessionHash,
            receipt: storeCompletionReceipt(receipt),
            signature,
            chainId: env.MONAD_CHAIN_ID,
            status: "AUTHORIZED",
            authorizedAt: now,
          })
          .returning();
    if (!settlement) throw new Error("SETTLEMENT_REAUTHORIZATION_CONFLICT");
    await tx
      .update(campaignRewardClaims)
      .set({ settlementId: settlement.id, updatedAt: now })
      .where(eq(campaignRewardClaims.id, claim.id));
    await tx
      .update(questSessions)
      .set({ state: "AUTHORIZED", completionAnsweredAt: now, updatedAt: now })
      .where(eq(questSessions.id, session.id));
    return settlement;
  });
}

export async function settleQuestCompletion(input: { sessionId: string; userId: string }) {
  const db = getDatabase();
  const [record] = await db
    .select({ settlement: settlements, session: questSessions })
    .from(settlements)
    .innerJoin(questSessions, eq(questSessions.id, settlements.questSessionId))
    .where(and(eq(questSessions.id, input.sessionId), eq(questSessions.userId, input.userId)))
    .limit(1);
  if (!record) throw new Error("AUTHORIZED_SETTLEMENT_NOT_FOUND");
  if (record.settlement.status === "CONFIRMED") return finalizeConfirmedSettlement(record.settlement.id);

  const receipt = restoreCompletionReceipt(record.settlement.receipt);
  const signature = record.settlement.signature as Hex;
  let transactionHash = record.settlement.transactionHash as Hex | null;

  if (
    !transactionHash &&
    ["SUBMITTING", "FAILED"].includes(record.settlement.status) &&
    Date.now() - record.settlement.updatedAt.getTime() < 30_000
  ) {
    throw new Error("SETTLEMENT_RETRY_COOLDOWN");
  }

  if (!transactionHash && isCompletionReceiptExpired(receipt, new Date())) {
    if (record.settlement.status === "SUBMITTING" && (await isSessionConsumed(receipt.sessionHash))) {
      throw new Error("SESSION_CONSUMED_WITHOUT_TRACKED_TRANSACTION");
    }
    const failedAt = new Date();
    const markedExpired = await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(settlements)
        .set({ status: "FAILED", failureReason: "RECEIPT_EXPIRED", updatedAt: failedAt })
        .where(
          and(
            eq(settlements.id, record.settlement.id),
            sql`${settlements.transactionHash} is null`,
            sql`${settlements.status} in ('AUTHORIZED', 'FAILED', 'SUBMITTING')`,
          ),
        )
        .returning({ id: settlements.id });
      if (!failed) return false;
      await tx
        .update(questSessions)
        .set({ state: "SETTLEMENT_FAILED", updatedAt: failedAt })
        .where(eq(questSessions.id, record.session.id));
      return true;
    });
    if (!markedExpired) throw new Error("SETTLEMENT_EXPIRY_STATE_CONFLICT");
    throw new Error("SETTLEMENT_RECEIPT_EXPIRED_REAUTHORIZE");
  }

  if (!transactionHash && ["SUBMITTING", "FAILED"].includes(record.settlement.status)) {
    if (await isSessionConsumed(receipt.sessionHash)) {
      throw new Error("SESSION_CONSUMED_WITHOUT_TRACKED_TRANSACTION");
    }
    const [reset] = await db
      .update(settlements)
      .set({ status: "AUTHORIZED", failureReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(settlements.id, record.settlement.id),
          sql`${settlements.status} in ('SUBMITTING', 'FAILED')`,
        ),
      )
      .returning({ id: settlements.id });
    if (!reset) throw new Error("SETTLEMENT_RECOVERY_CONFLICT");
  }

  if (!transactionHash) {
    if (await isSessionConsumed(receipt.sessionHash)) throw new Error("SESSION_CONSUMED_WITHOUT_TRACKED_TRANSACTION");
    await simulateCompletionSettlement(receipt, signature);
    const attempt = await db.transaction(async (tx) => {
      const claimedAt = new Date();
      const [claimed] = await tx
        .update(settlements)
        .set({ status: "SUBMITTING", updatedAt: claimedAt })
        .where(and(eq(settlements.id, record.settlement.id), eq(settlements.status, "AUTHORIZED")))
        .returning({ id: settlements.id });
      if (!claimed) return null;
      const [sequence] = await tx
        .select({ nextAttempt: sql<number>`coalesce(max(${settlementAttempts.attemptNumber}), 0)::int + 1` })
        .from(settlementAttempts)
        .where(eq(settlementAttempts.settlementId, record.settlement.id));
      const [createdAttempt] = await tx
        .insert(settlementAttempts)
        .values({
          id: crypto.randomUUID(),
          settlementId: record.settlement.id,
          attemptNumber: sequence?.nextAttempt ?? 1,
          status: "SUBMITTING",
        })
        .returning({ id: settlementAttempts.id });
      await tx
        .update(questSessions)
        .set({ state: "SETTLING", updatedAt: claimedAt })
        .where(eq(questSessions.id, record.session.id));
      return createdAttempt;
    });
    if (!attempt) throw new Error("SETTLEMENT_SUBMISSION_IN_PROGRESS");
    try {
      transactionHash = await submitCompletionSettlement(receipt, signature);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "SETTLEMENT_SUBMISSION_FAILED";
      await db.transaction(async (tx) => {
        await tx
          .update(settlementAttempts)
          .set({ status: "FAILED", failureReason: reason, updatedAt: new Date() })
          .where(and(eq(settlementAttempts.id, attempt.id), eq(settlementAttempts.status, "SUBMITTING")));
        await tx
          .update(settlements)
          .set({ status: "FAILED", failureReason: reason, updatedAt: new Date() })
          .where(and(eq(settlements.id, record.settlement.id), eq(settlements.status, "SUBMITTING")));
        await tx
          .update(questSessions)
          .set({ state: "SETTLEMENT_FAILED", updatedAt: new Date() })
          .where(eq(questSessions.id, record.session.id));
      });
      throw new Error(`SETTLEMENT_SUBMISSION_FAILED:${reason}`);
    }
    const submittedAt = new Date();
    await db.transaction(async (tx) => {
      const [submitted] = await tx
        .update(settlements)
        .set({ status: "SUBMITTED", transactionHash, updatedAt: submittedAt })
        .where(and(eq(settlements.id, record.settlement.id), eq(settlements.status, "SUBMITTING")))
        .returning({ id: settlements.id });
      if (!submitted) throw new Error("SETTLEMENT_SUBMISSION_STATE_CONFLICT");
      await tx
        .update(settlementAttempts)
        .set({ status: "SUBMITTED", transactionHash, submittedAt, updatedAt: submittedAt })
        .where(and(eq(settlementAttempts.id, attempt.id), eq(settlementAttempts.status, "SUBMITTING")));
    });
  }

  const chainReceipt = await waitForSettlement(transactionHash);
  if (chainReceipt.status !== "success") {
    await db.transaction(async (tx) => {
      await tx
        .update(settlements)
        .set({
          status: "FAILED",
          transactionHash: null,
          blockNumber: null,
          failureReason: "TRANSACTION_REVERTED",
          updatedAt: new Date(),
        })
        .where(eq(settlements.id, record.settlement.id));
      await tx
        .update(settlementAttempts)
        .set({
          status: "REVERTED",
          blockNumber: chainReceipt.blockNumber,
          failureReason: "TRANSACTION_REVERTED",
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(settlementAttempts.transactionHash, transactionHash));
      await tx
        .update(questSessions)
        .set({ state: "SETTLEMENT_FAILED", updatedAt: new Date() })
        .where(eq(questSessions.id, record.session.id));
    });
    throw new Error("SETTLEMENT_TRANSACTION_REVERTED");
  }
  if (!(await isSessionConsumed(receipt.sessionHash))) throw new Error("SETTLEMENT_EVENT_STATE_NOT_OBSERVED");

  return finalizeConfirmedSettlement(record.settlement.id, chainReceipt.blockNumber);
}

async function finalizeConfirmedSettlement(settlementId: string, observedBlockNumber?: bigint) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ settlement: settlements, session: questSessions, campaign: campaigns, task: tasks })
      .from(settlements)
      .innerJoin(questSessions, eq(questSessions.id, settlements.questSessionId))
      .innerJoin(campaigns, eq(campaigns.id, questSessions.campaignId))
      .innerJoin(tasks, eq(tasks.id, questSessions.taskId))
      .where(eq(settlements.id, settlementId))
      .for("update")
      .limit(1);
    if (!record) throw new Error("SETTLEMENT_NOT_FOUND");
    if (record.session.state === "CREDITED") {
      return {
        settlementId: record.settlement.id,
        transactionHash: record.settlement.transactionHash,
        blockNumber: record.settlement.blockNumber,
        status: "CONFIRMED" as const,
        taskId: record.task.id,
        taskStatus: record.task.status,
      };
    }
    if (!record.settlement.transactionHash) throw new Error("CONFIRMED_SETTLEMENT_MISSING_TRANSACTION");

    await lockUserLedger(tx, record.session.userId);
    await tx
      .insert(campaignRewardClaims)
      .values({
        id: crypto.randomUUID(),
        campaignId: record.campaign.id,
        userId: record.session.userId,
        questSessionId: record.session.id,
        settlementId: record.settlement.id,
        status: "CONFIRMED",
      })
      .onConflictDoNothing({
        target: [campaignRewardClaims.campaignId, campaignRewardClaims.userId],
      });
    const [claim] = await tx
      .select()
      .from(campaignRewardClaims)
      .where(
        and(
          eq(campaignRewardClaims.campaignId, record.campaign.id),
          eq(campaignRewardClaims.userId, record.session.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!claim || claim.questSessionId !== record.session.id) {
      throw new Error("CAMPAIGN_REWARD_ALREADY_CLAIMED");
    }

    const confirmedAt = new Date();
    await tx
      .update(campaignRewardClaims)
      .set({ settlementId: record.settlement.id, status: "CONFIRMED", updatedAt: confirmedAt })
      .where(eq(campaignRewardClaims.id, claim.id));
    await tx
      .update(settlements)
      .set({
        status: "CONFIRMED",
        blockNumber: observedBlockNumber ?? record.settlement.blockNumber,
        confirmedAt,
        failureReason: null,
        updatedAt: confirmedAt,
      })
      .where(eq(settlements.id, settlementId));
    await tx
      .update(settlementAttempts)
      .set({
        status: "CONFIRMED",
        blockNumber: observedBlockNumber ?? record.settlement.blockNumber,
        confirmedAt,
        failureReason: null,
        updatedAt: confirmedAt,
      })
      .where(eq(settlementAttempts.transactionHash, record.settlement.transactionHash));
    const [budget] = await tx
      .update(campaigns)
      .set({
        remainingBudget: sql`${campaigns.remainingBudget} - ${record.campaign.creditReward}`,
        updatedAt: confirmedAt,
      })
      .where(
        and(
          eq(campaigns.id, record.campaign.id),
          sql`${campaigns.remainingBudget} >= ${record.campaign.creditReward}`,
        ),
      )
      .returning({ remainingBudget: campaigns.remainingBudget });
    if (!budget) throw new Error("OFFCHAIN_CAMPAIGN_BUDGET_EXHAUSTED");
    await tx
      .insert(creditEntries)
      .values({
        id: crypto.randomUUID(),
        userId: record.session.userId,
        amount: record.campaign.creditReward,
        type: "QUEST_GRANT",
        referenceId: settlementId,
        idempotencyKey: `settlement-credit:${settlementId}`,
      })
      .onConflictDoNothing({ target: creditEntries.idempotencyKey });

    const balance = await getLockedCreditBalance(tx, record.session.userId);

    let taskStatus = record.task.status;
    if (record.task.status === "AWAITING_CREDITS" && balance >= TASK_COST) {
      await tx
        .insert(creditEntries)
        .values({
          id: crypto.randomUUID(),
          userId: record.session.userId,
          amount: -TASK_COST,
          type: "TASK_SPEND",
          referenceId: record.task.id,
          idempotencyKey: `task-spend:${record.task.id}`,
        })
        .onConflictDoNothing({ target: creditEntries.idempotencyKey });
      await tx
        .insert(jobs)
        .values({ id: crypto.randomUUID(), taskId: record.task.id, status: "FUNDED", provider: "gemini" })
        .onConflictDoNothing({ target: jobs.taskId });
      await tx
        .update(tasks)
        .set({ status: "FUNDED", updatedAt: confirmedAt })
        .where(and(eq(tasks.id, record.task.id), eq(tasks.status, "AWAITING_CREDITS")));
      taskStatus = "FUNDED";
    }

    await tx
      .update(questSessions)
      .set({ state: "CREDITED", claimedAt: confirmedAt, updatedAt: confirmedAt })
      .where(eq(questSessions.id, record.session.id));
    return {
      settlementId: record.settlement.id,
      transactionHash: record.settlement.transactionHash,
      blockNumber: observedBlockNumber ?? record.settlement.blockNumber,
      status: "CONFIRMED" as const,
      taskId: record.task.id,
      taskStatus,
      balanceAfterCredit: balance,
    };
  });
}
