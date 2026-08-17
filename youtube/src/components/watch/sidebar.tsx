import clsx from "clsx";

import { VideoRowView } from "@/components/video";
import type { VideoCard } from "@/domain/types";

/**
 * The related-video rail.
 *
 * ## The breakpoint is the finding here, and it was measured wrong once
 *
 * `research/08-youtube-ui-measured.md` §3.2, binary-searched to the pixel: the
 * sidebar sits beside the player at **≥1000px** and stops rendering at ≤999px.
 * §3.2 adds the part that matters — *"The watch sidebar does not stack below
 * the player at narrow widths in this build — `#secondary` becomes
 * non-rendering (zero client rects) below 1000px and the related list
 * disappears entirely."* It does not reflow into a column under the video; it
 * is gone.
 *
 * `research/extracted/watch-sidebar-breakpoint.json` is marked `SUPERSEDED`
 * because an earlier pass recorded 1399/1400 for this, which is wrong. The
 * corrected value is what is built here, and the superseded file is worth
 * knowing about precisely because a later reader might find it first.
 *
 * ## Geometry (§3.4)
 *
 * `#secondary` is 544 wide with the list at `--ytd-watch-flexy-sidebar-width:
 * 528px`; each item is 528×185.63 with an 8px vertical gap and a 330px
 * thumbnail. The item itself is `VideoRowView` at its `sidebar` density, which
 * already carries those numbers — including the sidebar's own formatters, which
 * are §8.2's third variant: `858K` and `2y ago`, not `858K views` and
 * `2 years ago`.
 *
 * ## Server-safe
 *
 * No `"use client"` and no hooks: this is a list, and the interactive part is
 * `VideoRowView`'s. That means a server page can render it directly with the
 * server's `now`, which is what keeps the relative times from hydrating as a
 * mismatch.
 */

export interface WatchSidebarProps {
  readonly videos: readonly VideoCard[];
  /** The server's clock, forwarded to every row. */
  readonly now?: Date;
  /**
   * Theatre moves the rail below the player, where it is no longer a 528px
   * column — §3.4 measures `#secondary` at y=991, full width. The layout is the
   * page's; what changes here is that the width cap comes off.
   */
  readonly theatre?: boolean;
  readonly className?: string;
}

/** §3.2: first pixel at which the rail renders. */
export const SIDEBAR_MIN_VIEWPORT = 1000;

export function WatchSidebar({
  videos,
  now,
  theatre = false,
  className,
}: WatchSidebarProps) {
  return (
    <aside
      data-watch-sidebar=""
      aria-label="Related videos"
      className={clsx(
        // The measured behaviour, verbatim: nothing below 1000px. Not
        // `flex-col` at a smaller size, not a horizontal scroller — absent.
        "hidden min-[1000px]:block",
        className,
      )}
      // §3.4's `--ytd-watch-flexy-sidebar-width`, verbatim. Written as a value
      // rather than through a token because it is the only place in this
      // application that uses it — a token with one reader is a distant
      // definition.
      style={theatre ? undefined : { width: "528px" }}
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {videos.map((video) => (
          <li key={video.id}>
            <VideoRowView video={video} density="sidebar" now={now} />
          </li>
        ))}
      </ol>
    </aside>
  );
}
