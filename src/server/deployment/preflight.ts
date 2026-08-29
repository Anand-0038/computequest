import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const deploymentEnvSchema = z.object({
  MONAD_RPC_URL: z.string().url(),
  MONAD_CHAIN_ID: z.coerce.number().int().positive().default(10143),
  SPONSOR_PRIVATE_KEY: privateKey,
  VERIFIER_PRIVATE_KEY: privateKey,
  RELAYER_PRIVATE_KEY: privateKey,
  DEMO_ONCHAIN_REWARD_WEI: z.coerce.bigint().positive(),
  DEMO_MAX_COMPLETIONS: z.coerce.bigint().positive().max(BigInt(1_000)),
  SPONSOR_DEPLOYMENT_GAS_RESERVE_WEI: z.coerce.bigint().positive().default(BigInt("200000000000000000")),
  RELAYER_MIN_BALANCE_WEI: z.coerce.bigint().positive().default(BigInt("500000000000000000")),
});

type DeploymentEnvironment = z.infer<typeof deploymentEnvSchema>;

export function parseForgeVersion(output: string) {
  const match = output.match(/Version:\s*(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function isSupportedForgeVersion(version: { major: number; minor: number; patch: number } | null) {
  return Boolean(version && (version.major > 1 || (version.major === 1 && version.minor >= 8)));
}

export function evaluateDeploymentPreflight(input: {
  expectedChainId: number;
  observedChainId: number;
  sponsorAddress: Address;
  verifierAddress: Address;
  relayerAddress: Address;
  sponsorBalance: bigint;
  relayerBalance: bigint;
  campaignBudget: bigint;
  sponsorGasReserve: bigint;
  relayerMinimumBalance: bigint;
}) {
  const sponsorMinimumBalance = input.campaignBudget + input.sponsorGasReserve;
  const issues: string[] = [];
  const warnings: string[] = [];
  if (input.observedChainId !== input.expectedChainId) issues.push("CHAIN_ID_MISMATCH");
  if (input.sponsorBalance < sponsorMinimumBalance) issues.push("SPONSOR_BALANCE_INSUFFICIENT");
  if (input.relayerBalance < input.relayerMinimumBalance) issues.push("RELAYER_BALANCE_INSUFFICIENT");
  const uniqueAddresses = new Set([
    input.sponsorAddress.toLowerCase(),
    input.verifierAddress.toLowerCase(),
    input.relayerAddress.toLowerCase(),
  ]);
  if (uniqueAddresses.size < 3) warnings.push("KEY_ROLES_SHARE_AN_ADDRESS");
  return { ready: issues.length === 0, sponsorMinimumBalance, issues, warnings };
}

export function serializeDeploymentEvaluation(
  evaluated: ReturnType<typeof evaluateDeploymentPreflight>,
) {
  return {
    ready: evaluated.ready,
    issues: evaluated.issues,
    warnings: evaluated.warnings,
    sponsorMinimumBalanceWei: evaluated.sponsorMinimumBalance.toString(),
  };
}

export async function preflightMonadDeployment(source: Record<string, string | undefined> = process.env) {
  const parsed = deploymentEnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`DEPLOYMENT_CONFIGURATION_INVALID:${names.join(",")}`);
  }
  const env: DeploymentEnvironment = parsed.data;
  const sponsor = privateKeyToAccount(env.SPONSOR_PRIVATE_KEY as Hex);
  const verifier = privateKeyToAccount(env.VERIFIER_PRIVATE_KEY as Hex);
  const relayer = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
  const chain = defineChain({
    id: env.MONAD_CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [env.MONAD_RPC_URL] } },
    testnet: true,
  });
  const client = createPublicClient({
    chain,
    transport: http(env.MONAD_RPC_URL, { timeout: 15_000, retryCount: 3, retryDelay: 500 }),
  });
  const [observedChainId, sponsorBalance, relayerBalance] = await Promise.all([
    client.getChainId(),
    client.getBalance({ address: sponsor.address }),
    client.getBalance({ address: relayer.address }),
  ]);
  const campaignBudget = env.DEMO_ONCHAIN_REWARD_WEI * env.DEMO_MAX_COMPLETIONS;
  const evaluated = evaluateDeploymentPreflight({
    expectedChainId: env.MONAD_CHAIN_ID,
    observedChainId,
    sponsorAddress: sponsor.address,
    verifierAddress: verifier.address,
    relayerAddress: relayer.address,
    sponsorBalance,
    relayerBalance,
    campaignBudget,
    sponsorGasReserve: env.SPONSOR_DEPLOYMENT_GAS_RESERVE_WEI,
    relayerMinimumBalance: env.RELAYER_MIN_BALANCE_WEI,
  });
  return {
    ...serializeDeploymentEvaluation(evaluated),
    checkedAt: new Date().toISOString(),
    chainId: observedChainId,
    sponsorAddress: sponsor.address,
    verifierAddress: verifier.address,
    relayerAddress: relayer.address,
    sponsorBalanceWei: sponsorBalance.toString(),
    relayerBalanceWei: relayerBalance.toString(),
    campaignBudgetWei: campaignBudget.toString(),
    relayerMinimumBalanceWei: env.RELAYER_MIN_BALANCE_WEI.toString(),
    rewardWei: env.DEMO_ONCHAIN_REWARD_WEI.toString(),
    maxCompletions: env.DEMO_MAX_COMPLETIONS.toString(),
  };
}
