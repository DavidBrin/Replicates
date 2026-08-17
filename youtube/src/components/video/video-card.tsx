"use client";

// Moved to ./routes (no "use client") for the same reason as thumbnailSrc.
export {
  watchHref,
  channelHrefFor,
} from "./routes";
import {
  watchHref,
  channelHrefFor,
} from "./routes";

import clsx from "clsx";
import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { Avatar, Menu, buttonClassName } from "@/components/primitives";
import { MoreVerticalIcon } from "@/components/icons";
import { formatRelativeTime, formatViewCount } from "@/domain/format";
import type { VideoCard } from "@/domain/types";

import { Thumbnail, thumbnailSrc } from "./thumbnail";

/**
 * The vertical grid card — home, subscriptions, a channel's Videos tab, a
 * playlist, the "You" shelves.
 *
 * Measured in full at R8 §4 and R9 §2.3, against
 * `research/extracted/card-dump-1920.json`:
 *
 * ```
 * a.ytLockupViewModelContentImage      padding-bottom: 12px   ← thumb → text
 *   yt-thumbnail-view-model            16:9, radius 12px
 * div.ytLockupViewModelMetadata        533.33 × 66            ← 1-line title
 *   div…Avatar                         36 × 36, margin-right: 12px
 *   div…TextContainer
 *     h3 > a…Title                     16/22 w500, clamp 2, padding-right 24px
 *     div…Metadata
 *       div…MetadataRow  margin-top 2px   → channel name
 *       div…MetadataRow  margin-top 2px   → "961K views" • "10 months ago"
 *   div…MenuButton                     40 × 40, radius 20px, 24px glyph
 * ```
 *
 * The 66px metadata height is the arithmetic of the rows, not a constant:
 * 22 (one title line) + 2 + 20 + 2 + 20. A two-line title makes it 88, which
 * is what R9 measured on the signed-in feed. Nothing here sets a height.
 *
 * ## Two decisions that diverge from the measured DOM, on purpose
 *
 * **One link, not two.** The product ships an anchor around the thumbnail
 * *and* an anchor around the title, both pointing at the same video, so every
 * card is announced twice and costs two tab stops. This renders one: the title
 * is the anchor and an `::after` pseudo-element stretches it over the whole
 * card. The click target is identical, the accessible name is the title, and
 * the channel link and the kebab sit above it as positioned siblings rather
 * than nested inside it — nested interactive content is invalid HTML and
 * breaks keyboard traversal, which is the thing this arrangement exists to
 * avoid.
 *
 * **The kebab is always rendered, and always visible.** Revealing it on hover
 * is the common clone behaviour and it is wrong twice over: every card in
 * `screenshots/20-home-dark-1920.png` and `screenshots/02-home-1920.png` shows
 * its kebab with no pointer anywhere near it, and a control that exists only
 * on hover is unreachable by keyboard and by touch. It is a sibling of the
 * stretched link, so hovering or focusing it does not arm the card's link.
 *
 * ## Motion
 *
 * None. The measured hover surface is a 12px-larger, 16px-radius `Fill` behind
 * the card (R8 §4) that appears instantly — `transition: all 0s` — which is
 * what {@link CardHoverSurface} reproduces. No lift, no scale, no fade.
 */

/* ----------------------------------------------------------- shared API --- */

/**
 * What both lockups take.
 *
 * Every field is serialisable, because {@link VideoCardView} and `VideoRowView`
 * are client components and a function prop cannot cross the RSC boundary.
 * Per-video *callbacks* live on `VideoGrid`, which is server-safe and resolves
 * them before they get here.
 */
export interface VideoLockupProps {
  video: VideoCard;
  /** Where the card points. Default `/watch?v=<id>`. */
  href?: string;
  /** Where the channel name points. Default `/@<handle>`. */
  channelHref?: string;
  /**
   * Show the channel avatar.
   *
   * `false` on a channel's own page: R8 §3.7 records the Videos-tab card as
   * "**no avatar** (channel context)", because repeating one channel's picture
   * forty times on its own page is noise. The watch sidebar's lockup also
   * measures the avatar at `display: none`
   * (`research/extracted/player-chrome-and-sidebar.json`).
   */
  showAvatar?: boolean;
  /** Show the channel-name row. `false` on a channel's own page. */
  showChannel?: boolean;
  /**
   * `MenuItem` rows for the overflow kebab. Omitted → no kebab at all.
   *
   * The card cannot invent the actions — "Save to Watch later", "Not
   * interested", "Report" are other slices' behaviour — so it renders the
   * affordance only when a surface supplies something for it to open.
   */
  menuItems?: ReactNode;
  /** Names the popup. Defaults to `Actions for <title>`. */
  menuLabel?: string;
  /**
   * The clock, for relative times.
   *
   * Pass the server's `now` on a server-rendered feed: left to default, the
   * server and the client each call `new Date()` and a card that straddles a
   * boundary hydrates as a mismatch.
   */
  now?: Date;
  className?: string;
}

