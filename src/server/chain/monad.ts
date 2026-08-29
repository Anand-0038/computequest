import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { CompletionReceipt } from "@/domain/settlement";
import { requireMonadEnv } from "@/server/env";

const MONAD_TRANSACTION_GAS_LIMIT = BigInt(30_000_000);
const GAS_LIMIT_BUFFER_NUMERATOR = BigInt(11);
const GAS_LIMIT_BUFFER_DENOMINATOR = BigInt(10);

export const campaignEscrowAbi = [
  {
    type: "event",
    name: "CompletionSettled",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "sessionHash", type: "bytes32", indexed: true },
      { name: "viewerIdHash", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "payoutRecipient", type: "address", indexed: false },
    ],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "consumedSessionHash",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "campaigns",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "sponsor", type: "address" },
      { name: "payoutRecipient", type: "address" },
      { name: "remainingBudget", type: "uint256" },
      { name: "rewardPerCompletion", type: "uint256" },
      { name: "maxCompletions", type: "uint64" },
      { name: "completionCount", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "settleVerifiedCompletion",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "receipt",
        type: "tuple",
        components: [
          { name: "campaignId", type: "uint256" },
          { name: "sessionHash", type: "bytes32" },
          { name: "viewerIdHash", type: "bytes32" },
          { name: "reward", type: "uint256" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function getMonadClients() {
  const env = requireMonadEnv();
  const chain = defineChain({
    id: env.MONAD_CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [env.MONAD_RPC_URL] } },
    blockExplorers: { default: { name: "Monad Explorer", url: env.MONAD_EXPLORER_BASE_URL } },
    testnet: true,
  });
  const relayer = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(env.MONAD_RPC_URL, { timeout: 15_000, retryCount: 3, retryDelay: 500 });
  return {
    env,
    chain,
    relayer,
    verifier: privateKeyToAccount(env.VERIFIER_PRIVATE_KEY as Hex),
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account: relayer, chain, transport }),
  };
}

export type MonadPreflightReport = {
  ready: boolean;
  checkedAt: string;
  chainId: number;
  escrowAddress: Address;
  campaignId: string;
  bytecodePresent: boolean;
  verifierMatches: boolean;
  campaignActive: boolean;
  rewardMatches: boolean;
  capacityAvailable: boolean;
  budgetSufficient: boolean;
  payoutRecipientMatchesRelayer: boolean;
  remainingBudgetWei: string;
  remainingCompletions: string;
  relayerAddress: Address;
  relayerBalanceWei: string;
  minimumRelayerBalanceWei: string;
  relayerBalanceSufficient: boolean;
  issues: string[];
};

export function evaluateMonadPreflight(input: {
  expectedChainId: number;
  observedChainId: number;
  bytecodePresent: boolean;
  expectedVerifier: Address;
  observedVerifier: Address;
  expectedReward: bigint;
  rewardPerCompletion: bigint;
  active: boolean;
  maxCompletions: bigint;
  completionCount: bigint;
  remainingBudget: bigint;
  expectedPayoutRecipient: Address;
  observedPayoutRecipient: Address;
  relayerBalance: bigint;
  minimumRelayerBalance: bigint;
}) {
  const issues: string[] = [];
  const verifierMatches = getAddress(input.observedVerifier) === getAddress(input.expectedVerifier);
  const rewardMatches = input.rewardPerCompletion === input.expectedReward;
  const capacityAvailable = input.completionCount < input.maxCompletions;
  const budgetSufficient = input.remainingBudget >= input.expectedReward;
  const payoutRecipientMatchesRelayer =
    getAddress(input.observedPayoutRecipient) === getAddress(input.expectedPayoutRecipient);
  const relayerBalanceSufficient = input.relayerBalance >= input.minimumRelayerBalance;
  if (input.observedChainId !== input.expectedChainId) issues.push("CHAIN_ID_MISMATCH");
  if (!input.bytecodePresent) issues.push("ESCROW_BYTECODE_MISSING");
  if (!verifierMatches) issues.push("ONCHAIN_VERIFIER_MISMATCH");
  if (!input.active) issues.push("CAMPAIGN_INACTIVE");
  if (!rewardMatches) issues.push("CAMPAIGN_REWARD_MISMATCH");
  if (!capacityAvailable) issues.push("CAMPAIGN_CAPACITY_EXHAUSTED");
  if (!budgetSufficient) issues.push("CAMPAIGN_BUDGET_INSUFFICIENT");
  if (!payoutRecipientMatchesRelayer) issues.push("CAMPAIGN_PAYOUT_RECIPIENT_MISMATCH");
  if (!relayerBalanceSufficient) issues.push("RELAYER_BALANCE_INSUFFICIENT");
  return {
    ready: issues.length === 0,
    verifierMatches,
    rewardMatches,
    capacityAvailable,
    budgetSufficient,
    payoutRecipientMatchesRelayer,
    relayerBalanceSufficient,
    issues,
  };
}

