import { keccak256, stringToHex } from "viem";

import { QUEST_REWARD } from "../src/domain/constants";
import { closeDatabase } from "../src/server/db/client";
import { readOptionalPayZollCampaignEnv, requireRuntimeEnv } from "../src/server/env";
import { upsertCampaign } from "../src/server/services/campaigns";

async function main() {
  const env = requireRuntimeEnv();
  const payZoll = readOptionalPayZollCampaignEnv();
  const normalizedAnswer = env.DEMO_QUEST_ANSWER.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

  try {
    await upsertCampaign({
      id: env.DEMO_CAMPAIGN_ID,
      onchainCampaignId: env.DEMO_ONCHAIN_CAMPAIGN_ID,
      creditReward: QUEST_REWARD,
      onchainRewardWei: env.DEMO_ONCHAIN_REWARD_WEI,
      requiredActiveSeconds: env.DEMO_QUEST_SECONDS,
      sponsorName: "Monad",
      campaignLabel: "ECOSYSTEM CAMPAIGN",
      creativeTitle: "Monad parallel execution in 30 seconds",
      creativeUrl: "/media/monad-parallel-execution.mp4",
      creativeDescription: "See how independent transactions execute concurrently while Monad preserves deterministic results and EVM compatibility.",
      destinationUrl: "https://docs.monad.xyz",
      disclosure: "Independent educational creative about Monad. Settlement runs on Monad Testnet.",
      completionQuestion: "What execution model lets Monad process independent work concurrently?",
      completionAnswerHash: keccak256(stringToHex(normalizedAnswer)),
      fullBudget: QUEST_REWARD * env.DEMO_MAX_COMPLETIONS,
    });
    if (payZoll) {
      await upsertCampaign({
        id: payZoll.PAYZOLL_CAMPAIGN_ID,
        onchainCampaignId: payZoll.PAYZOLL_ONCHAIN_CAMPAIGN_ID,
        creditReward: QUEST_REWARD,
        onchainRewardWei: payZoll.PAYZOLL_ONCHAIN_REWARD_WEI,
        requiredActiveSeconds: payZoll.PAYZOLL_QUEST_SECONDS,
        sponsorName: "PayZoll",
        campaignLabel: "PARTNER CAMPAIGN",
        creativeTitle: "USDC in. INR out.",
        creativeUrl: "/media/payzoll-global-payments.mp4",
        creativeDescription: "Receive global USDC or USDT payments and settle eligible inward remittances to an Indian bank account with remittance documentation.",
        destinationUrl: "https://payzoll.finance",
        disclosure: "Partner creative for PayZoll. Campaign settlement runs on Monad Testnet.",
        completionQuestion: "",
        completionAnswerHash: keccak256(stringToHex("no quiz")),
        fullBudget: QUEST_REWARD * payZoll.PAYZOLL_MAX_COMPLETIONS,
      });
    }
    console.log("ComputeQuest campaign metadata seed complete; /api/health remains the on-chain readiness gate.");
  } finally {
    await closeDatabase();
  }
}

void main();
