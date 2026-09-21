import type { Metadata, Viewport } from "next";
import { Pixelify_Sans } from "next/font/google";

import "./globals.css";

/**
 * Pixelify Sans is the closest free face to the game's chunky, rounded pixel
 * font (SPEC §8). `next/font/google` downloads it at build time and serves it
 * from this origin, so there is no runtime request to Google Fonts.
 */
const pixel = Pixelify_Sans({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Island Empire", template: "%s · Island Empire" },
  description:
    "A browser rebuild of Island Empire — turn-based territory strategy on a square grid.",
  applicationName: "Island Empire",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2898f0",
};

/**
 * The shell is deliberately bare: every screen paints its own full-height
 * scene (sky, overworld, board), so the layout only provides the font
 * variable and a safe-area-aware root the screens can fill.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body className="min-h-dvh antialiased">
        <div id="ie-shell" className="relative flex min-h-dvh flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
