import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  RECEIPT_TTL_SECONDS,
  buildCompletionReceipt,
  isCompletionReceiptExpired,
  restoreCompletionReceipt,
  storeCompletionReceipt,
  completionReceiptDomain,
  completionReceiptTypes,
} from "@/domain/settlement";

describe("completion receipt", () => {
  it("derives deterministic, domain-separated hashes and survives JSON storage", () => {
    const receipt = buildCompletionReceipt({
      campaignId: BigInt(7),
      sessionId: "00000000-0000-4000-8000-000000000010",
      sessionNonce: "00000000-0000-4000-8000-000000000011",
      userId: "00000000-0000-4000-8000-000000000012",
      reward: BigInt("1000000000000000"),
      issuedAtSeconds: BigInt(1_700_000_000),
    });

    expect(receipt.sessionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.viewerIdHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.expiresAt - receipt.issuedAt).toBe(BigInt(RECEIPT_TTL_SECONDS));
    expect(restoreCompletionReceipt(storeCompletionReceipt(receipt))).toEqual(receipt);
  });

  it("changes the session hash when the server nonce changes", () => {
    const common = {
      campaignId: BigInt(1),
      sessionId: "session",
      userId: "user",
      reward: BigInt(1),
      issuedAtSeconds: BigInt(100),
    };
    const first = buildCompletionReceipt({ ...common, sessionNonce: "nonce-a" });
    const second = buildCompletionReceipt({ ...common, sessionNonce: "nonce-b" });
    expect(first.sessionHash).not.toBe(second.sessionHash);
  });

  it("matches the Solidity EIP-712 golden digest", () => {
    const digest = hashTypedData({
      domain: completionReceiptDomain({
        chainId: 10143,
        verifyingContract: "0x1111111111111111111111111111111111111111",
      }),
      types: completionReceiptTypes,
      primaryType: "CompletionReceipt",
      message: {
        campaignId: BigInt(7),
        sessionHash: `0x${"22".repeat(32)}`,
        viewerIdHash: `0x${"33".repeat(32)}`,
        reward: BigInt("1000000000000000"),
        issuedAt: BigInt(1_700_000_000),
        expiresAt: BigInt(1_700_000_600),
        nonce: BigInt(42),
      },
    });
    expect(digest).toBe("0x06d262bf3df82ff48c0d210e7e1155a0d17748b3fa5e88499fd682a50dfa6209");
  });

  it("matches the contract expiry boundary", () => {
    const receipt = { expiresAt: BigInt(100) };
    expect(isCompletionReceiptExpired(receipt, new Date(100_999))).toBe(false);
    expect(isCompletionReceiptExpired(receipt, new Date(101_000))).toBe(true);
  });
});
