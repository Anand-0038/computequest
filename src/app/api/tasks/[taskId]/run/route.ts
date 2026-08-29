import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRuntimeEnv } from "@/server/env";
import { requireSessionUserId } from "@/server/auth/session";
import { runPresentationJob } from "@/server/services/jobs";
import { publicJob, publicTask } from "@/server/http/public-shapes";

const paramsSchema = z.object({ taskId: z.string().uuid() });

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { taskId } = paramsSchema.parse(await context.params);
    const result = await runPresentationJob({ taskId, userId });
    return NextResponse.json(
      { ...result, task: publicTask(result.task), job: publicJob(result.job) },
      { status: result.job.status === "PROCESSING" && !result.execute ? 202 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "JOB_RUN_FAILED";
    const status = message === "TASK_NOT_FOUND" ? 404 : message.includes("PROCESSING") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
