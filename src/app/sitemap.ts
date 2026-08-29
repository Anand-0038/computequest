import type { MetadataRoute } from "next";

const publicOrigin = "https://computequest.onrender.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{
    url: publicOrigin,
    lastModified: "2026-08-29",
    changeFrequency: "weekly",
    priority: 1,
    images: [`${publicOrigin}/og-image.png`],
  }];
}
