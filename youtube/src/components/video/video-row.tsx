"use client";

import Link from "next/link";
import clsx from "clsx";
import { useId, useState, type ReactNode } from "react";

import { Avatar } from "@/components/primitives";
import { PlaySmallIcon } from "@/components/icons";
import {
  formatCompactCount,
  formatCompactRelativeTime,
  formatViewCount,
} from "@/domain/format";
import type { VideoCard } from "@/domain/types";

import { Thumbnail, thumbnailSrc, type ThumbnailRadius } from "./thumbnail";
import {
  ABOVE_CARD_LINK,
  CARD_HOVER_STATE,
  CARD_LINK_STRETCH,
  CardHoverSurface,
  CardMenu,
  MetaFacts,
  channelHrefFor,
  clampStyle,
  watchHref,
  type VideoLockupProps,
} from "./video-card";

/**
 * The horizontal lockup — the watch sidebar, a search result, a history row.
 *
 * R9 §2.3 says the horizontal variant "keeps the same tree and changes only"
 * a handful of values. That is true and it is also the trap: the handful is
 * different for each of the three surfaces, and every one of the differences
 * is the sort of thing a rebuild-from-memory flattens into an average.
 *
 * | | sidebar (compact) | search | history |
 * |---|---|---|---|
 * | row | 528 × 185.63 | 855 × 235.38 | 629 × 138.4 |
 * | thumbnail | 330 | 419.5 | 246 |
 * | thumb radius | 12px | 12px *(assumed)* | **8px** |
 * | thumb → text | **8px** | 16px | 16px |
 * | title | 14/20 w500, **3** lines | 18/26, 2 lines | 16/22 w500, **1** line |
 * | metadata type | 12/18 | 14/20 | 12/18 |
 * | avatar | none | 24px, on the channel row | none |
 * | counts | `858K` `2y ago` | `318K views • 1 month ago` | `channel • 14M views` |
 * | hover inset | −6px | −12px *(assumed)* | −12px *(assumed)* |
 *
 * Sources: `research/extracted/player-chrome-and-sidebar.json` (sidebar, dumped
 * node by node), R8 §3.6 + `screenshots/08-search-results-1920.png` (search),
 * R9 §6 (history).
 *
 * ## The sidebar's metadata row is the single most forgettable thing here
 *
 * R8 §8.2 calls it out and the dump confirms it: the sidebar renders a 12px
 * play glyph, then `858K` with the word "views" **dropped**, then `2y ago`.
 * Same video, same page, a different formatter from the card's `858K views` /
 * `2 years ago`. And its `span.ytContentMetadataViewModelDelimiter` measures
 * **0 × 0** — the element is there, carrying `margin: 0 4px`, but there is no
 * bullet in it. `screenshots/09-watch-1920.png` confirms: `▷ 296K  2w ago`,
 * eight pixels of nothing where the card would put a `•`.
 *
 * ## Search results carry a description snippet, and `VideoCard` does not
 *
 * By design — `VideoCard` is documented as "what a feed row needs and nothing
 * more" and a feed of forty descriptions is an order of magnitude of payload
 * for text no card shows. The search slice passes the snippet as
 * {@link VideoRowViewProps.children}, which renders below the metadata.
 */

export type VideoRowDensity = "sidebar" | "search" | "history";

interface Density {
  /** Measured thumbnail width. A basis, not a lock — see the note below. */
  readonly thumbWidth: number;
  readonly thumbRadius: ThumbnailRadius;
  /** Measured gap between the thumbnail and the text column, px. */
  readonly gap: number;
  readonly titleClass: string;
  readonly titleLines: number;
  readonly metaClass: string;
  /** The hover surface's inset, per `CardHoverSurface`. */
  readonly hoverInset: "12" | "6";
}

/**
 * The thumbnail width is a `flex-basis` that is allowed to shrink, not a fixed
 * size. The measured numbers hold at the measured column width — 330 in a 528
 * sidebar — and the sidebar's own `--ytd-watch-flexy-sidebar-min-width` is
 * 320px (R8 §3.4), which a rigid 330px thumbnail would overflow. Shrinking
 * keeps the 16:9 box and loses width, which is what the product does.
 */
