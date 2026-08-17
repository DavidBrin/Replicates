"use client";

import clsx from "clsx";
import { useState } from "react";

import {
  formatAbsoluteDate,
  formatRelativeTime,
  formatViewCounts,
} from "@/domain/format";

/**
 * The description card, collapsed and expanded.
 *
 * ## The detail worth getting right: the numbers change when it opens
 *
 * `research/08-youtube-ui-measured.md` §8.1 records the watch info line as
 * `961K views  10 months ago` — the *abbreviated* count, the same one the card
 * uses — and §8.1's note on `formatViewCounts` records the **expanded**
 * description panel as `961,368 views` beside `Oct 7, 2025`. Comma grouping
 * appears in exactly two places in the product and this is one of them.
 *
 * So expanding is not just "show the rest of the text": the same two facts are
 * re-rendered in a different register, abbreviated-and-relative when folded and
 * exact-and-absolute when open. A component that formats once and reveals is
 * wrong on both lines, and it is wrong in a way nobody notices until they read
 * the two states side by side.
 *
 * ## Geometry
 *
 * §3.4: the description *container* is full width with `padding: 0` and is
 * transparent — "the visible grey card is a child". That is why the card below
 * is an inner element rather than the component's own root. Body type is
 * 14/20/400 (§2.2), the affordance is the literal string `...more` (§8.3), and
 * `screenshots/23-watch-description-expanded-1920.png` is the reference.
 */

export interface DescriptionProps {
  readonly description: string;
  readonly viewCount: number;
  readonly publishedAt: Date | null;
  /**
   * The clock, for the relative time.
   *
   * Passed from the server on a server-rendered page: left to default, the
   * server and the client each call `new Date()` and a video published almost
   * exactly some number of hours ago hydrates as a mismatch.
   */
  readonly now?: Date;
  readonly className?: string;
}

/** §8.3, verbatim. Not "…more", not "Show more" — three periods and a word. */
export const COLLAPSED_AFFORDANCE = "...more";

/**
 * The collapsed affordance's counterpart.
 *
 * **Assumed.** R8 captured the collapsed state's `...more` and did not record
 * the expanded state's label; `Show less` is what the guide's own
 * expander uses (§8.3, `Show more` / `Show less`) and is the phrasing this
 * product reaches for.
 */
export const EXPANDED_AFFORDANCE = "Show less";

export function Description({
  description,
  viewCount,
  publishedAt,
  now,
  className,
}: DescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const counts = formatViewCounts(viewCount);

  const when =
    publishedAt === null
      ? null
      : expanded
        ? formatAbsoluteDate(publishedAt)
        : formatRelativeTime(publishedAt, now);

  return (
    <div data-description="" className={clsx("w-full", className)}>
      <div
        data-description-card=""
        // The grey card. `additive-background` is the measured tonal fill for
        // this family of surfaces (R8 §1.2's "Watch action button (tonal)" row
        // carries the same `rgba(0,0,0,0.05)` / `rgba(255,255,255,0.1)` pair),
        // at the 12px `cozy` radius the rest of the page uses.
        className="rounded-cozy bg-additive px-3 py-3 text-body"
      >
        <div
          data-description-meta=""
          // §2.2: the watch info line is 14/20 at **500**, a step heavier than
          // the description body under it.
          className="font-[var(--yt-weight-medium)]"
        >
          <span data-description-views="">
            {expanded ? counts.exact : counts.abbreviated}
          </span>
          {when === null ? null : (
            // §8.1's measured info line is `961K views  10 months ago` — note
            // that there is **no bullet** between the halves here, unlike the
            // card's metadata row. The capture's text content carries two
            // spaces; HTML collapses those to one, so the gap is expressed as
            // spacing rather than as characters.
            <span data-description-when="" className="ml-2">
              {when}
            </span>
          )}
        </div>

        <div
          data-description-body=""
          className={clsx(
            "mt-1 font-[var(--yt-weight-regular)] whitespace-pre-wrap",
            // Collapsed, the product shows the first couple of lines and the
            // affordance on the same block. `line-clamp` is what keeps the card
            // one height regardless of how long the text is.
            !expanded && "line-clamp-2",
          )}
        >
          {description}
        </div>

        <button
          type="button"
          data-description-toggle=""
          // The name states what pressing does, so it flips with the state.
          aria-expanded={expanded}
          className="mt-1 font-[var(--yt-weight-medium)]"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? EXPANDED_AFFORDANCE : COLLAPSED_AFFORDANCE}
        </button>
      </div>
    </div>
  );
}
