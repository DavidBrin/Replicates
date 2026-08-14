import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * Loading placeholders.
 *
 * Read `research/04-interaction.md` §8.2 before using this: in a product built
 * on optimistic mutation there is **no loading state for data you already
 * have**, and a skeleton is only correct for a **first** load that is genuinely
 * slow. The thresholds it settles on:
 *
 * | Duration | Treatment |
 * |---|---|
 * | < ~300 ms | nothing at all — no spinner, no skeleton, not even an opacity change |
 * | ~300 ms – 1 s | delay the indicator, then hold it 300 ms so it cannot strobe |
 * | > 1 s, first load only | skeleton rows at the *exact* final geometry |
 * | any mutation | never — the optimistic value is already on screen |
 *
 * "Exact final geometry" is the part that makes {@link SkeletonRow} worth
 * having rather than a bag of grey rectangles: it is built from the same
 * `--row-height` and the same 8px inset as the real issue row, so the list does
 * not shift by a pixel when the data lands. A skeleton that reflows on arrival
 * is worse than no skeleton, because the reflow is the thing the eye notices.
 */

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Convenience for the common case of a fixed-width bar. */
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ className, style, width, height }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-skeleton=""
      className={cn(
        "animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-hover)]",
        className,
      )}
      style={{ width, height, ...style }}
    />
  );
}

export interface SkeletonRowProps {
  /**
   * Vary the title width so a column of rows does not read as a striped
   * pattern. Deterministic in the index, not random, so server and client
   * render the same thing.
   */
  index?: number;
  className?: string;
}

/** Widths cycle rather than randomise — a random width breaks hydration. */
const TITLE_WIDTHS = ["42%", "58%", "35%", "64%", "48%"] as const;

export function SkeletonRow({ index = 0, className }: SkeletonRowProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center gap-2 px-2",
        "h-[var(--row-height)]",
        className,
      )}
    >
      <Skeleton width={16} height={16} className="rounded-[var(--radius-sm)]" />
      <Skeleton width={44} height={12} />
      <Skeleton width={14} height={14} className="rounded-full" />
      <Skeleton
        height={12}
        style={{ width: TITLE_WIDTHS[index % TITLE_WIDTHS.length] }}
      />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton width={52} height={12} />
        <Skeleton width={18} height={18} className="rounded-full" />
      </div>
    </div>
  );
}

export interface SkeletonListProps {
  /** How many rows. Match the viewport, not the eventual result count. */
  count?: number;
  /** Announced once for the whole list; the rows themselves stay hidden. */
  label?: string;
  className?: string;
}

export function SkeletonList({
  count = 8,
  label = "Loading issues",
  className,
}: SkeletonListProps) {
  return (
    <div
      // `busy` rather than a live region: the arrival of real content is not an
      // announcement, and a polite live region here would read out the whole
      // list the moment it resolves.
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex flex-col", className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonRow key={index} index={index} />
      ))}
    </div>
  );
}
