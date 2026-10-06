import type { Metadata, Viewport } from "next";
import { Barlow, Titillium_Web } from "next/font/google";

import "./globals.css";

/**
 * Titillium Web is the closest free face to the game's bold, slightly
 * condensed UI type; Barlow carries body copy (SPEC §8, research/04 §5.5).
 * `next/font/google` downloads both at build time and serves them from this
 * origin, so there is no runtime request to Google Fonts.
 */
const head = Titillium_Web({
  weight: ["600", "700", "900"],
  subsets: ["latin"],
  variable: "--font-head",
  display: "swap",
});

const body = Barlow({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Risk", template: "%s · Risk" },
  description:
    "A browser replica of RISK: Global Domination — solo against bots, pass-and-play, and casual online games.",
  applicationName: "Risk",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1e30",
};

/**
 * The shell is deliberately bare: every screen paints its own full-height
 * scene (menu, lobby, board), so the layout only provides the font variables
 * and a safe-area-aware root the screens can fill.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${head.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <div
          id="risk-shell"
          className="relative flex min-h-dvh flex-col"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
