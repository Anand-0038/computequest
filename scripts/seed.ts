import { keccak256, stringToHex } from "viem";

import { QUEST_REWARD } from "../src/domain/constants";
import { closeDatabase } from "../src/server/db/client";
import { requireRuntimeEnv } from "../src/server/env";
import { upsertDemoCampaign } from "../src/server/services/campaigns";

async function main() {
  const env = requireRuntimeEnv();
  const normalizedAnswer = env.DEMO_QUEST_ANSWER.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

  try {
    await upsertDemoCampaign({
      id: env.DEMO_CAMPAIGN_ID,
      onchainCampaignId: env.DEMO_ONCHAIN_CAMPAIGN_ID,
      creditReward: QUEST_REWARD,
      onchainRewardWei: env.DEMO_ONCHAIN_REWARD_WEI,
      requiredActiveSeconds: env.DEMO_QUEST_SECONDS,
      creativeTitle: "Monad parallel execution in 30 seconds",
      completionQuestion: "What execution model lets Monad process independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex(normalizedAnswer)),
      fullBudget: QUEST_REWARD * env.DEMO_MAX_COMPLETIONS,
    });
    console.log("ComputeQuest campaign metadata seed complete; /api/health remains the on-chain readiness gate.");
  } finally {
    await closeDatabase();
  }
}

void main();