export async function preflightMonadRuntime(expected?: {
  campaignId: bigint;
  rewardWei: bigint;
}): Promise<MonadPreflightReport> {
  const { env, publicClient, relayer, verifier } = getMonadClients();
  const escrowAddress = env.CAMPAIGN_ESCROW_ADDRESS as Address;
  const campaignId = expected?.campaignId ?? env.DEMO_ONCHAIN_CAMPAIGN_ID;
  const expectedRewardWei = expected?.rewardWei ?? env.DEMO_ONCHAIN_REWARD_WEI;
  const [observedChainId, bytecode, relayerBalance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: escrowAddress }),
    publicClient.getBalance({ address: relayer.address }),
  ]);
  const bytecodePresent = Boolean(bytecode && bytecode !== "0x");
  if (!bytecodePresent) {
    return missingEscrowPreflightReport({
      checkedAt: new Date().toISOString(),
      expectedChainId: env.MONAD_CHAIN_ID,
      observedChainId,
      escrowAddress,
      campaignId: campaignId.toString(),
      relayerAddress: relayer.address,
      relayerBalance,
      minimumRelayerBalance: env.RELAYER_MIN_BALANCE_WEI,
    });
  }
  const [observedVerifier, campaign] = await Promise.all([
    publicClient.readContract({ address: escrowAddress, abi: campaignEscrowAbi, functionName: "verifier" }),
    publicClient.readContract({
      address: escrowAddress,
      abi: campaignEscrowAbi,
      functionName: "campaigns",
      args: [campaignId],
    }),
  ]);
  const [sponsor, payoutRecipient, remainingBudget, rewardPerCompletion, maxCompletions, completionCount, active] =
    campaign;
  const campaignActive = active && sponsor !== "0x0000000000000000000000000000000000000000";
  const base = evaluateMonadPreflight({
    expectedChainId: env.MONAD_CHAIN_ID,
    observedChainId,
    bytecodePresent,
    expectedVerifier: verifier.address,
    observedVerifier,
    expectedReward: expectedRewardWei,
    rewardPerCompletion,
    active: campaignActive,
    maxCompletions,
    completionCount,
    remainingBudget,
    expectedPayoutRecipient: relayer.address,
    observedPayoutRecipient: payoutRecipient,
    relayerBalance,
    minimumRelayerBalance: env.RELAYER_MIN_BALANCE_WEI,
  });
  return {
    ...base,
    checkedAt: new Date().toISOString(),
    chainId: observedChainId,
    escrowAddress,
    campaignId: campaignId.toString(),
    bytecodePresent,
    campaignActive,
    remainingBudgetWei: remainingBudget.toString(),
    remainingCompletions: (maxCompletions - completionCount).toString(),
    relayerAddress: relayer.address,
    relayerBalanceWei: relayerBalance.toString(),
    minimumRelayerBalanceWei: env.RELAYER_MIN_BALANCE_WEI.toString(),
  };
}

export function missingEscrowPreflightReport(input: {
  checkedAt: string;
  expectedChainId: number;
  observedChainId: number;
  escrowAddress: Address;
  campaignId: string;
  relayerAddress: Address;
  relayerBalance: bigint;
  minimumRelayerBalance: bigint;
}): MonadPreflightReport {
  const relayerBalanceSufficient = input.relayerBalance >= input.minimumRelayerBalance;
  const issues: string[] = [];
  if (input.observedChainId !== input.expectedChainId) issues.push("CHAIN_ID_MISMATCH");
  issues.push("ESCROW_BYTECODE_MISSING");
  if (!relayerBalanceSufficient) issues.push("RELAYER_BALANCE_INSUFFICIENT");
  return {
    ready: false,
    checkedAt: input.checkedAt,
    chainId: input.observedChainId,
    escrowAddress: input.escrowAddress,
    campaignId: input.campaignId,
    bytecodePresent: false,
    verifierMatches: false,
    campaignActive: false,
    rewardMatches: false,
    capacityAvailable: false,
    budgetSufficient: false,
    payoutRecipientMatchesRelayer: false,
    remainingBudgetWei: "0",
    remainingCompletions: "0",
    relayerAddress: input.relayerAddress,
    relayerBalanceWei: input.relayerBalance.toString(),
    minimumRelayerBalanceWei: input.minimumRelayerBalance.toString(),
    relayerBalanceSufficient,
    issues,
  };
}

const cachedPreflights = new Map<string, { expiresAt: number; report: MonadPreflightReport }>();

export async function getCachedMonadPreflight(expected?: { campaignId: bigint; rewardWei: bigint }) {
  const key = expected ? `${expected.campaignId}:${expected.rewardWei}` : "demo";
  const cached = cachedPreflights.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  const report = await preflightMonadRuntime(expected);
  cachedPreflights.set(key, { expiresAt: Date.now() + 30_000, report });
  return report;
}

export async function requireMonadRuntimeReady() {
  const report = await getCachedMonadPreflight();
  if (!report.ready) throw new Error(`MONAD_PREFLIGHT_FAILED:${report.issues.join(",")}`);
  return report;
}

export async function requireCampaignRuntimeReady(campaignId: bigint, rewardWei: bigint) {
  const report = await getCachedMonadPreflight({ campaignId, rewardWei });
  if (!report.ready) throw new Error(`MONAD_CAMPAIGN_PREFLIGHT_FAILED:${report.issues.join(",")}`);
  return report;
}

