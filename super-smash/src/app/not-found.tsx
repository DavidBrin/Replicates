import type { Metadata } from "next";
import Link from "next/link";

import { StopScreen } from "@/components/menu/StopScreen";

export const metadata: Metadata = { title: "No Contest · Super Smash" };

/**
 * The 404, and the reason the App Router needs to own it.
 *
 * Without this file a request for an unknown path falls through to the Pages
 * Router's built-in error page — in an app with no `pages/` directory at all.
 * That fallback is not merely off-brand: it is built against the installed
 * React rather than the copy Next vendors for the App Router, so serving it
 * pulls a second React into the build graph. One screen here replaces both
 * problems with the game's own vocabulary.
 *
 * The way out goes to `/menu` rather than `/`. A player who has mistyped a URL
 * has already pressed start; sending them back to "press any button" would make
 * them do it twice.
 */
export default function NotFound() {
  return (
    <StopScreen
      heading="No contest"
      message="That screen isn't in this build. Every mode this one has is on the main menu."
      action={
        <Link
          href="/menu"
          className="relative border-[4px] border-panel-ink bg-smash-yellow px-10 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
          style={{ transform: "skewX(-12deg)" }}
        >
          <span
            className="flex items-center justify-center font-display text-xl tracking-[0.18em] uppercase"
            style={{ transform: "skewX(12deg)" }}
          >
            Main Menu
          </span>
        </Link>
      }
    />
  );
}
