import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireMonadEnv } from "../src/server/env";

const PAYZOLL_ONCHAIN_CAMPAIGN_ID = BigInt(2);
const PAYZOLL_REWARD_WEI = BigInt("1000000000000000");
const PAYZOLL_MAX_COMPLETIONS = BigInt(20);
const PAYZOLL_BUDGET_WEI = PAYZOLL_REWARD_WEI * PAYZOLL_MAX_COMPLETIONS;
const MONAD_TRANSACTION_GAS_LIMIT = BigInt(30_000_000);

const campaignEscrowAbi = parseAbi([
  "function nextCampaignId() view returns (uint256)",
  "function createCampaign(address payoutRecipient, uint256 rewardPerCompletion, uint64 maxCompletions) payable returns (uint256)",
  "function campaigns(uint256) view returns (address sponsor, address payoutRecipient, uint256 remainingBudget, uint256 rewardPerCompletion, uint64 maxCompletions, uint64 completionCount, bool active)",
]);

async function assertCampaign(publicClient: ReturnType<typeof createPublicClient>, escrow: `0x${string}`) {
  const campaign = await publicClient.readContract({
    address: escrow,
    abi: campaignEscrowAbi,
    functionName: "campaigns",
    args: [PAYZOLL_ONCHAIN_CAMPAIGN_ID],
  });
  if (
    campaign[2] !== PAYZOLL_BUDGET_WEI ||
    campaign[3] !== PAYZOLL_REWARD_WEI ||
    campaign[4] !== PAYZOLL_MAX_COMPLETIONS ||
    campaign[5] !== BigInt(0) ||
    !campaign[6]
  ) {
    throw new Error("PAYZOLL_CAMPAIGN_STATE_MISMATCH");
  }
  return campaign;
}

async function main() {
  const env = requireMonadEnv();
  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
  const chain = {
    id: env.MONAD_CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [env.MONAD_RPC_URL] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(env.MONAD_RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(env.MONAD_RPC_URL) });
  const escrow = env.CAMPAIGN_ESCROW_ADDRESS as `0x${string}`;

  const chainId = await publicClient.getChainId();
  if (chainId !== 10_143 || env.MONAD_CHAIN_ID !== 10_143) throw new Error("MONAD_TESTNET_CHAIN_ID_MISMATCH");

  const nextCampaignId = await publicClient.readContract({
    address: escrow,
    abi: campaignEscrowAbi,
    functionName: "nextCampaignId",
  });
  if (nextCampaignId > PAYZOLL_ONCHAIN_CAMPAIGN_ID) {
    await assertCampaign(publicClient, escrow);
    console.log("PayZoll campaign 2 already exists with the expected immutable economics.");
    return;
  }
  if (nextCampaignId !== PAYZOLL_ONCHAIN_CAMPAIGN_ID) {
    throw new Error(`UNEXPECTED_NEXT_CAMPAIGN_ID_${nextCampaignId}`);
  }

  const args = [account.address, PAYZOLL_REWARD_WEI, PAYZOLL_MAX_COMPLETIONS] as const;
  await publicClient.simulateContract({
    account,
    address: escrow,
    abi: campaignEscrowAbi,
    functionName: "createCampaign",
    args,
    value: PAYZOLL_BUDGET_WEI,
  });
  const estimatedGas = await publicClient.estimateContractGas({
    account,
    address: escrow,
    abi: campaignEscrowAbi,
    functionName: "createCampaign",
    args,
    value: PAYZOLL_BUDGET_WEI,
  });
  const gas = (estimatedGas * BigInt(110) + BigInt(99)) / BigInt(100);
  if (gas > MONAD_TRANSACTION_GAS_LIMIT) throw new Error("PAYZOLL_CAMPAIGN_GAS_LIMIT_EXCEEDED");

  const hash = await walletClient.writeContract({
    address: escrow,
    abi: campaignEscrowAbi,
    functionName: "createCampaign",
    args,
    value: PAYZOLL_BUDGET_WEI,
    gas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error("PAYZOLL_CAMPAIGN_TRANSACTION_REVERTED");
  await assertCampaign(publicClient, escrow);
  console.log(`PayZoll campaign 2 created: ${env.MONAD_EXPLORER_BASE_URL}/tx/${hash}`);
}

void main();
