import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComputeCell } from "@/components/compute-cell";

describe("ComputeCell", () => {
  it("explains the persisted funding gap as a complete equation", () => {
    const html = renderToStaticMarkup(createElement(ComputeCell, {
      cell: {
        balance: 4,
        detail: "Earn +20 CE in the verified Sponsor Quest.",
        label: "FUNDING GAP",
        shortage: 20,
        target: 24,
      },
    }));

    expect(html).toContain("4 CE available plus 20 CE Sponsor Quest reward equals 24 CE task cost");
    expect(html).toContain("4 of 24 Compute Energy available");
    expect(html).toContain("SPONSOR QUEST");
    expect(html).toContain("+20 CE");
  });

  it("does not show a funding equation after the gap closes", () => {
    const html = renderToStaticMarkup(createElement(ComputeCell, {
      cell: {
        balance: 0,
        detail: "The 24 CE task spend is committed.",
        label: "AI WORKING",
        shortage: 0,
        target: 24,
      },
    }));

    expect(html).not.toContain("energy-equation");
    expect(html).toContain("AI WORKING");
  });
});
