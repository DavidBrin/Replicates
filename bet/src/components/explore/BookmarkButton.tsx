"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/cn";

export interface BookmarkButtonProps {
  question: string;
  className?: string;
}

/** Card-footer bookmark toggle (research/polymarket.md §2.5: `aria-label="Add
 * to favorites"`, 36×36px ghost icon button). Purely client-local state —
 * Explore has no signed-in-user watchlist backing it, so this is a visual
 * affordance only, never wired to a fetch. Client component for the click
 * state. */
export function BookmarkButton({ question, className }: BookmarkButtonProps) {
  const [saved, setSaved] = useState(false);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setSaved((s) => !s);
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${question} from bookmarks` : `Bookmark ${question}`}
      onClick={handleClick}
      className={cn(
        "pointer-events-auto inline-flex size-7 items-center justify-center rounded-full text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-2)",
        saved && "text-(--accent)",
        className,
      )}
    >
      <Bookmark className="size-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}
