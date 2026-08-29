import { and, eq, gte, notInArray, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { campaignRewardClaims, campaigns, questSessions } from "@/server/db/schema";

export type CampaignMetadata = {
  id: string;
  onchainCampaignId: bigint;
  creditReward: number;
  onchainRewardWei: bigint;
  requiredActiveSeconds: number;
  sponsorName?: string;
  campaignLabel?: string;
  creativeTitle: string;
  creativeUrl?: string;
  creativeDescription?: string;
  destinationUrl?: string;
  disclosure?: string;
  completionQuestion: string;
  completionAnswerHash: string;
  fullBudget: number;
};

export async function upsertCampaign(input: CampaignMetadata) {
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
        sponsorName: input.sponsorName ?? "Monad",
        campaignLabel: input.campaignLabel ?? "ECOSYSTEM CAMPAIGN",
        creativeTitle: input.creativeTitle,
        creativeUrl: input.creativeUrl ?? "/media/monad-parallel-execution.mp4",
        creativeDescription: input.creativeDescription ?? "",
        destinationUrl: input.destinationUrl ?? "https://docs.monad.xyz",
        disclosure: input.disclosure ?? "Independent educational creative. Settlement runs on Monad Testnet.",
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
          sponsorName: campaigns.sponsorName,
          campaignLabel: campaigns.campaignLabel,
          creativeTitle: campaigns.creativeTitle,
          creativeUrl: campaigns.creativeUrl,
          creativeDescription: campaigns.creativeDescription,
          destinationUrl: campaigns.destinationUrl,
          disclosure: campaigns.disclosure,
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
        sponsorName: input.sponsorName ?? campaign.sponsorName,
        campaignLabel: input.campaignLabel ?? campaign.campaignLabel,
        creativeTitle: input.creativeTitle,
        creativeUrl: input.creativeUrl ?? campaign.creativeUrl,
        creativeDescription: input.creativeDescription ?? campaign.creativeDescription,
        destinationUrl: input.destinationUrl ?? campaign.destinationUrl,
        disclosure: input.disclosure ?? campaign.disclosure,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaign.id))
      .returning();
    return updated;
  });
}

export const upsertDemoCampaign = upsertCampaign;

export async function listEligibleCampaigns(userId: string, minimumReward = 1) {
  const db = getDatabase();
  const claimed = db
    .select({ campaignId: campaignRewardClaims.campaignId })
    .from(campaignRewardClaims)
    .where(eq(campaignRewardClaims.userId, userId));

  return db
    .select({
      id: campaigns.id,
      sponsorName: campaigns.sponsorName,
      campaignLabel: campaigns.campaignLabel,
      creativeTitle: campaigns.creativeTitle,
      creativeDescription: campaigns.creativeDescription,
      destinationUrl: campaigns.destinationUrl,
      disclosure: campaigns.disclosure,
      creditReward: campaigns.creditReward,
      requiredActiveSeconds: campaigns.requiredActiveSeconds,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.active, true),
        sql`${campaigns.remainingBudget} - ${campaigns.reservedBudget} >= ${campaigns.creditReward}`,
        gte(campaigns.creditReward, minimumReward),
        notInArray(campaigns.id, claimed),
      ),
    );
}

export async function getActiveCampaignSettlementIdentity(campaignId: string) {
  const db = getDatabase();
  const [campaign] = await db
    .select({
      onchainCampaignId: campaigns.onchainCampaignId,
      onchainRewardWei: campaigns.onchainRewardWei,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.active, true)))
    .limit(1);
  if (!campaign || campaign.onchainCampaignId === null) throw new Error("ACTIVE_CAMPAIGN_NOT_FOUND");
  return {
    onchainCampaignId: campaign.onchainCampaignId,
    onchainRewardWei: campaign.onchainRewardWei,
  };
}

export async function getQuestCampaignSettlementIdentity(input: {
  sessionId: string;
  userId: string;
}) {
  const db = getDatabase();
  const [campaign] = await db
    .select({
      onchainCampaignId: campaigns.onchainCampaignId,
      onchainRewardWei: campaigns.onchainRewardWei,
    })
    .from(questSessions)
    .innerJoin(campaigns, eq(campaigns.id, questSessions.campaignId))
    .where(
      and(
        eq(questSessions.id, input.sessionId),
        eq(questSessions.userId, input.userId),
        eq(campaigns.active, true),
      ),
    )
    .limit(1);
  if (!campaign || campaign.onchainCampaignId === null) throw new Error("ACTIVE_CAMPAIGN_NOT_FOUND");
  return {
    onchainCampaignId: campaign.onchainCampaignId,
    onchainRewardWei: campaign.onchainRewardWei,
  };
}

export function publicCampaign(campaign: typeof campaigns.$inferSelect) {
  return {
    id: campaign.id,
    sponsorName: campaign.sponsorName,
    campaignLabel: campaign.campaignLabel,
    creativeTitle: campaign.creativeTitle,
    creativeUrl: campaign.creativeUrl,
    creativeDescription: campaign.creativeDescription,
    destinationUrl: campaign.destinationUrl,
    disclosure: campaign.disclosure,
    creditReward: campaign.creditReward,
    requiredActiveSeconds: campaign.requiredActiveSeconds,
  };
}
