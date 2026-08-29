import { createHash } from "node:crypto";

import { and, eq, inArray, lte } from "drizzle-orm";

import { calculateHeartbeatTransition, isQuestSessionExpired, QUEST_SESSION_TTL_MS, type HeartbeatInput } from "@/domain/quest";
import { getDatabase } from "@/server/db/client";
import { attentionEvents, campaignRewardClaims, campaigns, questSessions, tasks } from "@/server/db/schema";
import { publicCampaign } from "@/server/services/campaigns";
import { getLockedCreditBalance, lockUserLedger } from "@/server/services/ledger";

export async function createQuestSession(input: {
  campaignId: string;
  taskId: string;
  userId: string;
}) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const now = new Date();
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.active, true)))
      .limit(1);
    if (!campaign) throw new Error("ACTIVE_CAMPAIGN_NOT_FOUND");

    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)))
      .limit(1);
    if (!task || task.status !== "AWAITING_CREDITS") {
      throw new Error("TASK_NOT_AWAITING_CREDITS");
    }
    await lockUserLedger(tx, input.userId);
    const balance = await getLockedCreditBalance(tx, input.userId);
    if (balance + campaign.creditReward < task.estimatedCost) {
      throw new Error("CAMPAIGN_REWARD_TOO_SMALL_FOR_TASK");
    }

    const [existingClaim] = await tx
      .select({ id: campaignRewardClaims.id })
      .from(campaignRewardClaims)
      .where(
        and(
          eq(campaignRewardClaims.campaignId, input.campaignId),
          eq(campaignRewardClaims.userId, input.userId),
        ),
      )
      .limit(1);
    if (existingClaim) throw new Error("CAMPAIGN_REWARD_ALREADY_CLAIMED");

    const [existing] = await tx
      .select()
      .from(questSessions)
      .where(and(eq(questSessions.taskId, input.taskId), eq(questSessions.userId, input.userId)))
      .for("update")
      .limit(1);
    if (existing) {
      const restartable =
        existing.state === "EXPIRED" ||
        (["CREATED", "ACTIVE", "PAUSED"].includes(existing.state) &&
          isQuestSessionExpired(existing.serverStartedAt, now));
      if (!restartable) {
        throw new Error("QUEST_ALREADY_EXISTS");
      }
      const [renewed] = await tx
        .update(questSessions)
        .set({
          campaignId: input.campaignId,
          nonce: crypto.randomUUID(),
          serverStartedAt: now,
          accumulatedActiveMs: 0,
          lastHeartbeatAt: null,
          lastHeartbeatSequence: 0,
          lastHeartbeatEligible: false,
          lastMediaTimeMs: null,
          lastAttentionReason: "VIDEO_NOT_PLAYING",
          state: "CREATED",
          claimedAt: null,
          completionAnsweredAt: null,
          updatedAt: now,
        })
        .where(eq(questSessions.id, existing.id))
        .returning();
      return {
        session: renewed,
        campaign: publicCampaign(campaign),
      };
    }

    const [session] = await tx
      .insert(questSessions)
      .values({
        id: crypto.randomUUID(),
        campaignId: input.campaignId,
        taskId: input.taskId,
        userId: input.userId,
        nonce: crypto.randomUUID(),
        serverStartedAt: now,
        state: "CREATED",
      })
      .onConflictDoNothing({ target: questSessions.taskId })
      .returning();
    if (!session) throw new Error("QUEST_ALREADY_EXISTS");
    return {
      session,
      campaign: publicCampaign(campaign),
    };
  });
}

