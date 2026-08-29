import { describe, expect, it } from "vitest";

import { presentationSchema } from "@/domain/presentation";

describe("presentation schema", () => {
  it("rejects a response with fewer than six slides", () => {
    const result = presentationSchema.safeParse({
      title: "Too short",
      subtitle: "Invalid provider response",
      theme: "industrial",
      slides: [{ title: "Only one", bullets: ["Not enough"] }],
    });
    expect(result.success).toBe(false);
  });
});
