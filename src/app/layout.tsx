import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComputeQuest — Earn compute energy",
  description: "Turn verified sponsor attention into AI compute on Monad Testnet.",
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
      </head>
      <body>{children}</body>
    </html>
  );
}
