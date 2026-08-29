import { and, count, desc, eq, gte } from "drizzle-orm";

import type { SponsorInquiryInput } from "@/domain/sponsor-inquiry";
import { getDatabase } from "@/server/db/client";
import { sponsorInquiries, users } from "@/server/db/schema";

const SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_SUBMISSIONS_PER_WINDOW = 3;

export async function createSponsorInquiry(input: SponsorInquiryInput & { userId: string; now?: Date }) {
  const db = getDatabase();
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    if (!user) throw new Error("SESSION_USER_NOT_FOUND");

    const [existing] = await tx
      .select()
      .from(sponsorInquiries)
      .where(
        and(
          eq(sponsorInquiries.userId, input.userId),
          eq(sponsorInquiries.clientRequestId, input.clientRequestId),
        ),
      )
      .limit(1);
    if (existing) return { inquiry: existing, created: false };

    const since = new Date(now.getTime() - SUBMISSION_WINDOW_MS);
    const [volume] = await tx
      .select({ value: count() })
      .from(sponsorInquiries)
      .where(and(eq(sponsorInquiries.userId, input.userId), gte(sponsorInquiries.createdAt, since)));
    if ((volume?.value ?? 0) >= MAX_SUBMISSIONS_PER_WINDOW) {
      throw new Error("SPONSOR_INQUIRY_RATE_LIMITED");
    }

    const [inquiry] = await tx
      .insert(sponsorInquiries)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        clientRequestId: input.clientRequestId,
        companyName: input.companyName,
        contactName: input.contactName,
        contactEmail: input.contactEmail.toLocaleLowerCase("en-US"),
        companyWebsite: input.companyWebsite,
        destinationUrl: input.destinationUrl,
        creativeType: input.creativeType,
        creativeUrl: input.creativeUrl,
        campaignTitle: input.campaignTitle,
        description: input.description,
        status: "RECEIVED",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { inquiry, created: true };
  });
}

export async function listSponsorInquiriesForOperator() {
  return getDatabase()
    .select()
    .from(sponsorInquiries)
    .orderBy(desc(sponsorInquiries.createdAt));
}
