import type { Metadata, Viewport } from "next";
import { Press_Start_2P } from "next/font/google";

import "./globals.css";

/**
 * Press Start 2P is the closest free face to the game's chunky all-caps pixel
 * font. `next/font/google` downloads it at build time and serves it from this
 * origin, so there is no runtime request to Google Fonts.
 */
const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Island Empire",
  description:
    "A browser rebuild of Island Empire — turn-based territory strategy on a square grid.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#3aa8f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body>{children}</body>
    </html>
  );
}
