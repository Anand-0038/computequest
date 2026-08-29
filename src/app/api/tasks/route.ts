import { NextResponse } from "next/server";
import { z } from "zod";

import { createPresentationTask } from "@/server/services/tasks";
import { requireRuntimeEnv } from "@/server/env";
import { requireSessionUserId } from "@/server/auth/session";
import { publicTask } from "@/server/http/public-shapes";

const requestSchema = z.object({ prompt: z.string().trim().min(12).max(1_000) });

export async function POST(request: Request) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const body = requestSchema.parse(await request.json());
    const result = await createPresentationTask({ userId, prompt: body.prompt });
    return NextResponse.json({ ...result, task: publicTask(result.task) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TASK_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