const DENSITIES: Readonly<Record<VideoRowDensity, Density>> = {
  sidebar: {
    thumbWidth: 330,
    thumbRadius: "cozy",
    gap: 8,
    titleClass: "text-body font-[var(--yt-weight-medium)]",
    titleLines: 3,
    metaClass: "text-small",
    hoverInset: "6",
  },
  search: {
    // 419.5 measured; the half-pixel is a division artefact of the 855px
    // column and is not reproduced.
    thumbWidth: 420,
    // **Assumed.** R8 §3.6 records the search thumbnail's box and its badge
    // but not its radius; `screenshots/08-search-results-1920.png` shows the
    // same corner as every other thumbnail, so it inherits the 12px default.
    thumbRadius: "cozy",
    gap: 16,
    titleClass: "text-result",
    titleLines: 2,
    metaClass: "text-body",
    hoverInset: "12",
  },
  history: {
    thumbWidth: 246,
    thumbRadius: "compact",
    gap: 16,
    titleClass: "text-title font-[var(--yt-weight-medium)]",
    titleLines: 1,
    metaClass: "text-small",
    hoverInset: "12",
  },
};

export interface VideoRowViewProps extends VideoLockupProps {
  /** Which surface this row is on. Default `sidebar`, the compact lockup. */
  density?: VideoRowDensity;
  /**
   * Rendered below the metadata.
   *
   * The escape hatch for anything `VideoCard` deliberately does not carry —
   * the search result's description snippet, a playlist row's position badge.
   */
  children?: ReactNode;
}

