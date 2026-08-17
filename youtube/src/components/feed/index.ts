/**
 * The feed slice: the first screen, and the two `/feed/*` surfaces beside it.
 *
 * Three components, and the split between them follows the one seam that
 * matters in this application — which of them owns state.
 *
 * * {@link FeedChipBar} owns the scroll position and the roving tab order, so
 *   it is a client component. It is the *only* part of the filter bar that is:
 *   the chip's 32px box and 8px radius live in `components/primitives/chip.tsx`
 *   and the 56px bar with its 12px gap lives beside them, both measured, both
 *   frozen.
 * * {@link HomeFeed} owns which chip is selected, and therefore which cards the
 *   grid gets. Everything below it — the grid's columns, the card, the shelf —
 *   belongs to `components/video`, whose API is frozen and whose layout is a
 *   container query on the content column rather than a breakpoint.
 * * {@link FeedEmptyState} and {@link FeedSkeleton} own nothing and are shared
 *   with the subscriptions surfaces, which compose their shelves and grid
 *   directly because they have no chip bar to select through.
 *
 * Nothing here reads a database. The pages under `src/app/(main)/` do that and
 * hand down plain values, which is what keeps every prop serialisable across
 * the RSC boundary — the constraint `components/video/index.ts` spells out and
 * the reason `FeedChip` carries its membership as an array of ids rather than
 * as a predicate.
 *
 * Every number cited in these files comes from
 * `research/08-youtube-ui-measured.md` (logged out) or
 * `research/09-youtube-signedin-surfaces.md` (signed in), against the dumps in
 * `research/extracted/`. Four things are chosen rather than measured and each
 * says so where it is chosen: the chip *taxonomy* (channels, because a
 * `VideoCard` carries no category), the tablist's accessible name, the
 * signed-in empty-state copy, and the empty card's type role.
 */

/**
 * The server-safe half, forwarded from `./chips` — **not** from the components.
 *
 * This barrel is the reason the client-boundary bug survived its first fix.
 * `chipsForFeed` had already been moved into `./chips`, which carries no
 * `"use client"` directive, and `home-feed.tsx` re-exported it for
 * compatibility. But a re-export does not launder the boundary: forwarding a
 * name *through* a client module still yields a client reference, so the
 * server-rendered home page importing it from this barrel kept throwing
 * "Attempted to call chipsForFeed() from the server".
 *
 * It also hid, because with an empty corpus the home page never reaches the
 * call — every route returned 200 against a fresh database and only started
 * failing once there were videos to build chips from.
 *
 * So the rule has a corollary worth writing down: **the barrel must import
 * from the module that defines a value, not from whichever module happens to
 * re-export it.**
 */
export {
  ALL_CHIP_ID,
  ALL_CHIP_LABEL,
  MAX_FEED_CHIPS,
  chipsForFeed,
  type FeedChip,
} from "./chips";

export {
  FILTER_BAR_LABEL,
  FeedChipBar,
  feedTabId,
  type FeedChipBarProps,
} from "./chip-bar";

export {
  FeedEmptyState,
  FeedSkeleton,
  HomeFeed,
  type FeedEmptyStateProps,
  type HomeFeedProps,
} from "./home-feed";
