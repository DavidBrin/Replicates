/**
 * Shared layout measurements that more than one chrome component needs to
 * agree on. Deliberately not part of `StickyHeader.tsx`: that file is a
 * `"use client"` component (it imports `Link`, `SearchBox`, and uses
 * `useState`/`useEffect`), and `Toc.tsx` only needs the one number —
 * pulling in the whole component module to get it would drag those imports
 * along for no reason. This module has no directive and no side effects, so
 * anything can import just the constant.
 */

/**
 * The sticky header's real height in pixels (`3.125rem` at the browser
 * default 16px root — see `StickyHeader.tsx`'s `h-[3.125rem]`). Single
 * source of truth: `StickyHeader.tsx` re-exports it for anything reasoning
 * about the component itself, and `Toc.tsx` derives `TOP_BOUNDARY_PX` from
 * it directly so the two can never drift out of sync.
 */
export const STICKY_HEADER_HEIGHT_PX = 50;

/**
 * Anchor-scroll offset for heading targets (`#firstHeading`, section `h2`s):
 * the sticky header's height plus 8px of breathing room, so a TOC or hash
 * jump never lands a heading underneath the sticky header. `Toc.tsx`'s
 * `TOP_BOUNDARY_PX` equals this by construction, and `layout.tsx` publishes
 * it to CSS as `--scroll-anchor-offset` for the `scroll-margin-top` rule in
 * `globals.css` — one constant, both consumers.
 */
export const SCROLL_ANCHOR_OFFSET_PX = STICKY_HEADER_HEIGHT_PX + 8;
