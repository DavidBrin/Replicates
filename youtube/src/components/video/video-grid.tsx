import clsx from "clsx";
import type { ReactNode } from "react";

import type { VideoCard } from "@/domain/types";

import {
  VideoCardView,
} from "./video-card";

/**
 * From `./routes`, not from `./video-card`.
 *
 * This file has no `"use client"` and is rendered on the server, so importing
 * these builders from the card module made them client references and threw
 * "Attempted to call watchHref() from the server" — on the channel page's tab
 * routes only, because those are the ones that fall back to the default href.
 *
 * Worth recording because it is the first instance of this bug that was *not*
 * in `src/app/`: a server component does not have to be a page, and the
 * boundary applies wherever the rendering happens.
 */
import {
  channelHrefFor as defaultChannelHref,
  watchHref,
} from "./routes";

/**
 * The responsive feed grid.
 *
 * ## The column count is not this component's decision
 *
 * It follows the **content width**, not the viewport, and the mechanism for
 * that already exists in `src/app/globals.css`. The reason is in that file's
 * header and is worth restating because it is the thing a viewport media query
 * gets wrong on every single toggle: 1920px with the guide expanded is
 * **3 columns of 533.33px**, and 1920px with the guide collapsed to the mini
 * rail is **4 columns of 438px** (R8 §3.3, and
 * `screenshots/04-nav-expanded-1920.png` against `05b-nav-mini-detail-1920.png`).
 * Same viewport, different answer, because the rail changed the content box.
 *
 * So `globals.css` declares a container query on `.yt-content` and publishes
 * `--yt-grid-columns` on `.yt-content-inner`, with a measured band table
 * (1 → 2 at 572px of content, 2 → 3 at 890, 3 → 4 at 1848). This grid *reads*
 * that variable. It does not compute columns, does not carry a breakpoint of
 * its own, and inventing a second mechanism here is the specific failure the
 * design slice's comment warns about.
 *
 * **Therefore this must render inside `.yt-content-inner`.** Outside it the
 * variable is undefined and the fallback is a single column — which is honest
 * (a grid with no content box to measure has nothing to derive from) and
 * loud enough to notice immediately. A surface that genuinely wants a fixed
 * count — R9 §4 records the playlists index at a hard 4 — passes
 * {@link VideoGridProps.columns}.
 *
 * ## The gaps
 *
 * `column-gap` is `--yt-grid-current-item-margin`, which `globals.css` swaps
 * from 16px to 8px at ≤571px of content: R8 §3.3 measures that narrow mode as
 * a change of layout rather than of column count. `row-gap` is the measured
 * `--ytd-rich-grid-row-margin: 32px`.
 *
 * The product implements all of this as `flex-wrap` with
 * `width: calc(33.3333% - 16px); margin: 0 8px 32px` (R9 §4). CSS Grid with a
 * 16px column gap produces the identical box — verified against three measured
 * rows: `(1632 − 2×16)/3 = 533.33`, `(1800 − 3×16)/4 = 438`,
 * `(904 − 2×16)/3 = 290.67`, all matching R8 §3.3 to the hundredth of a pixel.
 * Grid is used because a wrapped flex row cannot align the last row's items to
 * the columns above them.
 *
 * ## Why this file has no `"use client"`
 *
 * It is the component a `page.tsx` renders, so it is the one that may take
 * per-video callbacks. `VideoCardView` is a client component (hover state, and
 * the `Menu` primitive's render-prop trigger), and a function cannot be handed
 * to one across the RSC boundary. This grid runs the callbacks itself and
 * passes each card a plain string and a plain `ReactNode`.
 */

export interface VideoGridProps {
  videos: readonly VideoCard[];
  /**
   * Force a column count, bypassing the container query.
   *
   * For the surfaces the research measured at a fixed count rather than a
   * derived one — the playlists index is 4 (R9 §4).
   */
  columns?: number;
  /** See `VideoLockupProps.showAvatar`. `false` on a channel's own page. */
  showAvatar?: boolean;
  showChannel?: boolean;
  /** The clock, passed through to every card so they cannot disagree. */
  now?: Date;
  hrefFor?: (video: VideoCard) => string;
  channelHrefFor?: (video: VideoCard) => string;
  /** `MenuItem` rows for one card's kebab. Omitted → no kebabs. */
  renderMenu?: (video: VideoCard) => ReactNode;
  /**
   * Rendered after the cards, inside the same grid flow.
   *
   * The continuation sentinel that loads the next page is the case this
   * exists for; R9 §4 records `ytd-continuation-item-renderer` sitting flat
   * among the items rather than outside them.
   */
  children?: ReactNode;
  className?: string;
}

export function VideoGrid({
  videos,
  columns,
  showAvatar = true,
  showChannel = true,
  now,
  hrefFor,
  channelHrefFor,
  renderMenu,
  children,
  className,
}: VideoGridProps) {
  return (
    <div
      data-video-grid=""
      className={clsx("grid", className)}
      style={{
        gridTemplateColumns: `repeat(${
          columns ?? "var(--yt-grid-columns, 1)"
        }, minmax(0, 1fr))`,
        // `minmax(0, 1fr)` rather than `1fr`: a grid track's default minimum is
        // `auto`, so one long unbreakable title would push its column past its
        // share and shift every other column. With forty user-supplied titles
        // per page that is not a hypothetical.
        columnGap: "var(--yt-grid-current-item-margin, var(--yt-grid-item-margin))",
        rowGap: "var(--yt-grid-row-margin)",
      }}
    >
      {videos.map((video) => (
        <VideoCardView
          key={video.id}
          video={video}
          href={hrefFor ? hrefFor(video) : watchHref(video)}
          channelHref={
            channelHrefFor ? channelHrefFor(video) : defaultChannelHref(video)
          }
          showAvatar={showAvatar}
          showChannel={showChannel}
          menuItems={renderMenu ? renderMenu(video) : undefined}
          now={now}
        />
      ))}
      {children}
    </div>
  );
}
