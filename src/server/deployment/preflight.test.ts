import { describe, expect, it } from "vitest";

import {
  evaluateDeploymentPreflight,
  isSupportedForgeVersion,
  parseForgeVersion,
  serializeDeploymentEvaluation,
} from "@/server/deployment/preflight";

const sponsor = "0x1111111111111111111111111111111111111111";
const verifier = "0x2222222222222222222222222222222222222222";
const relayer = "0x3333333333333333333333333333333333333333";

describe("Foundry deployment toolchain gate", () => {
  it("parses Foundry output and requires release 1.8 or newer", () => {
    expect(parseForgeVersion("forge Version: 1.7.1-stable")).toEqual({ major: 1, minor: 7, patch: 1 });
    expect(isSupportedForgeVersion(parseForgeVersion("forge Version: 1.7.1-stable"))).toBe(false);
    expect(isSupportedForgeVersion(parseForgeVersion("forge Version: 1.8.0-stable"))).toBe(true);
    expect(isSupportedForgeVersion(parseForgeVersion("forge Version: 2.0.0"))).toBe(true);
  });
});

describe("deployment funding preflight", () => {
  it("passes when sponsor campaign plus reserve and relayer floor are funded", () => {
    expect(
      evaluateDeploymentPreflight({
        expectedChainId: 10143,
        observedChainId: 10143,
        sponsorAddress: sponsor,
        verifierAddress: verifier,
        relayerAddress: relayer,
        sponsorBalance: BigInt(2_000),
        relayerBalance: BigInt(500),
        campaignBudget: BigInt(1_000),
        sponsorGasReserve: BigInt(200),
        relayerMinimumBalance: BigInt(400),
      }),
    ).toEqual({
      ready: true,
      sponsorMinimumBalance: BigInt(1_200),
      issues: [],
      warnings: [],
    });
  });

  it("fails closed on network or funding errors and warns about shared key roles", () => {
    expect(
      evaluateDeploymentPreflight({
        expectedChainId: 10143,
        observedChainId: 1,
        sponsorAddress: sponsor,
        verifierAddress: sponsor,
        relayerAddress: sponsor,
        sponsorBalance: BigInt(1_199),
        relayerBalance: BigInt(399),
        campaignBudget: BigInt(1_000),
        sponsorGasReserve: BigInt(200),
        relayerMinimumBalance: BigInt(400),
      }),
    ).toEqual({
      ready: false,
      sponsorMinimumBalance: BigInt(1_200),
      issues: ["CHAIN_ID_MISMATCH", "SPONSOR_BALANCE_INSUFFICIENT", "RELAYER_BALANCE_INSUFFICIENT"],
      warnings: ["KEY_ROLES_SHARE_AN_ADDRESS"],
    });
  });

  it("produces a JSON-safe public funding report", () => {
    const publicReport = serializeDeploymentEvaluation({
      ready: false,
      sponsorMinimumBalance: BigInt(1_200),
      issues: ["SPONSOR_BALANCE_INSUFFICIENT"],
      warnings: [],
    });
    expect(publicReport.sponsorMinimumBalanceWei).toBe("1200");
    expect(() => JSON.stringify(publicReport)).not.toThrow();
  });
});
