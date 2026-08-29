import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";

export const RECEIPT_TTL_SECONDS = 10 * 60;

export const completionReceiptTypes = {
  CompletionReceipt: [
    { name: "campaignId", type: "uint256" },
    { name: "sessionHash", type: "bytes32" },
    { name: "viewerIdHash", type: "bytes32" },
    { name: "reward", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type CompletionReceipt = {
  campaignId: bigint;
  sessionHash: Hex;
  viewerIdHash: Hex;
  reward: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
};

export type StoredCompletionReceipt = {
  campaignId: string;
  sessionHash: Hex;
  viewerIdHash: Hex;
  reward: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
};

export function isCompletionReceiptExpired(receipt: Pick<CompletionReceipt, "expiresAt">, now: Date) {
  return BigInt(Math.floor(now.getTime() / 1_000)) > receipt.expiresAt;
}

export const storedCompletionReceiptSchema = z.object({
  campaignId: z.string().regex(/^\d+$/),
  sessionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  viewerIdHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  reward: z.string().regex(/^\d+$/),
  issuedAt: z.string().regex(/^\d+$/),
  expiresAt: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^\d+$/),
});

export function completionReceiptDomain(input: {
  chainId: number;
  verifyingContract: Address;
}) {
  return {
    name: "ComputeQuest CampaignEscrow",
    version: "1",
    chainId: input.chainId,
    verifyingContract: input.verifyingContract,
  } as const;
}

export function buildCompletionReceipt(input: {
  campaignId: bigint;
  sessionId: string;
  sessionNonce: string;
  userId: string;
  reward: bigint;
  issuedAtSeconds: bigint;
}) {
  return {
    campaignId: input.campaignId,
    sessionHash: keccak256(stringToHex(`computequest:session:${input.sessionId}:${input.sessionNonce}`)),
    viewerIdHash: keccak256(stringToHex(`computequest:viewer:${input.userId}`)),
    reward: input.reward,
    issuedAt: input.issuedAtSeconds,
    expiresAt: input.issuedAtSeconds + BigInt(RECEIPT_TTL_SECONDS),
    nonce: BigInt(keccak256(stringToHex(`computequest:nonce:${input.sessionNonce}`))),
  } satisfies CompletionReceipt;
}

export function storeCompletionReceipt(receipt: CompletionReceipt): StoredCompletionReceipt {
  return {
    ...receipt,
    campaignId: receipt.campaignId.toString(),
    reward: receipt.reward.toString(),
    issuedAt: receipt.issuedAt.toString(),
    expiresAt: receipt.expiresAt.toString(),
    nonce: receipt.nonce.toString(),
  };
}

export function restoreCompletionReceipt(value: unknown): CompletionReceipt {
  const receipt = storedCompletionReceiptSchema.parse(value) as StoredCompletionReceipt;
  return {
    ...receipt,
    campaignId: BigInt(receipt.campaignId),
    reward: BigInt(receipt.reward),
    issuedAt: BigInt(receipt.issuedAt),
    expiresAt: BigInt(receipt.expiresAt),
    nonce: BigInt(receipt.nonce),
  };
}
