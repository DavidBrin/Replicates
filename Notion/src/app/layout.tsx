import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { brand } from "@/config/app.config";
import { ThemeScript } from "@/lib/theme/theme-provider";
import "./globals.css";

/**
 * Root layout — a server component on purpose.
 *
 * It owns only the document shell, the font and the pre-hydration theme
 * script. Every interactive concern lives below a single `"use client"`
 * boundary further down the tree.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${brand.tagline} | ${brand.name}`,
    template: `%s | ${brand.name}`,
  },
  description: brand.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is scoped to <html> alone, because the theme
    // script mutates data-theme before React hydrates. It is not used to
    // paper over any other mismatch.
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
