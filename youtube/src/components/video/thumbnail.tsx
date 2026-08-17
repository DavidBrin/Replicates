"use client";

// Moved to ./routes (no "use client"): ten server routes call this.
export {
  thumbnailSrc,
} from "./routes";
import {
  thumbnailSrc,
} from "./routes";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { describeDuration, formatDuration } from "@/domain/format";
import type { VideoCard } from "@/domain/types";

/**
 * The thumbnail: image, duration badge, watched-progress bar, hover preview.
 *
 * Split out from the lockup because it is genuinely reused without one — a
 * playlist's lead image, the Save sheet's 56px thumb, the search page's
 * result — and because everything inside it is measured to the pixel while
 * everything around it varies by surface.
 *
 * ## Geometry (R8 §4, `research/extracted/card-dump-1920.json`)
 *
 * | Measure | Value | Source |
 * |---|---|---|
 * | aspect | 16:9 | `padding-top: 299.992px` on a 533.33px box = 56.25% |
 * | radius | 12px vertical / sidebar, **8px** on a history row | R8 §4; R9 §2.3 |
 * | badge | 38.45×20, radius 4px, `padding: 1px 4px`, 12/18 w500 | card dump |
 * | badge ink / fill | `#fff` on `rgba(0,0,0,0.6)` | card dump |
 * | badge inset | 8px from the right and bottom edges | `padding: 0 8px 8px 0` |
 *
 * The aspect is expressed as `aspect-ratio` rather than the product's
 * padding-top hack; the ratio is identical and the box does not need a
 * positioned child to hold it open.
 *
 * ## The progress bar is the one thing here that is not measured
 *
 * `research/` contains no signed-in capture with a resumable video in it —
 * grep the extracted dumps for `progress` and the only hits are
 * `yt-page-navigation-progress`, the route-change bar at the top of the page.
 * So the bar's **height (4px) and its track colour are assumed**. What is not
 * invented is the palette: the fill is `--yt-static-brand-red` (#f03), which
 * R8 §0 establishes as the product's only red and which the player's own
 * played-portion gradient starts from, and the track is
 * `--yt-overlay-tonal-background` (30% white), the measured token for a tonal
 * surface sitting on artwork. Both are theme-invariant, which is right: the
 * bar sits on a thumbnail, not on the page.
 *
 * The bar renders for a `watchedSeconds` of `0` and does **not** render for
 * `null`. That distinction is the whole reason the field is nullable
 * (`src/domain/types.ts`): `0` is "started and seeked back to the beginning",
 * `null` is "never opened". Collapsing them puts a resume marker on every card
 * in a logged-out feed.
 */

/* --------------------------------------------------------------- source --- */

/**
 * A blob key as a URL.
 *
 * `VideoCard` carries storage *keys*, not URLs, and `/api/media/<key>` is
 * where they are served — see `src/app/api/media/[...key]/route.ts`, which
 * splits the path back into segments. Each segment is encoded separately so a
 * key containing a space survives without the slashes being escaped into the
 * single path parameter Next would then fail to match.
 *
 * In the R2-behind-a-custom-domain configuration the bytes never reach this
 * route at all; swapping the base is a change here and nowhere else.
 */

/* ---------------------------------------------------------------- radii --- */

/**
 * `cozy` (12px) is the vertical card and the watch sidebar; `compact` (8px) is
 * the history row. R9 §2.3 is explicit that the horizontal variant "changes
 * only: thumbnail radius **8px** (not 12)", which is exactly the kind of
 * two-pixel difference a from-memory rebuild loses.
 */
export type ThumbnailRadius = "cozy" | "compact";

const RADIUS: Readonly<Record<ThumbnailRadius, string>> = {
  cozy: "rounded-cozy",
  compact: "rounded-compact",
};

/* -------------------------------------------------------------- preview --- */

/**
 * How long the pointer must rest before the preview clip is fetched.
 *
 * **Assumed.** No capture in `research/` triggered an inline preview, so
 * neither the delay nor the fact that the preview is a `<video>` rather than
 * an animated sprite is measured. The delay exists for a reason that does not
 * need a measurement to justify: without it, dragging the pointer across a
 * 40-card feed starts 40 media fetches.
 */
export const PREVIEW_DELAY_MS = 500;

/* ------------------------------------------------------------ component --- */

export interface ThumbnailProps {
  video: VideoCard;
  radius?: ThumbnailRadius;
  /**
   * Drive the preview from outside.
   *
   * The lockup owns this: its title anchor covers the whole card with an
   * `::after`, so the pointer never enters the thumbnail's own box and the
   * thumbnail cannot detect its own hover. Left `undefined`, the thumbnail
   * falls back to its own pointer handlers, which is what a standalone use
   * (a playlist's lead image) needs.
   */
  previewing?: boolean;
  /** Alt text. Empty by default — the lockup's title is the accessible name. */
  alt?: string;
  className?: string;
}