export type VideoCardViewProps = VideoLockupProps;

/* ------------------------------------------------------------- defaults --- */

/** `/watch?v=<id>` — the product's URL, and the one the router slice builds. */

/** `/@handle` — `Channel.handle` is stored without the `@` (`domain/types.ts`). */

/* ---------------------------------------------------------------- parts --- */

/**
 * The hover surface.
 *
 * R8 §4: `yt-touch-feedback-shape` is 557.33×401.99 against a 533.33×377.99
 * card — 12px larger on **every** side — with a 16px radius against the
 * thumbnail's 12. That mismatch is the detail that makes the hover read as a
 * card rather than as a lit thumbnail.
 *
 * A real element rather than a pseudo, and at `z-index: -1` rather than first
 * in the paint order, because the metadata block below it is in normal flow:
 * an unlayered positioned pseudo-element would paint its 5% wash *over* the
 * title. The colour is the same two-token overlay model the buttons use, so a
 * hovered card composites over the page instead of swapping to a second flat
 * colour.
 *
 * The compact lockup's hover surface is −6px rather than −12px
 * (`player-chrome-and-sidebar.json`), which is why the inset is a prop.
 */
export function CardHoverSurface({ inset }: { inset: "12" | "6" }) {
  return (
    <span
      aria-hidden="true"
      data-card-hover=""
      className={clsx(
        "pointer-events-none absolute -z-10 rounded-comfortable",
        inset === "12" ? "-inset-3" : "-inset-1.5",
        "bg-[var(--yt-fill-color)] opacity-[var(--yt-fill-opacity)]",
      )}
    />
  );
}

/**
 * The two opacity custom properties the surface above reads.
 *
 * `focus-within` as well as `hover`: keyboard focus landing on the card's link
 * must light the same surface, or a keyboard user has no idea which card they
 * are on. (The focus *ring* is separate and comes from `globals.css`.)
 */
export const CARD_HOVER_STATE = clsx(
  "[--yt-fill-color:var(--yt-touch-response)] [--yt-fill-opacity:0]",
  "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
  "focus-within:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
);

/**
 * Line clamping, as an inline style rather than a utility class.
 *
 * The clamp count is a measurement that differs per surface — 2 on the grid
 * card and the search result, 3 in the watch sidebar, 1 on a history row — so
 * it is a value, not four class names. Inline also means the number is
 * readable from the DOM, which is the only way a jsdom test can assert it.
 */