export async function assertOnchainVerifier() {
  const { env, publicClient, verifier } = getMonadClients();
  const configured = await publicClient.readContract({
    address: env.CAMPAIGN_ESCROW_ADDRESS as Address,
    abi: campaignEscrowAbi,
    functionName: "verifier",
  });
  if (getAddress(configured) !== getAddress(verifier.address)) {
    throw new Error("ONCHAIN_VERIFIER_MISMATCH");
  }
  return verifier;
}

let relayerSubmissionQueue: Promise<void> = Promise.resolve();

export function submitCompletionSettlement(receipt: CompletionReceipt, signature: Hex) {
  const submission = relayerSubmissionQueue.then(
    () => submitCompletionSettlementNow(receipt, signature),
    () => submitCompletionSettlementNow(receipt, signature),
  );
  relayerSubmissionQueue = submission.then(
    () => undefined,
    () => undefined,
  );
  return submission;
}

async function submitCompletionSettlementNow(receipt: CompletionReceipt, signature: Hex) {
  const { env, publicClient, relayer, walletClient } = getMonadClients();
  const address = env.CAMPAIGN_ESCROW_ADDRESS as Address;
  const { request } = await publicClient.simulateContract({
    account: relayer,
    address,
    abi: campaignEscrowAbi,
    functionName: "settleVerifiedCompletion",
    args: [receipt, signature],
  });
  const estimatedGas = await publicClient.estimateContractGas({
    account: relayer,
    address,
    abi: campaignEscrowAbi,
    functionName: "settleVerifiedCompletion",
    args: [receipt, signature],
  });
  const gas = calculateMonadGasLimit(estimatedGas);
  return walletClient.writeContract({ ...request, gas });
}

export function calculateMonadGasLimit(estimatedGas: bigint) {
  if (estimatedGas <= BigInt(0)) throw new Error("MONAD_GAS_ESTIMATE_INVALID");
  const buffered =
    (estimatedGas * GAS_LIMIT_BUFFER_NUMERATOR + GAS_LIMIT_BUFFER_DENOMINATOR - BigInt(1)) /
    GAS_LIMIT_BUFFER_DENOMINATOR;
  if (buffered > MONAD_TRANSACTION_GAS_LIMIT) {
    throw new Error("MONAD_TRANSACTION_GAS_LIMIT_EXCEEDED");
  }
  return buffered;
}

export async function simulateCompletionSettlement(receipt: CompletionReceipt, signature: Hex) {
  const { env, publicClient, relayer } = getMonadClients();
  await publicClient.simulateContract({
    account: relayer,
    address: env.CAMPAIGN_ESCROW_ADDRESS as Address,
    abi: campaignEscrowAbi,
    functionName: "settleVerifiedCompletion",
    args: [receipt, signature],
  });
}

export async function waitForSettlement(transactionHash: Hex) {
  const { publicClient } = getMonadClients();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== "success") return receipt;

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const finalized = await publicClient.getBlock({ blockTag: "finalized" });
    if (finalized.number >= receipt.blockNumber) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("MONAD_FINALITY_TIMEOUT");
}

export async function isSessionConsumed(sessionHash: Hex) {
  const { env, publicClient } = getMonadClients();
  return publicClient.readContract({
    address: env.CAMPAIGN_ESCROW_ADDRESS as Address,
    abi: campaignEscrowAbi,
    functionName: "consumedSessionHash",
    args: [sessionHash],
  });
}

export async function findSettlementBySessionHash(sessionHash: Hex) {
  const { env, publicClient } = getMonadClients();
  const latestBlock = await publicClient.getBlockNumber();
  for (const { fromBlock, toBlock } of settlementRecoveryBlockRanges(
    latestBlock,
    env.CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK,
  )) {
    const logs = await publicClient.getLogs({
      address: env.CAMPAIGN_ESCROW_ADDRESS as Address,
      event: campaignEscrowAbi[0],
      args: { sessionHash },
      fromBlock,
      toBlock,
    });
    const recovered = logs.at(-1);
    if (recovered?.transactionHash && recovered.blockNumber !== null) {
      return { transactionHash: recovered.transactionHash, blockNumber: recovered.blockNumber };
    }
  }
  return null;
}

export function* settlementRecoveryBlockRanges(
  latestBlock: bigint,
  deploymentBlock: bigint,
  chunkSize = BigInt(50_000),
) {
  if (chunkSize <= BigInt(0)) throw new Error("MONAD_RECOVERY_CHUNK_INVALID");
  if (deploymentBlock > latestBlock) throw new Error("MONAD_DEPLOYMENT_BLOCK_IN_FUTURE");
  let toBlock = latestBlock;
  while (toBlock >= deploymentBlock) {
    const candidateFrom = toBlock >= chunkSize ? toBlock - chunkSize + BigInt(1) : BigInt(0);
    const fromBlock = candidateFrom > deploymentBlock ? candidateFrom : deploymentBlock;
    yield { fromBlock, toBlock };
    if (fromBlock === deploymentBlock) break;
    toBlock = fromBlock - BigInt(1);
  }
}