export function Thumbnail({
  video,
  radius = "cozy",
  previewing,
  alt = "",
  className,
}: ThumbnailProps) {
  const [hovered, setHovered] = useState(false);
  /**
   * "The dwell has elapsed", not "the preview is showing".
   *
   * The effect below only ever *arms* — it subscribes to a timer and sets state
   * from the callback, which is what an effect is for. Disarming is the
   * cleanup's job, and whether the preview shows at all is derived rather than
   * stored, so the two can never disagree about a pointer that left during the
   * delay.
   */
  const [armed, setArmed] = useState(false);

  const wanted = previewing ?? hovered;
  const previewSrc = video.previewKey ? thumbnailSrc(video.previewKey) : null;

  useEffect(() => {
    if (!wanted || previewSrc === null) return;
    const timer = setTimeout(() => setArmed(true), PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setArmed(false);
    };
  }, [wanted, previewSrc]);

  const playing = armed && wanted && previewSrc !== null;
  const progress = watchedFraction(video);

  return (
    <div
      data-thumbnail=""
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={clsx(
        // `overflow-hidden` is what clips the progress bar's ends to the
        // radius, which is how the product renders it.
        "relative w-full overflow-hidden",
        // The resting colour of a thumbnail whose image has not arrived. A
        // token rather than a grey, so it follows the theme.
        "bg-additive",
        RADIUS[radius],
        className,
      )}
      // 56.25% exactly — the measured `padding-top: 299.992px` over 533.33px.
      style={{ aspectRatio: "16 / 9" }}
    >
      {video.thumbnailKey ? (
        // A plain <img> for the reason `Avatar` gives: `next/image` needs
        // remote patterns configured against a host this component cannot
        // know, and the blob store's URL shape belongs to another slice.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailSrc(video.thumbnailKey)}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : null}

      {playing && previewSrc !== null ? (
        /**
         * Mounted only once the delay has elapsed, so `preload` never runs for
         * a card the pointer merely crossed. Muted and `playsInline` because
         * an unmuted autoplay is refused by every browser and a fullscreening
         * preview on iOS is worse than none.
         */
        <video
          data-thumbnail-preview=""
          src={previewSrc}
          className="absolute inset-0 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          // Decorative: the title beside it is the accessible name, and a
          // second announcement of the same video is noise.
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : null}

      {video.durationSeconds > 0 ? <DurationBadge seconds={video.durationSeconds} /> : null}

      {progress !== null ? (
        <ProgressBar
          fraction={progress}
          watchedSeconds={video.watchedSeconds ?? 0}
          durationSeconds={video.durationSeconds}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- badge --- */

/**
 * `30:21`, bottom-right.
 *
 * Two elements rather than one because the visible string and the announced
 * one are different: a screen reader reads `1:34:50` as "one thirty-four
 * fifty". {@link describeDuration} exists for exactly this and produces
 * `1 hour, 34 minutes, 50 seconds`, so the badge itself is hidden from
 * assistive technology and the spoken form sits beside it.
 *
 * The spoken form is deliberately *not* folded into the card link's accessible
 * name. It is a sibling in reading order, which keeps the link's name equal to
 * the video's title — what a user searching the page by link text expects —
 * while still announcing the duration when the card is read through.
 */
function DurationBadge({ seconds }: { seconds: number }) {
  return (
    <div
      // The measured bottom overlay is 28px tall with `padding: 0 8px 8px 0`
      // around a 20px badge; an 8px inset on the two edges it touches is the
      // same geometry with one box instead of three.
      className="pointer-events-none absolute right-2 bottom-2 flex"
    >
      <span
        data-duration-badge=""
        aria-hidden="true"
        className={clsx(
          "rounded-condensed px-1 py-px",
          "bg-[var(--yt-overlay-background-medium)] text-overlay-primary",
          "text-small font-[var(--yt-weight-medium)]",
        )}
      >
        {formatDuration(seconds)}
      </span>
      <span className="sr-only">{describeDuration(seconds)}</span>
    </div>
  );
}

/* ------------------------------------------------------------- progress --- */

/**
 * How far in the viewer got, as a fraction of the video.
 *
 * `null` in, `null` out — and that is the only path that suppresses the bar.
 * A zero-length video with a recorded position is a data bug rather than a
 * reason to divide by zero, so it reports 0 and still draws the track.
 */
function watchedFraction(video: VideoCard): number | null {
  if (video.watchedSeconds === null) return null;
  if (video.durationSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, video.watchedSeconds / video.durationSeconds));
}

function ProgressBar({
  fraction,
  watchedSeconds,
  durationSeconds,
}: {
  fraction: number;
  watchedSeconds: number;
  durationSeconds: number;
}) {
  return (
    <div
      data-watched-progress=""
      // A real `progressbar`, not a decorative stripe. The information — "you
      // are two thirds through this" — is the reason the bar exists, and a
      // sighted user gets it for free; `aria-valuetext` carries the spoken
      // form because `aria-valuenow` alone would be announced as a raw count
      // of seconds.
      role="progressbar"
      aria-label="Watched"
      aria-valuemin={0}
      aria-valuemax={durationSeconds}
      aria-valuenow={watchedSeconds}
      aria-valuetext={`${describeDuration(watchedSeconds)} of ${describeDuration(durationSeconds)}`}
      className="absolute inset-x-0 bottom-0 h-1 bg-[var(--yt-overlay-tonal-background)]"
    >
      <div
        className="h-full bg-[var(--yt-static-brand-red)]"
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
