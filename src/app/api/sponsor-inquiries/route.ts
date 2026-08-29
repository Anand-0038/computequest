import { NextResponse } from "next/server";

import { sponsorInquirySchema } from "@/domain/sponsor-inquiry";
import { requireSessionUserId } from "@/server/auth/session";
import { requireRuntimeEnv } from "@/server/env";
import { createSponsorInquiry } from "@/server/services/sponsor-inquiries";

export async function POST(request: Request) {
  try {
    requireRuntimeEnv();
    const userId = await requireSessionUserId();
    const input = sponsorInquirySchema.parse(await request.json());
    const result = await createSponsorInquiry({ ...input, userId });
    return NextResponse.json(
      {
        inquiry: {
          id: result.inquiry.id,
          status: result.inquiry.status,
          createdAt: result.inquiry.createdAt,
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "SPONSOR_INQUIRY_FAILED";
    const status = message === "SPONSOR_INQUIRY_RATE_LIMITED" ? 429 : message === "SESSION_REQUIRED" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