export function clampStyle(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

/**
 * The stretched link.
 *
 * `inset-0` resolves against the card's `relative` root, so this covers the
 * thumbnail as well as the text. `z-[1]` puts it above the in-flow content it
 * covers and below the two controls that must beat it — see
 * {@link ABOVE_CARD_LINK}.
 */
export const CARD_LINK_STRETCH =
  "after:absolute after:inset-0 after:z-[1] after:content-['']";

/** For siblings that must win the click: the channel link and the kebab. */
export const ABOVE_CARD_LINK = "relative z-[2]";

/* ------------------------------------------------------------- the card --- */

export function VideoCardView({
  video,
  href,
  channelHref,
  showAvatar = true,
  showChannel = true,
  menuItems,
  menuLabel,
  now,
  className,
}: VideoCardViewProps) {
  /**
   * The card owns the preview, not the thumbnail.
   *
   * The stretched `::after` above sits over the thumbnail, so the pointer
   * never enters the thumbnail's own box and its `pointerenter` never fires.
   * The card's root is an ancestor of both and does.
   */
  const [previewing, setPreviewing] = useState(false);
  const titleId = useId();

  return (
    // A feed item is an article, and an *unnamed* article is forty rows of
    // "article" with nothing to distinguish them — so it borrows the title's
    // id rather than being left anonymous.
    <article
      data-video-card=""
      aria-labelledby={titleId}
      onPointerEnter={() => setPreviewing(true)}
      onPointerLeave={() => setPreviewing(false)}
      className={clsx("relative flex flex-col", CARD_HOVER_STATE, className)}
    >
      <CardHoverSurface inset="12" />

      <Thumbnail video={video} radius="cozy" previewing={previewing} />

      {/* 12px — the measured `padding-bottom` on the image anchor. */}
      <div className="mt-3 flex">
        {showAvatar ? (
          <div data-card-avatar="" className="mr-3 shrink-0">
            <Avatar
              size="cozy"
              name={video.channelName}
              src={
                video.channelAvatarKey ? thumbnailSrc(video.channelAvatarKey) : null
              }
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <h3 className="m-0">
            <a
              id={titleId}
              href={href ?? watchHref(video)}
              data-card-link=""
              className={clsx(
                // 24px of right padding keeps the second title line clear of
                // the kebab; measured on `a.ytLockupMetadataViewModelTitle`.
                "pr-6 text-title font-[var(--yt-weight-medium)] text-primary",
                CARD_LINK_STRETCH,
              )}
              style={clampStyle(2)}
            >
              {video.title}
            </a>
          </h3>

          <div className="text-body text-secondary">
            {showChannel ? (
              <div className="mt-0.5">
                <a
                  href={channelHref ?? channelHrefFor(video)}
                  data-channel-link=""
                  // A sibling of the card's anchor, never a descendant.
                  className={clsx(ABOVE_CARD_LINK, "hover:text-primary")}
                >
                  {video.channelName}
                </a>
              </div>
            ) : null}
            <div className="mt-0.5">
              <MetaFacts video={video} now={now} />
            </div>
          </div>
        </div>

        {menuItems ? (
          // −6px is measured: the 40px button's box sits at y=441.99 against a
          // metadata block starting at 447.99. The −8px on the right is not —
          // the capture has the box overhanging the card by 10px, which would
          // collide with the next column; −8 instead pulls the 24px glyph
          // inside its 40px box flush with the card's edge, the same optical
          // correction `Button`'s icon margins make.
          <div className={clsx(ABOVE_CARD_LINK, "-mt-1.5 -mr-2 shrink-0")}>
            <CardMenu label={menuLabel ?? `Actions for ${video.title}`}>
              {menuItems}
            </CardMenu>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------ meta line --- */

/**
 * `961K views • 10 months ago`.
 *
 * Both halves come from `src/domain/format.ts` and neither is reimplemented
 * here — that file exists because views round to two significant digits while
 * subscriber counts keep three, and a call site that formats its own number
 * picks the wrong rule roughly half the time.
 *
 * The delimiter is a real `•` with `margin: 0 4px`, measured on
 * `span.ytContentMetadataViewModelDelimiter`. It is deliberately not
 * `aria-hidden`: it is the punctuation that stops "961K views" and "10 months
 * ago" being announced as one phrase. The watch sidebar's delimiter measures
 * **zero-width** — same element, no bullet — and is handled in `video-row.tsx`,
 * which is the sort of difference this module exists to keep.
 *
 * A `publishedAt` of `null` is a video that has not been published; the whole
 * delimiter goes with it rather than leaving a dangling bullet.
 */
export function MetaFacts({ video, now }: { video: VideoCard; now?: Date }) {
  const published =
    video.publishedAt === null ? null : formatRelativeTime(video.publishedAt, now);

  return (
    <>
      <span data-meta-views="">{formatViewCount(video.viewCount)}</span>
      {published === null ? null : (
        <>
          <span data-meta-delimiter="" className="mx-1">
            •
          </span>
          <span data-meta-published="">{published}</span>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ the kebab --- */

/**
 * The overflow menu.
 *
 * A bare `<button>` wearing {@link buttonClassName} rather than `Button`,
 * because `Menu` hands its trigger a callback ref and `ButtonProps` is built on
 * `ComponentPropsWithoutRef`. The class helper is exported for exactly this
 * case; the `Fill` sibling is reproduced by hand so the button still cross-
 * fades an overlay instead of swapping a background, which R9 §14 names as the
 * most visible "not quite YouTube" tell.
 *
 * Measured at 40×40 with a 24px glyph and a 20px radius — the icon-only SizeM
 * footprint.
 */
export function CardMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Menu
      align="end"
      label={label}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          aria-label={label}
          data-card-menu-trigger=""
          className={buttonClassName({
            variant: "text",
            iconOnly: true,
            size: "m",
          })}
        >
          <MoreVerticalIcon size={24} />
          <span
            aria-hidden="true"
            data-touch-fill=""
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
            style={{ opacity: "var(--yt-fill-opacity)" }}
          />
        </button>
      )}
    >
      {children}
    </Menu>
  );
}
