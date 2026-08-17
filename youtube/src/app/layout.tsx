import type { Metadata, Viewport } from "next";

import "./globals.css";

import { ThemeProvider } from "@/components/theme";
import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
} from "@/components/theme-constants";

/**
 * The root layout.
 *
 * Two things happen here that cannot happen anywhere else, and both are
 * visible on the very first frame.
 *
 * ## 1. The theme, before first paint
 *
 * The inline script in `<head>` reads the stored preference and stamps
 * `data-theme` on `<html>` **synchronously, before any CSS applies**. A theme
 * applied from `useEffect` lands *after* first paint, which on a video site
 * means every dark-theme user is flashbanged on every cold navigation. Next's
 * `<Script>` component is deliberately not used: all of its strategies defer
 * to at least `afterInteractive`, which is far too late.
 *
 * `suppressHydrationWarning` on `<html>` is required and correct — the script
 * mutates the element between the server's render and hydration, and that
 * difference is the entire point.
 *
 * The attribute is seeded to `dark` rather than left off. `globals.css` puts
 * the dark tokens on bare `:root`, so a client with JavaScript disabled still
 * gets a themed page; the seed is there so the server's markup states the same
 * thing the CSS does rather than leaving a reader to infer it.
 *
 * ## 2. The typeface, without a runtime dependency
 *
 * `Roboto, Arial, sans-serif` is the measured stack, verbatim (R8 §2), and it
 * is declared in CSS rather than fetched. Roboto is Apache-2.0 and could
 * legitimately ship — but `next/font/google` downloads it at build time and
 * self-hosts it, which adds a build-time network fetch and ~150KB of binary to
 * a repository whose rule is that nothing in it is someone else's asset. A
 * machine with Roboto installed renders in Roboto; everything else falls back
 * to Arial, whose metrics are close enough at 14px that the measured line
 * heights still hold. **There is no request to a font CDN from this
 * application.**
 *
 * YouTube's own display faces — `YouTube Sans` and `YouTube Noto` — are
 * proprietary and are not substituted for; R8 §2's recommendation is to fall
 * back to Roboto for those roles, which is what the single stack above does.
 */

export const metadata: Metadata = {
  title: {
    default: "YouTube",
    template: "%s - YouTube",
  },
  description: "Enjoy the videos and music you love, upload original content, and share it all.",
  applicationName: "YouTube",
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Both entries, in this order: the browser picks by the user's OS setting,
  // so the chrome around the page matches the theme the bootstrap script is
  // about to apply instead of flashing the other one. The two values are the
  // measured `base-background` pair.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" {...{ [THEME_ATTRIBUTE]: "dark" }} suppressHydrationWarning>
      <head>
        <script
          // Blocking and inline: this must run before first paint, and a
          // `src`'d or deferred script cannot.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
