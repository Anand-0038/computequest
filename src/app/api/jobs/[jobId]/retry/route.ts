import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionUserId } from "@/server/auth/session";
import { requireRuntimeEnv } from "@/server/env";
import { retryRefundedJob, runPresentationJob } from "@/server/services/jobs";
import { publicJob, publicTask } from "@/server/http/public-shapes";

const paramsSchema = z.object({ jobId: z.string().uuid() });

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const { jobId } = paramsSchema.parse(await context.params);
    const retried = await retryRefundedJob({ jobId, userId });
    const result = await runPresentationJob({ taskId: retried.taskId, userId });
    return NextResponse.json({ ...result, task: publicTask(result.task), job: publicJob(result.job) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "JOB_RETRY_FAILED";
    const status =
      message === "JOB_NOT_FOUND"
        ? 404
        : message.includes("NOT_RETRYABLE") || message === "JOB_RETRY_LIMIT_REACHED"
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
