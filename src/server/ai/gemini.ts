import { presentationSchema } from "@/domain/presentation";
import type { ProviderUsage } from "@/server/ai/provider-pricing";
import { requireRuntimeEnv } from "@/server/env";

const presentationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Presentation title, at most 160 characters." },
    subtitle: { type: "string", description: "Presentation subtitle, at most 240 characters." },
    theme: { type: "string", description: "Short visual theme direction." },
    slides: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          bullets: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          speakerNote: { type: "string" },
          visualDirection: { type: "string" },
        },
        required: ["title", "bullets", "speakerNote", "visualDirection"],
      },
    },
  },
  required: ["title", "subtitle", "theme", "slides"],
} as const;

type GeminiResponse = {
  responseId?: string;
  modelVersion?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    toolUsePromptTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    serviceTier?: string;
  };
  error?: { message?: string; status?: string };
};

export type GeminiAttemptMetadata = {
  providerRequestId: string | null;
  requestedModel: string;
  responseModelVersion: string | null;
  usage: ProviderUsage;
};

export class GeminiAttemptError extends Error {
  constructor(message: string, readonly metadata: GeminiAttemptMetadata | null) {
    super(message);
    this.name = "GeminiAttemptError";
  }
}

export async function generatePresentation(prompt: string) {
  const env = requireRuntimeEnv();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Create a concise, useful pitch deck from this brief:\n\n${prompt}\n\nUse concrete claims and short bullets. Never invent traction, customers, metrics, or integrations.`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: presentationJsonSchema,
        temperature: 0.45,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const body = (await response.json()) as GeminiResponse;
  const metadata = attemptMetadata(body, env.GEMINI_MODEL);
  if (!response.ok) {
    throw new GeminiAttemptError(`GEMINI_REQUEST_FAILED:${body.error?.status ?? response.status}`, metadata);
  }

  const text = body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) {
    throw new GeminiAttemptError("GEMINI_STRUCTURED_OUTPUT_MISSING", metadata);
  }

  let presentation;
  try {
    presentation = presentationSchema.parse(JSON.parse(text));
  } catch {
    throw new GeminiAttemptError("GEMINI_STRUCTURED_OUTPUT_INVALID", metadata);
  }
  return {
    presentation,
    ...metadata,
  };
}

function attemptMetadata(body: GeminiResponse, requestedModel: string): GeminiAttemptMetadata {
  return {
    providerRequestId: body.responseId ?? null,
    requestedModel,
    responseModelVersion: body.modelVersion ?? null,
    usage: normalizeUsage(body.usageMetadata),
  };
}

function normalizeUsage(metadata: GeminiResponse["usageMetadata"]): ProviderUsage {
  return {
    promptTokenCount: tokenCount(metadata?.promptTokenCount),
    cachedContentTokenCount: tokenCount(metadata?.cachedContentTokenCount),
    candidatesTokenCount: tokenCount(metadata?.candidatesTokenCount),
    toolUsePromptTokenCount: tokenCount(metadata?.toolUsePromptTokenCount),
    thoughtsTokenCount: tokenCount(metadata?.thoughtsTokenCount),
    totalTokenCount: tokenCount(metadata?.totalTokenCount),
    serviceTier: metadata?.serviceTier ?? null,
  };
}

function tokenCount(value: number | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
