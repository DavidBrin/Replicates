import type { Metadata, Viewport } from "next";
import { Anton, M_PLUS_Rounded_1c } from "next/font/google";

import "./globals.css";

/**
 * Ultimate's own faces are proprietary and there is no legitimate way to ship
 * them. Anton is the closest free analogue to the heavy condensed display type
 * on the numerals and the wordmark; M PLUS Rounded 1c is the closest to the
 * soft rounded gothic the menus are set in — and, being a Japanese face, it
 * carries the same kana-era roundness Nintendo's does rather than imitating it
 * from the Latin side. Both are SIL Open Font Licensed. See SPEC §10.
 *
 * They are exposed as CSS variables rather than applied directly because the
 * canvas HUD sets `ctx.font` from the same tokens, and a variable is the only
 * form both a stylesheet and a 2D context can read.
 */
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

const rounded = M_PLUS_Rounded_1c({
  weight: ["400", "500", "700", "800", "900"],
  subsets: ["latin"],
  variable: "--font-rounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Super Smash",
  description:
    "Eight fighters, one keyboard, sixty frames a second. A browser rebuild of Super Smash Bros. Ultimate's versus mode.",
};

/**
 * The game letterboxes a fixed 16:9 field and every control is a physical key,
 * so pinch-zoom on the menus only ever produces a half-scrolled screen the
 * player then has to fight. `viewportFit` keeps the red banners running under
 * a notch instead of stopping short of it.
 */
export const viewport: Viewport = {
  themeColor: "#ad0000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * `suppressHydrationWarning` is on `<html>` because extensions edit `<html>`.
 *
 * Dark-mode extensions add `style="filter: invert(0)"` to the document element
 * before React hydrates, so React compares the tree it expected against a DOM
 * a third party has already changed and reports a mismatch the page did not
 * cause. It is the case the error message itself lists last, and it is the only
 * one that can fire here: everything this component renders is static.
 *
 * It suppresses one level only — this element's own attributes and text. Any
 * genuine mismatch inside the app still warns, which is the part worth keeping.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${rounded.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-[#101215] antialiased">{children}</body>
    </html>
  );
}
