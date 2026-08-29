import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireMonadRuntimeReady } from "@/server/chain/monad";
import { requireSessionUserId } from "@/server/auth/session";
import { createQuestSession, getQuestForTask } from "@/server/services/quests";
import { publicQuestSession } from "@/server/http/public-shapes";

const requestSchema = z.object({ taskId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const env = requireRuntimeEnv();
    const userId = await requireSessionUserId();
    await requireMonadRuntimeReady();
    const body = requestSchema.parse(await request.json());
    const result = await createQuestSession({
      campaignId: env.DEMO_CAMPAIGN_ID,
      taskId: body.taskId,
      userId,
    });
    return NextResponse.json({ ...result, session: publicQuestSession(result.session) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUEST_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: message.startsWith("MONAD_PREFLIGHT_FAILED") ? 503 : 400 });
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
