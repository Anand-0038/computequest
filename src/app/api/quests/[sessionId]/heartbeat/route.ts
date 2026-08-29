import { NextResponse } from "next/server";

import { heartbeatSchema } from "@/domain/quest";
import { requireRuntimeEnv } from "@/server/env";
import { requireSessionUserId } from "@/server/auth/session";
import { recordHeartbeat } from "@/server/services/quests";
import { publicQuestSession } from "@/server/http/public-shapes";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { sessionId } = await context.params;
    const heartbeat = heartbeatSchema.parse(await request.json());
    const session = await recordHeartbeat({
      sessionId,
      userId,
      heartbeat,
    });
    return NextResponse.json({ session: publicQuestSession(session) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HEARTBEAT_REJECTED";
    return NextResponse.json({ error: message }, { status: message === "QUEST_EXPIRED" ? 410 : 400 });
  }
}
