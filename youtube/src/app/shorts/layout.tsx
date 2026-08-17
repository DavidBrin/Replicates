import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";

/**
 * Shorts' shell.
 *
 * ## What it takes from `AppShell`, and what it deliberately does not
 *
 * It takes the **chrome**: the 56px masthead and the guide rail, in the mode
 * that rail is supposed to be in at this viewport. Both are measured on the
 * Shorts page itself — `research/extracted/channel-and-shorts.json` puts
 * `ytd-shorts` at **x = 240, y = 64** at 1920, which is the expanded rail's
 * width and the masthead's height plus the 8px top margin R9 §11 records. A
 * Shorts route with no rail would be a different page from the one that was
 * captured, and reimplementing the rail's 1313px persistent/temporary switch
 * here would be a second copy of the one thing `AppShell` exists to own.
 *
 * It does **not** use the content column as a content column. `.yt-content-inner`
 * is the article grid's container-query context — its whole job is to resolve
 * `--yt-grid-columns` for feeds of cards — and Shorts has no cards, no grid and
 * no document scroll. The stage below is one viewport tall, owns its own
 * scroller (the pager's), and is full-bleed inside the rail's offset: no
 * max-width, no gutter, no column.
 *
 * That distinction is why the height is written as `100dvh - 56px` rather than
 * left to flow. `globals.css` is explicit that **the document is the scroller**
 * in this application — `ytd-app` measures 1920 × 6181 — and Shorts is the one
 * surface where that is not true, because a feed whose items are snapped to the
 * viewport cannot also be a page that scrolls behind them. `dvh` rather than
 * `vh` so a mobile browser's collapsing address bar does not leave the last
 * short cropped by the toolbar's height.
 */

export const metadata: Metadata = {
  title: {
    default: "Shorts",
    template: "%s - Shorts",
  },
};

export default async function ShortsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Only to pick the guide's signed-in half. The route itself is readable
  // signed out, which is what `19-shorts-1920.png` captured.
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);

  return (
    <AppShell signedIn={session !== null} activePath="/shorts">
      <div
        data-shorts-stage-root=""
        className="w-full overflow-hidden"
        // 8px is R9 §11's `ytd-shorts { margin-top: 8px }`; the 56px is the
        // masthead `AppShell` has already reserved with its own `pt-14`.
        style={{ height: "calc(100dvh - 56px)", paddingTop: "8px" }}
      >
        {children}
      </div>
    </AppShell>
  );
}
