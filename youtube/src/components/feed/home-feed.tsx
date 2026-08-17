"use client";

import clsx from "clsx";
import { useId, useMemo, useState, type ReactNode } from "react";

import { ShortsIcon } from "@/components/icons";
import { ButtonLink } from "@/components/primitives";
import { Shelf, VideoGrid } from "@/components/video";
import type { VideoCard } from "@/domain/types";

import { FeedChipBar, feedTabId } from "./chip-bar";
// From `./chips`, not through `./chip-bar`. Both modules here are client
// modules so nothing would break at runtime, but routing a plain constant
// through a `"use client"` file is the shape that made `chipsForFeed` a client
// reference, and leaving one live example of it invites the next one.
import { ALL_CHIP_ID, ALL_CHIP_LABEL, type FeedChip } from "./chips";

/**
 * The home feed: chip bar, Shorts shelf, grid, and the three states that are
 * not a grid.
 *
 * ## What this file does not do
 *
 * It does not lay out cards. `VideoGrid` does, and the column count is neither
 * component's decision — it comes from a container query on the content column
 * published as `--yt-grid-columns` by `globals.css`, with bands bisected at
 * 572 / 890 / 1848px of *content*. The measurement that forces that design
 * (R8 §3.3): 1920px with the guide expanded is 3 columns and 1920px with it
 * collapsed is 4. Any breakpoint added here would be wrong on every toggle of
 * the rail while looking right in a screenshot.
 *
 * It also does not draw a card. `src/components/video` ships one lockup for
 * every surface in the product, which is the finding R9 §2.3 records, and a
 * feed with its own card is how a clone ends up with six paddings.
 *
 * ## Composition
 *
 * ```
 * FeedChipBar                     sticky, 56px, full-bleed with its own inset
 * div[role=tabpanel]              the 24px page inset
 *   Shelf "Shorts"                a shelf, never inline in the grid
 *   VideoGrid                     the container-query grid
 * ```
 *
 * **The Shorts shelf sits above the grid, and the product interleaves it after
 * the first row** (`screenshots/02-home-1920.png`; R8 §10.2 shows
 * `ytd-rich-section-renderer` flat among the items). That position is not
 * reproducible from here: the row length is decided by a container query at
 * paint time, so a component choosing an index has to guess it, and a
 * full-width shelf dropped after a fixed number of cards leaves an empty cell
 * in the row above at any other column count. R9 §5 measures the subscriptions
 * feed with every shelf *above* its flat grid, so that arrangement is the
 * product's own and is the one used here. Stated rather than hidden.
 *
 * **The Shorts cards are the wrong lockup, on purpose.** R9 §5.1 measures a
 * distinct component — `ytm-shorts-lockup-view-model-v2`, a **2:3** thumbnail
 * (not 9:16), no channel row, no duration badge — which the frozen card family
 * does not provide and which this slice is not entitled to add. The shelf
 * therefore uses the vertical lockup with its channel row and avatar
 * suppressed, which is as close as the available component gets; the 16:9
 * thumbnail is the visible difference.
 *
 * ## Signed in versus signed out
 *
 * R9 §4: the signed-in home is "structurally identical to logged-out, with two
 * additions: the chip bar carries personalised topic chips, and the grid is a
 * recommendation feed rather than a trending fallback." Both of those are
 * *data*, and both are settled before they reach this component —
 * `recommendations.ts` seeds from the viewer's own watch history when there is
 * one and backfills from the most-viewed pool when there is not, and
 * {@link chipsForFeed} promotes the viewer's own subscriptions to the front of
 * the chip set. A third follows for free: `watchedSeconds` is null for a
 * signed-out viewer, so the red resume bar under a thumbnail only ever appears
 * signed in.
 *
 * What this component decides is the **empty state**, because that is the one
 * place the measured copy does not generalise — see {@link FeedEmptyState}.
 */

/* ------------------------------------------------------------- the chips -- */

/**
 * How many chips the bar carries.
 *
 * R9 §4 counted 21 in one session and says to "expect 15–25 chips with an
 * overflow chevron on the right". The cap is here so a corpus with a hundred
 * channels does not produce a hundred chips; on this project's 24-video seed
 * it never binds.
 */
/**
 * Re-exported so existing importers of this module are unaffected. The
 * definitions moved to `./chips`, which has no `"use client"` directive —
 * a server component calling `chipsForFeed` from here threw
 * "Attempted to call chipsForFeed() from the server".
 *
 * `ALL_CHIP_ID`, `ALL_CHIP_LABEL` and `FeedChip` are deliberately *not*
 * re-exported here: `chip-bar.tsx` already forwards them, and forwarding the
 * same name from two modules in one barrel is an ambiguous re-export.
 */
