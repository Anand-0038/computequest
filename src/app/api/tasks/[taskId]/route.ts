import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireSessionUserId } from "@/server/auth/session";
import { getTaskForUser } from "@/server/services/tasks";
import {
  publicJob,
  publicQuestSession,
  publicSettlementAttempt,
  publicSettlementSnapshot,
  publicTask,
} from "@/server/http/public-shapes";

const paramsSchema = z.object({ taskId: z.string().uuid() });

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { taskId } = paramsSchema.parse(await context.params);
    const task = await getTaskForUser(taskId, userId);
    return task
      ? NextResponse.json({
          ...task,
          task: publicTask(task.task),
          job: task.job ? publicJob(task.job) : null,
          quest: task.quest ? publicQuestSession(task.quest) : null,
          settlement: task.settlement ? publicSettlementSnapshot(task.settlement) : null,
          relayAttempts: task.relayAttempts.map(publicSettlementAttempt),
        })
      : NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TASK_READ_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
