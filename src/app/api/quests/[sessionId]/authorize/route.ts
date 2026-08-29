import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireCampaignRuntimeReady } from "@/server/chain/monad";
import { requireSessionUserId } from "@/server/auth/session";
import { authorizeQuestCompletion } from "@/server/services/settlements";
import { getQuestCampaignSettlementIdentity } from "@/server/services/campaigns";

const paramsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { sessionId } = paramsSchema.parse(await context.params);
    const campaign = await getQuestCampaignSettlementIdentity({ sessionId, userId });
    await requireCampaignRuntimeReady(campaign.onchainCampaignId, campaign.onchainRewardWei);
    const settlement = await authorizeQuestCompletion({ sessionId, userId });
    return NextResponse.json({
      settlement: {
        id: settlement.id,
        status: settlement.status,
        sessionHash: settlement.sessionHash,
        chainId: settlement.chainId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUEST_AUTHORIZATION_FAILED";
    const status =
      message.startsWith("MONAD_")
        ? 503
        : message === "QUEST_NOT_FOUND"
        ? 404
        : message === "QUEST_EXPIRED"
          ? 410
          : message === "QUEST_DURATION_INCOMPLETE"
            ? 409
            : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
