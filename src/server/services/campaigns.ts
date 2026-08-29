import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { campaigns } from "@/server/db/schema";

export async function upsertDemoCampaign(input: {
  id: string;
  onchainCampaignId: bigint;
  creditReward: number;
  onchainRewardWei: bigint;
  requiredActiveSeconds: number;
  creativeTitle: string;
  completionQuestion: string;
  completionAnswerHash: string;
  fullBudget: number;
}) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        id: input.id,
        onchainCampaignId: input.onchainCampaignId,
        creditReward: input.creditReward,
        onchainRewardWei: input.onchainRewardWei,
        requiredActiveSeconds: input.requiredActiveSeconds,
        creativeTitle: input.creativeTitle,
        completionQuestion: input.completionQuestion,
        completionAnswerHash: input.completionAnswerHash,
        remainingBudget: input.fullBudget,
        reservedBudget: 0,
        active: true,
      })
      .onConflictDoUpdate({
        target: campaigns.id,
        set: {
          onchainCampaignId: campaigns.onchainCampaignId,
          creditReward: campaigns.creditReward,
          onchainRewardWei: campaigns.onchainRewardWei,
          requiredActiveSeconds: campaigns.requiredActiveSeconds,
          creativeTitle: campaigns.creativeTitle,
          completionQuestion: campaigns.completionQuestion,
          completionAnswerHash: campaigns.completionAnswerHash,
          remainingBudget: campaigns.remainingBudget,
          reservedBudget: campaigns.reservedBudget,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (
      campaign.onchainCampaignId !== input.onchainCampaignId ||
      campaign.creditReward !== input.creditReward ||
      campaign.onchainRewardWei !== input.onchainRewardWei ||
      campaign.requiredActiveSeconds !== input.requiredActiveSeconds ||
      campaign.completionQuestion !== input.completionQuestion ||
      campaign.completionAnswerHash !== input.completionAnswerHash
    ) {
      throw new Error("CAMPAIGN_IDENTITY_IMMUTABLE_USE_NEW_UUID");
    }
    const [updated] = await tx
      .update(campaigns)
      .set({
        creativeTitle: input.creativeTitle,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaign.id))
      .returning();
    return updated;
  });
}
