"use client";

import { useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";

/**
 * A dismissible banner stating plainly that Explore is a simulated
 * public-markets showcase (SPEC §3.6, DECISIONS D14 — "deliberate honesty").
 * Dismissal is plain in-session component state, not persisted — reading a
 * persisted flag back on mount would mean either an impure render (reading
 * `localStorage` during render) or a `setState` synchronously inside an
 * effect to "sync" it in, both of which this project's react-hooks lint
 * rules reject, and the latter would also flash the banner open-then-closed
 * on every reload regardless. A banner that reappears on the next visit
 * (or reload) is an acceptable, honestly-simpler trade for "dismissible".
 * Client component: it owns the dismiss state.
 */
export function ExploreBanner() {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  return (
    <div className="border-b border-(--border) bg-(--surface-2)">
      <div className="mx-auto flex max-w-[1320px] items-start gap-3 px-4 py-2.5 sm:px-6">
        <Info className="mt-0.5 size-4 shrink-0 text-(--accent)" aria-hidden="true" />
        <p className="flex-1 text-xs text-(--text-2) sm:text-sm">
          Explore is a simulated public-markets showcase — nothing here trades for real.
          Real markets, priced by your friends, live in{" "}
          <Link href="/app" className="font-medium text-(--accent) underline-offset-2 hover:underline">
            your groups
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
          className="shrink-0 rounded-(--radius-input) p-1 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
