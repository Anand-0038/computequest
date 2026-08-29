export type ProviderUsage = {
  promptTokenCount: number | null;
  cachedContentTokenCount: number | null;
  candidatesTokenCount: number | null;
  toolUsePromptTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
  serviceTier: string | null;
};

export const gemini35FlashLiteStandardPricing = {
  id: "google:gemini-3.5-flash-lite:standard:2026-08-29",
  provider: "gemini",
  requestedModel: "gemini-3.5-flash-lite",
  serviceTier: "STANDARD",
  currency: "USD",
  inputMicrosPerMillionTokens: BigInt(300_000),
  outputMicrosPerMillionTokens: BigInt(2_500_000),
  sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  effectiveAt: new Date("2026-08-29T00:00:00.000Z"),
  retrievedAt: new Date("2026-08-29T08:25:00.000Z"),
} as const;

export function calculateGeminiPublishedCost(input: {
  requestedModel: string;
  responseModelVersion: string | null;
  usage: ProviderUsage;
}) {
  const tier = input.usage.serviceTier?.toLocaleUpperCase("en-US") ?? "STANDARD";
  if (input.requestedModel !== gemini35FlashLiteStandardPricing.requestedModel) {
    return { status: "UNPRICED" as const, reason: "MODEL_PRICE_NOT_CONFIGURED" };
  }
  if (tier !== gemini35FlashLiteStandardPricing.serviceTier) {
    return { status: "UNPRICED" as const, reason: "SERVICE_TIER_PRICE_NOT_CONFIGURED" };
  }
  if ((input.usage.cachedContentTokenCount ?? 0) > 0 || (input.usage.toolUsePromptTokenCount ?? 0) > 0) {
    return { status: "UNPRICED" as const, reason: "CACHE_OR_TOOL_PRICING_NOT_CONFIGURED" };
  }
  if (input.usage.promptTokenCount === null || input.usage.candidatesTokenCount === null) {
    return { status: "UNPRICED" as const, reason: "REQUIRED_USAGE_METADATA_MISSING" };
  }

  const inputCost =
    BigInt(input.usage.promptTokenCount) * gemini35FlashLiteStandardPricing.inputMicrosPerMillionTokens;
  const outputTokens = BigInt(input.usage.candidatesTokenCount + (input.usage.thoughtsTokenCount ?? 0));
  const outputCost = outputTokens * gemini35FlashLiteStandardPricing.outputMicrosPerMillionTokens;
  return {
    status: "PRICED" as const,
    pricing: gemini35FlashLiteStandardPricing,
    publishedCostUsdMicros: divideRoundUp(inputCost + outputCost, BigInt(1_000_000)),
  };
}

function divideRoundUp(value: bigint, divisor: bigint) {
  return (value + divisor - BigInt(1)) / divisor;
}
