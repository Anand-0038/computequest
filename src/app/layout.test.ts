import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";

describe("public metadata", () => {
  it("publishes an absolute social-card configuration", () => {
    expect(metadata.metadataBase?.toString()).toBe("https://computequest.onrender.com/");
    expect(metadata.openGraph?.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "/og-image.png", width: 1200, height: 630 }),
    ]));
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
