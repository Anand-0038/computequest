import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SponsorInquiry } from "@/components/sponsor-inquiry";

describe("sponsor inquiry", () => {
  it("renders the operator-reviewed sponsor path with bounded campaign copy", () => {
    const markup = renderToStaticMarkup(<SponsorInquiry sessionReady />);

    expect(markup).toContain("FOR SPONSORS");
    expect(markup).toContain("REQUEST CAMPAIGN REVIEW");
    expect(markup).toContain('maxLength="280"');
    expect(markup).toContain("does not authorize ComputeQuest to publish");
    expect(markup).toContain("X post");
  });
});
