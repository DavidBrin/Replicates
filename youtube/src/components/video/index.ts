/**
 * The video card family — the most-repeated component in the product.
 *
 * One lockup renders the home grid, the search results, the channel page, a
 * playlist, the history list and the watch page's sidebar. That is not a
 * simplification: `research/09-youtube-signedin-surfaces.md` §2.3 records that
 * modern YouTube ships exactly one `yt-lockup-view-model` whose *host modifier
 * classes* — `Vertical`, `Horizontal`, `Compact` — select the layout. Building
 * a separate card per surface is how a clone ends up with six slightly
 * different paddings.
 *
 * Two components, therefore, and not six:
 *
 * * {@link VideoCardView} — the vertical grid card (R8 §4).
 * * {@link VideoRowView} — the horizontal one, at three measured densities
 *   (R9 §2.3, §6; R8 §3.4, §3.6).
 *
 * Plus the three things that arrange them: {@link Thumbnail} (also usable on
 * its own — a playlist's lead image is a thumbnail with no lockup around it),
 * {@link VideoGrid} and {@link Shelf}.
 *
 * ## The server/client seam, which is the part that will bite a caller
 *
 * `VideoCardView`, `VideoRowView` and `Shelf` are **client components**: the
 * card owns hover-preview state and the kebab drives the `Menu` primitive,
 * whose `trigger` is a render prop — and a function cannot cross the RSC
 * boundary. So every prop they take is serialisable. There are no `hrefFor`
 * or `renderMenu` callbacks on them; there is `href`, `channelHref` and
 * `menuItems`, which are a string, a string and a `ReactNode`.
 *
 * {@link VideoGrid} is the exception and is deliberately **server-safe** (no
 * `"use client"`, no hooks). It is the component a `page.tsx` renders, so it
 * is the one that takes the per-video callbacks — `hrefFor`, `renderMenu` —
 * and resolves them to serialisable props before handing each card off. A
 * server page can therefore write `renderMenu={(v) => <SaveMenu videoId={v.id} />}`
 * and it works; writing the same callback on `Shelf` would not, which is why
 * `Shelf` does not offer one. A shelf that needs per-item menus passes
 * pre-rendered `children` instead of `videos`.
 *
 * ## Where the numbers come from
 *
 * Every measurement is cited at the point it is used, to
 * `research/08-youtube-ui-measured.md` (R8, logged out) and
 * `research/09-youtube-signedin-surfaces.md` (R9, signed in), against the raw
 * dumps in `research/extracted/`. Three things in this module are **assumed**
 * rather than measured, and each says so where it is chosen:
 *
 *   1. the watched-progress bar's height and colours — no signed-in capture
 *      contains one (`thumbnail.tsx`);
 *   2. the hover-preview delay and the fact that a preview is a `<video>` at
 *      all (`thumbnail.tsx`);
 *   3. the shelf's arrow position and default items-per-row (`shelf.tsx`).
 *
 * ## Motion
 *
 * There is none. Every element sampled in
 * `research/extracted/theme-light-dark-hover-motion.json` — the lockup and the
 * thumbnail among them — computes `transition: all 0s ease`. The player is the
 * exception and is not this module's. No card here fades, lifts or scales.
 */

export {
  Thumbnail,
  PREVIEW_DELAY_MS,
  type ThumbnailProps,
  type ThumbnailRadius,
} from "./thumbnail";

export {
  VideoCardView,
  type VideoCardViewProps,
  type VideoLockupProps,
} from "./video-card";

export {
  VideoRowView,
  type VideoRowDensity,
  type VideoRowViewProps,
} from "./video-row";

export { VideoGrid, type VideoGridProps } from "./video-grid";

export { Shelf, type ShelfProps } from "./shelf";

/**
 * Forwarded from the module that DEFINES them, not through the client
 * components that render them. Re-exporting a value *through* a `"use client"`
 * module still yields a client reference — that is how this bug survived its
 * first fix.
 */
export {
  thumbnailSrc,
  watchHref,
  channelHrefFor,
  shortHref,
} from "./routes";
