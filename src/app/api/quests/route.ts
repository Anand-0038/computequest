import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireCampaignRuntimeReady } from "@/server/chain/monad";
import { requireSessionUserId } from "@/server/auth/session";
import { createQuestSession, getQuestForTask } from "@/server/services/quests";
import { getActiveCampaignSettlementIdentity } from "@/server/services/campaigns";
import { publicQuestSession } from "@/server/http/public-shapes";

const requestSchema = z.object({ taskId: z.string().uuid(), campaignId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const body = requestSchema.parse(await request.json());
    const campaign = await getActiveCampaignSettlementIdentity(body.campaignId);
    await requireCampaignRuntimeReady(campaign.onchainCampaignId, campaign.onchainRewardWei);
    const result = await createQuestSession({
      campaignId: body.campaignId,
      taskId: body.taskId,
      userId,
    });
    return NextResponse.json({ ...result, session: publicQuestSession(result.session) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUEST_CREATE_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("MONAD_") ? 503 : 400 },
    );
  }
}

export async function GET(request: Request) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const taskId = z.string().uuid().parse(new URL(request.url).searchParams.get("taskId"));
    const quest = await getQuestForTask({ taskId, userId });
    return quest
      ? NextResponse.json({ ...quest, session: publicQuestSession(quest.session) })
      : NextResponse.json(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUEST_READ_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
