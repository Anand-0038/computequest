import { afterEach, describe, expect, it, vi } from "vitest";

import { generatePresentation } from "@/server/ai/gemini";

const runtime = {
  DATABASE_URL: "postgresql://user:pass@example.com:5432/computequest",
  SESSION_SIGNING_SECRET: "a-secure-test-secret-with-at-least-32-characters",
  GEMINI_API_KEY: "test-key-not-sent",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
  MONAD_RPC_URL: "https://example.com/rpc",
  MONAD_CHAIN_ID: "10143",
  MONAD_EXPLORER_BASE_URL: "https://testnet.monadvision.com",
  CAMPAIGN_ESCROW_ADDRESS: `0x${"1".repeat(40)}`,
  VERIFIER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
  RELAYER_PRIVATE_KEY: `0x${"3".repeat(64)}`,
  DEMO_CAMPAIGN_ID: "00000000-0000-4000-8000-000000000002",
  DEMO_ONCHAIN_CAMPAIGN_ID: "1",
  DEMO_ONCHAIN_REWARD_WEI: "1000000000000000",
  DEMO_QUEST_SECONDS: "30",
  DEMO_MAX_COMPLETIONS: "20",
  DEMO_QUEST_ANSWER: "parallel execution",
};

function configureRuntime() {
  for (const [key, value] of Object.entries(runtime)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Gemini presentation provider", () => {
  it("validates a schema-constrained provider response", async () => {
    configureRuntime();
    const presentation = {
      title: "Compute with proof",
      subtitle: "Verified attention funds useful work",
      theme: "industrial editorial",
      slides: Array.from({ length: 6 }, (_, index) => ({
        title: `Slide ${index + 1}`,
        bullets: ["A concrete point"],
        speakerNote: "Explain the evidence.",
        visualDirection: "Use one evidence object.",
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ responseId: "provider-request-1", candidates: [{ content: { parts: [{ text: JSON.stringify(presentation) }] } }] }),
          { status: 200 },
        ),
      ),
    );

    await expect(generatePresentation("Create a technical deck for ComputeQuest.")).resolves.toEqual({
      presentation,
      providerRequestId: "provider-request-1",
    });
  });

  it("fails closed when Gemini omits structured output", async () => {
    configureRuntime();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    await expect(generatePresentation("Create a technical deck for ComputeQuest.")).rejects.toThrow(
      "GEMINI_STRUCTURED_OUTPUT_MISSING",
    );
  });
});