export { chipsForFeed, MAX_FEED_CHIPS } from "./chips";

/* --------------------------------------------------------------- the feed -- */

export interface HomeFeedProps {
  videos: readonly VideoCard[];
  /** Rendered as a shelf above the grid, never as grid items. */
  shorts?: readonly VideoCard[];
  /** From {@link chipsForFeed}. Fewer than two → no bar. */
  chips?: readonly FeedChip[];
  signedIn?: boolean;
  /**
   * The server's clock.
   *
   * Passed down to every card so a feed rendered across a "1 hour ago"
   * boundary does not hydrate as a mismatch — `VideoLockupProps.now` exists
   * for exactly this and defaults to a fresh `new Date()` per card otherwise.
   */
  now?: Date;
  className?: string;
}

export function HomeFeed({
  videos,
  shorts = [],
  chips = [],
  signedIn = false,
  now,
  className,
}: HomeFeedProps) {
  const panelId = useId();
  const [selectedId, setSelectedId] = useState<string>(ALL_CHIP_ID);

  const hasBar = chips.length > 1;
  const selected = chips.find((chip) => chip.id === selectedId);

  /**
   * The filter.
   *
   * A `Set` rather than `includes`, because the selected chip on a full feed
   * holds tens of ids and the feed holds forty cards. `null` — the `All` chip,
   * or a selection that no longer exists after a refetch — means everything,
   * which is why membership is optional on `FeedChip` rather than a special
   * case here.
   */
  const membership = useMemo(
    () => (selected?.videoIds ? new Set(selected.videoIds) : null),
    [selected],
  );

  const gridVideos = membership
    ? videos.filter((video) => membership.has(video.id))
    : videos;
  const shelfVideos = membership
    ? shorts.filter((video) => membership.has(video.id))
    : shorts;

  const empty = videos.length === 0 && shorts.length === 0;
  const filteredOut =
    !empty && gridVideos.length === 0 && shelfVideos.length === 0;

  return (
    <div data-home-feed="" className={className}>
      {hasBar ? (
        <FeedChipBar
          chips={chips}
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelId={panelId}
        />
      ) : null}

      <div
        id={panelId}
        // Only a tabpanel when there are tabs. `role="tabpanel"` with no
        // tablist is a claim about a relationship that does not exist.
        role={hasBar ? "tabpanel" : undefined}
        aria-labelledby={
          hasBar ? feedTabId(panelId, selected?.id ?? ALL_CHIP_ID) : undefined
        }
        // 24px each side is `--yt-page-inset`, measured as the grid's x-origin
        // of 264 inside a content column starting at 240. The 24px above is
        // read off `screenshots/02-home-1920.png` — the chip bar ends at y=112
        // and the first thumbnail starts at ~137 — rather than off a computed
        // style, so it is the one spacing here that is approximate.
        className="px-[var(--yt-page-inset)] pt-6 pb-8"
      >
        {empty ? (
          <FeedEmptyState {...coldStartCopy(signedIn)} />
        ) : filteredOut ? (
          <FeedEmptyState
            title={`No videos in ${selected?.label ?? ALL_CHIP_LABEL}`}
            body="Nothing in this feed matches that filter yet. Pick another, or choose All to see everything."
          />
        ) : (
          <>
            {shelfVideos.length > 0 ? (
              <Shelf
                title="Shorts"
                titleIcon={<ShortsIcon size={24} />}
                // Five across, counted off `screenshots/02-home-1920.png` at
                // 1920 with the rail open, and the same count R9 §5 measured
                // as `elements-per-row` on the subscriptions Shorts shelf.
                itemsPerRow={5}
                videos={shelfVideos}
                // R9 §5.1: the Shorts lockup is title + view count. No avatar,
                // no channel row — see the header for what else it is not.
                showAvatar={false}
                showChannel={false}
                now={now}
                action={
                  <ButtonLink
                    href="/shorts"
                    variant="text"
                    palette="callToAction"
                    size="m"
                  >
                    View all
                  </ButtonLink>
                }
                // 32px, the grid's own row margin, so the shelf sits off the
                // first row of cards by the same gap two rows use.
                className="mb-8"
              />
            ) : null}

            <VideoGrid videos={gridVideos} now={now} />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ empty state -- */

/**
 * The cold-start copy.
 *
 * Signed out this is **measured**, verbatim from R8 §8.3: the logged-out home
 * with no watch history renders a single card reading `Try searching to get
 * started` over `Start watching videos to help us build a feed of videos
 * you'll love.` (`screenshots/01-home-empty-state-1920.png`).
 *
 * Signed in it is **ours**. R9 never captured an empty signed-in home, and the
 * measured line would be wrong there in a specific way: it tells a viewer who
 * already has a history and subscriptions to start building a feed. This
 * application reaches the state for a different reason anyway — an empty
 * corpus, since `recommendations.ts` backfills from the most-viewed pool and
 * only returns nothing when there is nothing.
 */
function coldStartCopy(signedIn: boolean): { title: string; body: string } {
  return signedIn
    ? {
        title: "No videos to show yet",
        body: "Videos from the channels you watch and subscribe to will appear here.",
      }
    : {
        title: "Try searching to get started",
        body: "Start watching videos to help us build a feed of videos you'll love.",
      };
}

export interface FeedEmptyStateProps {
  title: string;
  body?: string;
  /** A `ButtonLink` — Sign in, on the surfaces that need one. */
  action?: ReactNode;
  className?: string;
}

/**
 * The card an empty feed shows.
 *
 * `screenshots/01-home-empty-state-1920.png` is a single raised card centred
 * near the top of the content column with a soft drop shadow — the only place
 * in the product where a browse surface renders a card rather than a grid. Its
 * geometry and type were not in the computed-style pass, so:
 *
 * * the surface is `--yt-raised-background` with `--yt-menu-shadow`, the
 *   measured search-dropdown shadow, which is the tightest one in the token
 *   set and the closest match to the capture;
 * * the title takes `--yt-type-heading` (20/28 weight 700), the nearest
 *   measured role — the capture reads a little larger, but inventing a type
 *   step for one screen is worse than reusing a measured one;
 * * the width cap and the centring are **assumed** from the screenshot.
 *
 * It is a `role="status"`: a filter that empties the grid changes the page
 * without moving focus, and a keyboard or screen-reader user otherwise gets no
 * signal that anything happened.
 */
export function FeedEmptyState({
  title,
  body,
  action,
  className,
}: FeedEmptyStateProps) {
  return (
    <div
      data-feed-empty=""
      role="status"
      className={clsx(
        "mx-auto max-w-[700px] rounded-cozy bg-raised px-6 py-5 text-center",
        "shadow-[var(--yt-menu-shadow)]",
        className,
      )}
    >
      <h2 className="m-0 text-heading font-[var(--yt-weight-bold)] text-primary">
        {title}
      </h2>
      {body ? <p className="mt-2 mb-0 text-body text-secondary">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- skeleton -- */

/** How many placeholder tiles a loading grid draws. */
const SKELETON_TILES = 12;

/**
 * The loading state.
 *
 * Rendered as a `<Suspense>` fallback by the pages, so the masthead, the rail
 * and the chip bar's box are on screen while the feed's queries run instead of
 * a blank column.
 *
 * **It does not shimmer.** The product's placeholder animation was not part of
 * the measurement pass, and everything that *was* sampled computes
 * `transition: all 0s` (`globals.css`); a pulse invented here would be the
 * only motion in the whole of the app chrome. The tiles carry the measured
 * card geometry instead — a 16:9 block at the thumbnail's 12px radius, then
 * the 36px avatar and two text bars — which is what makes the shape
 * recognisable without motion.
 *
 * The tiles go through `VideoGrid`'s own `children` slot (the one the
 * continuation sentinel uses) rather than through a second copy of its style
 * block, so a placeholder row lands on exactly the columns the real row will.
 */
export function FeedSkeleton({ className }: { className?: string }) {
  return (
    <div data-feed-skeleton="" aria-hidden="true" className={className}>
      {/* The chip bar's 56px box, held open so the grid does not jump up into
          it when the feed resolves. */}
      <div className="h-14" />
      <div className="px-[var(--yt-page-inset)] pt-6 pb-8">
        <VideoGrid videos={[]}>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <div key={index}>
              <div className="aspect-video w-full rounded-cozy bg-additive" />
              <div className="mt-3 flex">
                <div className="mr-3 size-9 shrink-0 rounded-full bg-additive" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-11/12 rounded-condensed bg-additive" />
                  <div className="mt-2 h-3 w-2/3 rounded-condensed bg-additive" />
                </div>
              </div>
            </div>
          ))}
        </VideoGrid>
      </div>
    </div>
  );
}
