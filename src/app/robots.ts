import type { MetadataRoute } from "next";

const publicOrigin = "https://computequest.onrender.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${publicOrigin}/sitemap.xml`,
    host: publicOrigin,
  };
}
