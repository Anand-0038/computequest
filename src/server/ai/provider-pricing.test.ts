import { describe, expect, it } from "vitest";

import { calculateGeminiPublishedCost } from "@/server/ai/provider-pricing";

const baseUsage = {
  promptTokenCount: 1_000,
  cachedContentTokenCount: 0,
  candidatesTokenCount: 1_500,
  toolUsePromptTokenCount: 0,
  thoughtsTokenCount: 500,
  totalTokenCount: 3_000,
  serviceTier: "STANDARD",
};

describe("Gemini published-cost calculation", () => {
  it("prices standard text usage once with integer-micro rounding", () => {
    expect(calculateGeminiPublishedCost({
      requestedModel: "gemini-3.5-flash-lite",
      responseModelVersion: "gemini-3.5-flash-lite-001",
      usage: baseUsage,
    })).toMatchObject({ status: "PRICED", publishedCostUsdMicros: BigInt(5_300) });
  });

  it.each([
    [{ ...baseUsage, serviceTier: "PRIORITY" }, "SERVICE_TIER_PRICE_NOT_CONFIGURED"],
    [{ ...baseUsage, cachedContentTokenCount: 10 }, "CACHE_OR_TOOL_PRICING_NOT_CONFIGURED"],
    [{ ...baseUsage, promptTokenCount: null }, "REQUIRED_USAGE_METADATA_MISSING"],
  ])("fails pricing closed when the observed response needs another price rule", (usage, reason) => {
    expect(calculateGeminiPublishedCost({
      requestedModel: "gemini-3.5-flash-lite",
      responseModelVersion: "gemini-3.5-flash-lite-001",
      usage,
    })).toEqual({ status: "UNPRICED", reason });
  });
});