export function VideoRowView({
  video,
  density = "sidebar",
  href,
  channelHref,
  showAvatar = false,
  showChannel = true,
  menuItems,
  menuLabel,
  now,
  children,
  className,
}: VideoRowViewProps) {
  const [previewing, setPreviewing] = useState(false);
  const titleId = useId();
  const spec = DENSITIES[density];

  return (
    <article
      data-video-row=""
      data-density={density}
      aria-labelledby={titleId}
      onPointerEnter={() => setPreviewing(true)}
      onPointerLeave={() => setPreviewing(false)}
      className={clsx("relative flex", CARD_HOVER_STATE, className)}
    >
      <CardHoverSurface inset={spec.hoverInset} />

      <div
        className="min-w-0 shrink"
        style={{ flex: `0 1 ${spec.thumbWidth}px`, marginRight: spec.gap }}
      >
        <Thumbnail
          video={video}
          radius={spec.thumbRadius}
          previewing={previewing}
        />
      </div>

      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <h3 className="m-0">
            <Link
              id={titleId}
              href={href ?? watchHref(video)}
              data-card-link=""
              className={clsx(
                // 24px right padding, measured on the history row's title and
                // shared by the vertical card — it is what keeps a wrapped
                // line clear of the kebab.
                "pr-6 text-primary",
                spec.titleClass,
                CARD_LINK_STRETCH,
              )}
              style={clampStyle(spec.titleLines)}
            >
              {video.title}
            </Link>
          </h3>

          <div className={clsx("text-secondary", spec.metaClass)}>
            {density === "search" ? (
              <SearchMetadata
                video={video}
                now={now}
                showAvatar={showAvatar}
                showChannel={showChannel}
                channelHref={channelHref}
              />
            ) : density === "history" ? (
              <HistoryMetadata
                video={video}
                showChannel={showChannel}
                channelHref={channelHref}
              />
            ) : (
              <SidebarMetadata
                video={video}
                now={now}
                showChannel={showChannel}
                channelHref={channelHref}
              />
            )}
          </div>

          {children}
        </div>

        {menuItems ? (
          // Top-right of the row, per R9 §6's history dump. No negative top
          // margin here: the row's title starts at the row's own top edge, so
          // the 40px button is already flush with it.
          <div className={clsx(ABOVE_CARD_LINK, "-mr-2 shrink-0")}>
            <CardMenu label={menuLabel ?? `Actions for ${video.title}`}>
              {menuItems}
            </CardMenu>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- pieces --- */

function ChannelLink({
  video,
  channelHref,
  className,
}: {
  video: VideoCard;
  channelHref?: string;
  className?: string;
}) {
  return (
    <Link
      href={channelHref ?? channelHrefFor(video)}
      data-channel-link=""
      className={clsx(ABOVE_CARD_LINK, "hover:text-primary", className)}
    >
      {video.channelName}
    </Link>
  );
}

/**
 * `▷ 858K` then `2y ago`, on two rows with the channel above them.
 *
 * Both formatters are the sidebar-only pair from `src/domain/format.ts`;
 * calling `formatViewCount` here would render `858K views` and calling
 * `formatRelativeTime` would render `2 years ago`, either of which is
 * instantly wrong beside a real watch page.
 */
function SidebarMetadata({
  video,
  now,
  showChannel,
  channelHref,
}: {
  video: VideoCard;
  now?: Date;
  showChannel: boolean;
  channelHref?: string;
}) {
  const views = formatCompactCount(video.viewCount);
  const published =
    video.publishedAt === null
      ? null
      : formatCompactRelativeTime(video.publishedAt, now);

  return (
    <>
      {showChannel ? (
        <div className="mt-0.5">
          <ChannelLink video={video} channelHref={channelHref} />
        </div>
      ) : null}
      <div className="mt-0.5 flex items-center">
        {/* 12 × 12 with `margin-right: 4px`, measured on
            `span.ytContentMetadataViewModelLeadingIcon`. */}
        <PlaySmallIcon size={12} className="mr-1 shrink-0" />
        <span data-meta-views="">{views}</span>
        {published === null ? null : (
          <>
            {/* Measured 0 × 0 with `margin: 0 4px` — the delimiter element
                exists and is empty. The comma is `sr-only` so the two facts
                are not announced as one run-on phrase; nothing about it is
                visible, which is the measurement. */}
            <span data-meta-delimiter="" className="mx-1">
              <span className="sr-only">, </span>
            </span>
            <span data-meta-published="">{published}</span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * `318K views • 1 month ago`, then the channel with a 24px avatar beside it.
 *
 * The order is inverted against the grid card — counts first, channel second —
 * which `screenshots/08-search-results-1920.png` shows plainly and which no
 * amount of reasoning about the card would predict.
 */
function SearchMetadata({
  video,
  now,
  showAvatar,
  showChannel,
  channelHref,
}: {
  video: VideoCard;
  now?: Date;
  showAvatar: boolean;
  showChannel: boolean;
  channelHref?: string;
}) {
  return (
    <>
      <div className="mt-0.5">
        <MetaFacts video={video} now={now} />
      </div>
      {showChannel ? (
        // 12px above the channel row. **Not measured** — R8 §3.6 records the
        // result's boxes but not the spacing inside its text column; this is
        // read off `screenshots/08-search-results-1920.png`, where the counts
        // row and the channel row sit ~33px apart at a 20px line height.
        <div className="mt-3 flex items-center">
          {showAvatar ? (
            <Avatar
              data-card-avatar=""
              size="condensed"
              name={video.channelName}
              src={
                video.channelAvatarKey ? thumbnailSrc(video.channelAvatarKey) : null
              }
              className="mr-2"
            />
          ) : null}
          <ChannelLink video={video} channelHref={channelHref} />
        </div>
      ) : null}
    </>
  );
}

/**
 * `MrBeast Gaming • 14M views` — one row, no date.
 *
 * R9 §6's dump of `/feed/history` records a single `MetadataRow` carrying
 * "channel • views" at 12/18, with `padding: 8px 0`. A history list is already
 * grouped under `Today` / `Yesterday` headings, so the per-row date the card
 * shows would be saying the same thing twice.
 */
function HistoryMetadata({
  video,
  showChannel,
  channelHref,
}: {
  video: VideoCard;
  showChannel: boolean;
  channelHref?: string;
}) {
  return (
    <div className="mt-0.5 py-2">
      {showChannel ? (
        <>
          <ChannelLink video={video} channelHref={channelHref} />
          <span data-meta-delimiter="" className="mx-1">
            •
          </span>
        </>
      ) : null}
      <span data-meta-views="">{formatViewCount(video.viewCount)}</span>
    </div>
  );
}
