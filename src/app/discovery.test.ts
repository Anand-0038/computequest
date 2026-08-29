import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("public discovery metadata", () => {
  it("allows the product page while keeping APIs out of crawler paths", () => {
    expect(robots()).toMatchObject({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://computequest.onrender.com/sitemap.xml",
    });
  });

  it("publishes only the canonical product URL and social image", () => {
    expect(sitemap()).toEqual([
      expect.objectContaining({
        url: "https://computequest.onrender.com",
        images: ["https://computequest.onrender.com/og-image.png"],
      }),
    ]);
  });

  it("describes the installable web application without marketing inflation", () => {
    expect(manifest()).toMatchObject({
      name: "ComputeQuest",
      short_name: "ComputeQuest",
      start_url: "/",
      display: "standalone",
    });
  });
});
