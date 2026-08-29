import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireCampaignRuntimeReady } from "@/server/chain/monad";
import { requireSessionUserId } from "@/server/auth/session";
import { publicJob, publicSettlementResult, publicTask } from "@/server/http/public-shapes";
import { runPresentationJob } from "@/server/services/jobs";
import { settleQuestCompletion } from "@/server/services/settlements";
import { getTaskForUser } from "@/server/services/tasks";
import { getQuestCampaignSettlementIdentity } from "@/server/services/campaigns";

const paramsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { sessionId } = paramsSchema.parse(await context.params);
    const campaign = await getQuestCampaignSettlementIdentity({ sessionId, userId });
    await requireCampaignRuntimeReady(campaign.onchainCampaignId, campaign.onchainRewardWei);
    const settlement = await settleQuestCompletion({ sessionId, userId });
    const publicSettlement = publicSettlementResult(settlement);

    try {
      const generated = await runPresentationJob({ taskId: settlement.taskId, userId });
      return NextResponse.json({
        ...publicSettlement,
        generation: {
          task: publicTask(generated.task),
          job: publicJob(generated.job),
          error: null,
        },
      });
    } catch (generationError) {
      const snapshot = await getTaskForUser(settlement.taskId, userId);
      const message = generationError instanceof Error ? generationError.message : "AUTOMATIC_GENERATION_FAILED";
      return NextResponse.json({
        ...publicSettlement,
        generation: {
          task: snapshot ? publicTask(snapshot.task) : null,
          job: snapshot?.job ? publicJob(snapshot.job) : null,
          error: message,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUEST_SETTLEMENT_FAILED";
    const status =
      message.startsWith("MONAD_")
        ? 503
        : message === "AUTHORIZED_SETTLEMENT_NOT_FOUND"
        ? 404
        : message.includes("IN_PROGRESS") || message.includes("COOLDOWN") || message.includes("CONFLICT")
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
