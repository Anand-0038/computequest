import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionUserId } from "@/server/auth/session";
import { requireRuntimeEnv } from "@/server/env";
import { listEligibleCampaigns } from "@/server/services/campaigns";

const minimumRewardSchema = z.coerce.number().int().min(1).max(1_000);

export async function GET(request: Request) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const minimumReward = minimumRewardSchema.parse(
      new URL(request.url).searchParams.get("minimumReward") ?? "1",
    );
    const campaigns = await listEligibleCampaigns(userId, minimumReward);
    return NextResponse.json({ campaigns });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAMPAIGNS_READ_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
