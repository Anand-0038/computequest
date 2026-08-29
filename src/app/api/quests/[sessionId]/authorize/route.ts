import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireMonadRuntimeReady } from "@/server/chain/monad";
import { requireSessionUserId } from "@/server/auth/session";
import { authorizeQuestCompletion } from "@/server/services/settlements";

const paramsSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    await requireMonadRuntimeReady();
    const { sessionId } = paramsSchema.parse(await context.params);
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
      message.startsWith("MONAD_PREFLIGHT_FAILED")
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
