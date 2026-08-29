import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://computequest.onrender.com"),
  title: "ComputeQuest — Earn compute energy",
  description: "Turn verified sponsor attention into AI compute on Monad Testnet.",
  keywords: ["sponsored compute", "AI compute credits", "Monad", "verified sponsor attention", "Compute Energy"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "ComputeQuest — Turn attention into compute",
    description: "Sponsor moments fund useful AI work through verified active-view signals and Monad settlement.",
    siteName: "ComputeQuest",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "ComputeQuest turns sponsor attention into useful AI compute" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ComputeQuest — Turn attention into compute",
    description: "Sponsor moments fund useful AI work through verified active-view signals and Monad settlement.",
    images: ["/og-image.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ComputeQuest",
  url: "https://computequest.onrender.com",
  description: "ComputeQuest turns verified sponsor moments into non-transferable credits for useful AI work.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  sameAs: ["https://github.com/Anand-0038/computequest"],
};

const themeScript = `
  try {
    const savedTheme = localStorage.getItem("computequest:theme");
    const theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
          type="application/ld+json"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
