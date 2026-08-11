import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlayMoneyBanner, SiteFooter, SiteHeader, SiteNav } from "@/components/app-shell";
import "./globals.css";

/**
 * `metadataBase` is only set when there is a real origin to set it to.
 * Constructing a `URL` from an undefined or half-configured env var throws at
 * module scope, which takes down every route in the app for the sake of an
 * absolute Open Graph path — Next just warns and falls back if it is absent.
 */
function resolveMetadataBase(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = configured || (vercel ? `https://${vercel}` : "");
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "Dollar Pixels — $1 buys nine pixels",
  description:
    "A pixel grid sold by the block: $1 buys a 3 x 3 block of nine pixels on a 1200 x 1200 canvas. Buy a block, leave a caption, make your own page.",
};

/**
 * Whether the active payment provider actually charges cards.
 *
 * Read from the environment rather than from the container, because the root
 * layout must not reach into `src/adapters/**` and must not fetch. It is the
 * same variable the composition root selects on, and selecting `stripe`
 * without keys is fatal at startup (DECISIONS D11), so `stripe` here can be
 * trusted to mean real money.
 *
 * Default false: with an unset or misspelt variable the banner shows. Warning
 * about play money on a live deployment is a confusing mistake; staying silent
 * on a play-money one is the mistake that makes someone think they have spent
 * something.
 */
const PAYMENT_IS_LIVE = process.env.PAYMENT_PROVIDER === "stripe";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <PlayMoneyBanner live={PAYMENT_IS_LIVE} />
        <SiteHeader />
        <SiteNav />

        {/*
          The column is sized to hold the 1200px grid at 1:1 (DECISIONS D1) —
          see `--layout-max`. Everything else is narrower by choice, not by
          constraint, so the grid page needs no special case to opt in.
        */}
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-(--layout-max) flex-1 px-4 py-6"
        >
          {children}
        </main>

        <SiteFooter />
      </body>
    </html>
  );
}
