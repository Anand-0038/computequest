import { describe, expect, it } from "vitest";

import {
  calculateMonadGasLimit,
  evaluateMonadPreflight,
  missingEscrowPreflightReport,
  settlementRecoveryBlockRanges,
} from "@/server/chain/monad";

const verifier = "0x1111111111111111111111111111111111111111";
const relayer = "0x2222222222222222222222222222222222222222";

function healthyObservations() {
  return {
    expectedChainId: 10143,
    observedChainId: 10143,
    bytecodePresent: true,
    expectedVerifier: verifier,
    observedVerifier: verifier,
    expectedReward: BigInt(100),
    rewardPerCompletion: BigInt(100),
    active: true,
    maxCompletions: BigInt(20),
    completionCount: BigInt(3),
    remainingBudget: BigInt(1_700),
    expectedPayoutRecipient: relayer,
    observedPayoutRecipient: relayer,
    relayerBalance: BigInt(1_000),
    minimumRelayerBalance: BigInt(400),
  } as const;
}

describe("Monad runtime preflight evaluation", () => {
  it("passes only when deployed state, campaign economics, and gas funding agree", () => {
    expect(evaluateMonadPreflight(healthyObservations())).toMatchObject({
      ready: true,
      issues: [],
      verifierMatches: true,
      budgetSufficient: true,
      relayerBalanceSufficient: true,
    });
  });

  it("returns exact fail-closed reasons for unsafe observed state", () => {
    const report = evaluateMonadPreflight({
      ...healthyObservations(),
      observedChainId: 1,
      bytecodePresent: false,
      observedVerifier: "0x3333333333333333333333333333333333333333",
      active: false,
      rewardPerCompletion: BigInt(99),
      completionCount: BigInt(20),
      remainingBudget: BigInt(0),
      observedPayoutRecipient: "0x4444444444444444444444444444444444444444",
      relayerBalance: BigInt(399),
    });
    expect(report.ready).toBe(false);
    expect(report.issues).toEqual([
      "CHAIN_ID_MISMATCH",
      "ESCROW_BYTECODE_MISSING",
      "ONCHAIN_VERIFIER_MISMATCH",
      "CAMPAIGN_INACTIVE",
      "CAMPAIGN_REWARD_MISMATCH",
      "CAMPAIGN_CAPACITY_EXHAUSTED",
      "CAMPAIGN_BUDGET_INSUFFICIENT",
      "CAMPAIGN_PAYOUT_RECIPIENT_MISMATCH",
      "RELAYER_BALANCE_INSUFFICIENT",
    ]);
  });

  it("reports missing bytecode without misclassifying a reachable RPC", () => {
    const report = missingEscrowPreflightReport({
      checkedAt: "2026-08-29T06:00:00.000Z",
      expectedChainId: 10143,
      observedChainId: 10143,
      escrowAddress: verifier,
      campaignId: "1",
      relayerAddress: relayer,
      relayerBalance: BigInt(0),
      minimumRelayerBalance: BigInt(500),
    });
    expect(report).toMatchObject({
      ready: false,
      chainId: 10143,
      bytecodePresent: false,
      relayerBalanceSufficient: false,
      issues: ["ESCROW_BYTECODE_MISSING", "RELAYER_BALANCE_INSUFFICIENT"],
    });
  });
});

describe("Monad settlement gas limits", () => {
  it("adds a ceiling-rounded ten percent buffer to the observed estimate", () => {
    expect(calculateMonadGasLimit(BigInt(100_000))).toBe(BigInt(110_000));
    expect(calculateMonadGasLimit(BigInt(21_001))).toBe(BigInt(23_102));
  });

  it("rejects invalid and over-limit settlement estimates", () => {
    expect(() => calculateMonadGasLimit(BigInt(0))).toThrow("MONAD_GAS_ESTIMATE_INVALID");
    expect(calculateMonadGasLimit(BigInt(27_272_727))).toBe(BigInt(30_000_000));
    expect(() => calculateMonadGasLimit(BigInt(27_272_728))).toThrow(
      "MONAD_TRANSACTION_GAS_LIMIT_EXCEEDED",
    );
  });
});

describe("Monad settlement event recovery ranges", () => {
  it("paginates all the way back to the escrow deployment block", () => {
    expect([...settlementRecoveryBlockRanges(BigInt(250_000), BigInt(100_000), BigInt(50_000))]).toEqual([
      { fromBlock: BigInt(200_001), toBlock: BigInt(250_000) },
      { fromBlock: BigInt(150_001), toBlock: BigInt(200_000) },
      { fromBlock: BigInt(100_001), toBlock: BigInt(150_000) },
      { fromBlock: BigInt(100_000), toBlock: BigInt(100_000) },
    ]);
  });

  it("rejects invalid recovery bounds", () => {
    expect(() => [...settlementRecoveryBlockRanges(BigInt(10), BigInt(11))]).toThrow(
      "MONAD_DEPLOYMENT_BLOCK_IN_FUTURE",
    );
    expect(() => [...settlementRecoveryBlockRanges(BigInt(10), BigInt(0), BigInt(0))]).toThrow(
      "MONAD_RECOVERY_CHUNK_INVALID",
    );
  });
});
