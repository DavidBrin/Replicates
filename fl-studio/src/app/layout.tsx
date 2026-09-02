import type { Metadata, Viewport } from "next";

import "./globals.css";

/**
 * The root layout.
 *
 * Placeholder — no theme provider yet. Font is the OS-native stack declared
 * directly in `globals.css`; `next/font/google` is never used in this repo
 * (see `Wikipedia/research/01-repo-conventions.md`), so there is no
 * build-time font fetch.
 */
export const metadata: Metadata = {
  title: "FL Studio",
  description: "A browser-based clone of FL Studio's sequencing workflow.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
