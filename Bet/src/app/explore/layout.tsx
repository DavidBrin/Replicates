import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { ExploreBanner } from "@/components/explore/ExploreBanner";
import { ExploreHeader } from "@/components/explore/ExploreHeader";

export const metadata: Metadata = {
  title: "Explore — Bet",
  description: "Public prediction markets, styled after Kalshi and Polymarket — a read-only showcase.",
};

/**
 * `[data-surface="explore"]` on the layout root (Task 13's ambiguity
 * resolution, SPEC §7.3) — the Kalshi token scope (globals.css) then applies
 * to the whole `/explore` subtree automatically, since every `src/components
 * /ui/**` primitive references CSS custom properties rather than hardcoded
 * colors, re-theming for free.
 */
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="explore" className="min-h-svh bg-(--surface-0) text-(--text-1)">
      <Suspense fallback={<div className="h-[107px] border-b border-(--border) bg-(--surface-1)" />}>
        <ExploreHeader />
      </Suspense>
      <ExploreBanner />
      <main>{children}</main>
    </div>
  );
}
