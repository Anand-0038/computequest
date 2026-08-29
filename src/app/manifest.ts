import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ComputeQuest",
    short_name: "ComputeQuest",
    description: "Turn verified sponsor moments into useful AI compute.",
    start_url: "/",
    display: "standalone",
    background_color: "#17151b",
    theme_color: "#836ef9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
