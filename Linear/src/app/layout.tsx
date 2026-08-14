import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

import { THEME_ATTRIBUTE, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { ToastProvider } from "@/components/ui/toast-provider";

/**
 * The root layout.
 *
 * Three things happen here that cannot happen anywhere else, and each of them
 * is visible on the very first frame the user sees.
 *
 * ## 1. Inter Variable, self-hosted
 *
 * `next/font/google` downloads the face **at build time** and serves it from
 * this origin, so there is no runtime request to `fonts.googleapis.com`: no
 * third-party DNS lookup on the critical path, no CDN outage that changes the
 * app's typeface, and no `font-display` flash the framework cannot control.
 * The variable axis matters — the design system asks for weight **450** for
 * body and **590** for titles, half-steps that only exist on a variable face
 * (`research/01-visual-design.md` §2.2). Loading Inter as static 400/500/600
 * would quietly round every weight in the app to the nearest hundred.
 *
 * `variable: "--font-inter"` is the contract with `globals.css`, whose
 * `--font-sans` stack starts with `var(--font-inter)`.
 *
 * The `cv11` and `ss03` feature settings are applied on `body` in `globals.css`
 * rather than here, because `next/font` exposes no hook for
 * `font-feature-settings`. They are not cosmetic: without them Inter renders
 * its default letterforms and, in the research lane's words, "it stops looking
 * like Linear".
 *
 * ## 2. The theme, before first paint
 *
 * The inline script in `<head>` reads the stored preference and stamps
 * `data-theme` on `<html>` **synchronously, before any CSS is applied**. A
 * theme applied from `useEffect` lands after first paint, which is a white
 * flash on every cold navigation for a dark-theme user. `suppressHydrationWarning`
 * on `<html>` is required and correct: the script mutates the element between
 * the server's render and React's hydration, and that difference is the entire
 * point.
 *
 * Next's `<Script>` component is deliberately not used — its strategies all
 * defer to at least `afterInteractive`, which is far too late.
 *
 * ## 3. `data-app-shell`
 *
 * `globals.css` locks body scrolling when this is `"true"`, because the app is
 * a fixed three-pane shell in which only the panes scroll. It is `"false"`
 * here: the root layout also wraps the marketing page and the auth screens,
 * which are ordinary scrolling documents. **The workspace shell flips it** —
 * `document.body.dataset.appShell = "true"` on mount, restored on unmount —
 * rather than the root layout guessing from a pathname it would have to become
 * a client component to read.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  // `optical sizing` is on by default for Inter's variable build and is what
  // keeps 11px meta text from looking like shrunken 36px display text.
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: {
    default: "Linear",
    template: "%s · Linear",
  },
  description:
    "Issues, projects and teams for software teams that move quickly.",
  applicationName: "Linear",
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Both entries, in this order: the browser picks by the user's OS setting,
  // so the chrome around the page matches the theme the bootstrap script is
  // about to apply instead of flashing the other one.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090a" },
    { media: "(prefers-color-scheme: light)", color: "#eeeeef" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={inter.variable}
      // The bootstrap script below rewrites this attribute before hydration.
      // Seeded to dark so a client with JavaScript disabled still gets a
      // themed page rather than an unstyled one.
      {...{ [THEME_ATTRIBUTE]: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <script
          // Blocking and inline: this must run before the first paint, and a
          // src'd or deferred script cannot.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body data-app-shell="false">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