export async function recordHeartbeat(input: {
  sessionId: string;
  userId: string;
  heartbeat: HeartbeatInput;
  now?: Date;
}) {
  const db = getDatabase();
  const now = input.now ?? new Date();

  if (await expireQuestSessionIfNeeded({ sessionId: input.sessionId, userId: input.userId, now })) {
    throw new Error("QUEST_EXPIRED");
  }

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(questSessions)
      .where(and(eq(questSessions.id, input.sessionId), eq(questSessions.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!session) throw new Error("QUEST_NOT_FOUND");
    const [campaign] = await tx
      .select({ requiredActiveSeconds: campaigns.requiredActiveSeconds })
      .from(campaigns)
      .where(eq(campaigns.id, session.campaignId))
      .limit(1);
    if (!campaign) throw new Error("ACTIVE_CAMPAIGN_NOT_FOUND");
    const requiredActiveMs = campaign.requiredActiveSeconds * 1_000;
    if (session.state === "ATTENTION_VERIFIED" || session.accumulatedActiveMs >= requiredActiveMs) {
      const [verified] = await tx
        .update(questSessions)
        .set({
          state: "ATTENTION_VERIFIED",
          accumulatedActiveMs: requiredActiveMs,
          lastHeartbeatEligible: false,
          lastAttentionReason: "ATTENTION_VERIFIED",
          updatedAt: now,
        })
        .where(eq(questSessions.id, session.id))
        .returning();
      return verified;
    }
    if (!["CREATED", "ACTIVE", "PAUSED"].includes(session.state)) {
      throw new Error("QUEST_NOT_HEARTBEATABLE");
    }

    const transition = calculateHeartbeatTransition({
      heartbeat: input.heartbeat,
      previousSequence: session.lastHeartbeatSequence,
      previousHeartbeatAt: session.lastHeartbeatAt,
      previousEligible: session.lastHeartbeatEligible,
      previousMediaTimeMs: session.lastMediaTimeMs,
      now,
    });
    if (!transition.accepted) throw new Error(transition.reason);

    const remainingActiveMs = requiredActiveMs - session.accumulatedActiveMs;
    const creditedMs = Math.min(transition.creditedMs, remainingActiveMs);
    const accumulatedActiveMs = session.accumulatedActiveMs + creditedMs;
    const attentionVerified = accumulatedActiveMs >= requiredActiveMs;
    const nextState = attentionVerified ? "ATTENTION_VERIFIED" : transition.nextState;
    const reason = attentionVerified ? "ATTENTION_VERIFIED" : transition.reason;
    const [updated] = await tx
      .update(questSessions)
      .set({
        state: nextState,
        accumulatedActiveMs,
        lastHeartbeatAt: now,
        lastHeartbeatSequence: input.heartbeat.sequence,
        lastHeartbeatEligible: attentionVerified ? false : transition.eligible,
        lastMediaTimeMs: input.heartbeat.mediaTimeMs,
        lastAttentionReason: reason,
        updatedAt: now,
      })
      .where(eq(questSessions.id, session.id))
      .returning();
    const eventPayload = {
      sessionId: session.id,
      sequence: input.heartbeat.sequence,
      serverTimestamp: now.toISOString(),
      heartbeat: input.heartbeat,
      eligible: transition.eligible,
      reason,
      creditedMs,
    };
    await tx.insert(attentionEvents).values({
      id: crypto.randomUUID(),
      questSessionId: session.id,
      sequence: input.heartbeat.sequence,
      serverTimestamp: now,
      mediaTimeMs: input.heartbeat.mediaTimeMs,
      durationMs: input.heartbeat.durationMs,
      playbackRateMilli: Math.round(input.heartbeat.playbackRate * 1_000),
      documentVisible: input.heartbeat.documentVisible,
      windowFocused: input.heartbeat.windowFocused,
      fullscreen: input.heartbeat.fullscreen,
      pictureInPicture: input.heartbeat.pictureInPicture,
      buffering: input.heartbeat.buffering,
      mediaPlaying: input.heartbeat.mediaPlaying,
      eligible: transition.eligible,
      reason,
      creditedMs,
      eventHash: createHash("sha256").update(JSON.stringify(eventPayload)).digest("hex"),
    });
    return updated;
  });
}

export async function expireQuestSessionIfNeeded(input: { sessionId: string; userId: string; now?: Date }) {
  const db = getDatabase();
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - QUEST_SESSION_TTL_MS);
  const [expired] = await db
    .update(questSessions)
    .set({ state: "EXPIRED", lastHeartbeatEligible: false, updatedAt: now })
    .where(
      and(
        eq(questSessions.id, input.sessionId),
        eq(questSessions.userId, input.userId),
        inArray(questSessions.state, ["CREATED", "ACTIVE", "PAUSED"]),
        lte(questSessions.serverStartedAt, cutoff),
      ),
    )
    .returning({ id: questSessions.id });
  return Boolean(expired);
}

export async function getQuestForTask(input: { taskId: string; userId: string }) {
  const db = getDatabase();
  const [record] = await db
    .select({ session: questSessions, campaign: campaigns })
    .from(questSessions)
    .innerJoin(campaigns, eq(campaigns.id, questSessions.campaignId))
    .where(and(eq(questSessions.taskId, input.taskId), eq(questSessions.userId, input.userId)))
    .limit(1);
  if (!record) return null;
  return {
    session: record.session,
    campaign: publicCampaign(record.campaign),
  };
}
