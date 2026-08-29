import { sql } from "drizzle-orm";

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
  const [campaign] = await db
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
      active: true,
    })
    .onConflictDoUpdate({
      target: campaigns.id,
      set: {
        onchainCampaignId: input.onchainCampaignId,
        creditReward: input.creditReward,
        onchainRewardWei: input.onchainRewardWei,
        requiredActiveSeconds: input.requiredActiveSeconds,
        creativeTitle: input.creativeTitle,
        completionQuestion: input.completionQuestion,
        completionAnswerHash: input.completionAnswerHash,
        remainingBudget: sql<number>`case
          when ${campaigns.onchainCampaignId} is distinct from ${input.onchainCampaignId}
            then ${input.fullBudget}
          else ${campaigns.remainingBudget}
        end`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return campaign;
}
