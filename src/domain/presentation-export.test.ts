import { describe, expect, it } from "vitest";

import { presentationFilename, presentationToPdf, presentationToPlainText } from "@/domain/presentation-export";

const presentation = {
  title: "A Useful Deck",
  subtitle: "Evidence over claims",
  theme: "Industrial editorial",
  slides: Array.from({ length: 6 }, (_, index) => ({
    title: `Slide ${index + 1}`,
    bullets: ["First factual point", "Second factual point"],
    speakerNote: index === 0 ? "Open with the user problem." : undefined,
  })),
};

describe("presentation exports", () => {
  it("creates a readable plain-text outline and stable filenames", () => {
    expect(presentationToPlainText(presentation)).toContain("1. Slide 1\n• First factual point");
    expect(presentationToPlainText(presentation)).toContain("Speaker note: Open with the user problem.");
    expect(presentationFilename(presentation.title, "pdf")).toBe("a-useful-deck.pdf");
  });

  it("generates a real PDF document", async () => {
    const bytes = await presentationToPdf(presentation);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});
