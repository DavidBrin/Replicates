"use client";

import { useEffect, useState } from "react";
import { SCROLL_ANCHOR_OFFSET_PX } from "./layout-constants";

export interface TocEntry {
  id: string;
  heading: string;
}

/**
 * `nextActiveId`'s boundary: `StickyHeader`'s real height (`STICKY_HEADER_HEIGHT_PX`,
 * 50px — see `layout-constants.ts`) plus 8px of breathing room, so a
 * heading isn't counted "passed" the instant its top clears the header's
 * bottom edge but a moment before the reader would actually call it read.
 * A heading whose `boundingClientRect.top` is between 0 and this value is
 * sitting behind (or just under) the sticky header: it has already
 * scrolled past the reader's actual reading position even though its raw
 * top is still positive, so `nextActiveId` must treat it the same as a
 * heading with a negative top (already passed), not as one still below the
 * top of the page.
 *
 * Previously a bare `96` — nearly double the header's actual 50px, with no
 * stated derivation — which meant a heading sitting at, say, 70px (visibly
 * below the header, in normal reading position) was still treated as "not
 * yet reached."
 */
export const TOP_BOUNDARY_PX = SCROLL_ANCHOR_OFFSET_PX;

/**
 * Pure reducer for the active TOC entry, extracted so it's testable without
 * a browser. `state` maps heading id -> measured viewport top. The rule is
 * the plain scrollspy one (and what Vector 2022 itself does): the active
 * section is the LAST heading sitting at or above the anchor boundary —
 * you are "in" a section from the moment its heading reaches the boundary
 * until the next section's heading does. No heading at or above the
 * boundary means the reader is above every section: "" ("(Top)").
 *
 * The +1 tolerance absorbs subpixel landings: an anchor jump places the
 * target heading at exactly `scroll-margin-top` (= the boundary), which
 * the browser may report as 57.6-58.0 — it must count as arrived.
 *
 * A heading missing from `state` (not yet in the DOM) is simply skipped;
 * with measurements taken directly on scroll the map is normally complete.
 */
export function nextActiveId(
  headingIds: string[],
  state: ReadonlyMap<string, number>,
): string {
  let active = "";
  for (const id of headingIds) {
    const top = state.get(id);
    if (top !== undefined && top <= TOP_BOUNDARY_PX + 1) {
      active = id;
    }
  }
  return active;
}

/**
 * The sticky left "Contents" panel. "(Top)" is always the first entry
 * (research/03); the active section is tracked by direct
 * measurement on scroll (see the effect body for why not IntersectionObserver)
 * and highlighted; the whole panel hides at narrow widths (it has nowhere
 * to sit once the left rail collapses).
 */
export function Toc({ sections }: { sections: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (sections.length === 0) return;

    const headingIds = sections.map((section) => section.id);

    /*
     * Positions are re-measured directly on every (rAF-throttled) scroll and
     * resize rather than via IntersectionObserver. An observer only emits
     * entries when a heading's intersection *status* changes, so an instant
     * jump (TOC click, `#hash` navigation, Home/End) that carries every
     * heading straight across the active band — non-intersecting before,
     * non-intersecting after — produced no event at all and left a stale
     * highlight. Direct measurement is a handful of getBoundingClientRect
     * calls per frame, cheap at this page size, and gives the reducer
     * complete information every time.
     */
    const measure = () => {
      const state = new Map<string, number>();
      for (const id of headingIds) {
        const el = document.getElementById(id);
        if (el) state.set(id, el.getBoundingClientRect().top);
      }
      setActiveId(nextActiveId(headingIds, state));
    };

    let frame = 0;
    const onScrollOrResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [sections]);

  if (sections.length === 0) return null;

  return (
    /*
     * Sticky offset is 4rem, not the 1.5rem research/03 records, because
     * this replica renders the sticky header for every reader (the live site
     * only shows it to logged-in accounts) and a 1.5rem offset would slide
     * the first TOC entries underneath it.
     *
     * Two shapes corrected against the served panel: it has *no* left rule
     * down the list (entries are indented 12px instead), and the "Contents"
     * heading carries a hairline beneath it (the served panel also has a
     * "hide" affordance; removed here with the rest of the unsupported
     * controls, per DECISIONS D5 as rewritten).
     */
    <nav
      aria-label="Contents"
      className="sticky top-16 ml-1 hidden max-h-[calc(100vh-5rem)] w-[176px] overflow-auto text-[14px] min-[1120px]:block"
    >
      <div className="border-b border-[color:var(--toolbar-rule)] pb-2">
        <span className="font-bold">Contents</span>
      </div>
      <ul className="m-0 list-none p-0 pt-2">
        <li className="pl-3">
          <a
            href="#top"
            className={`block py-[5px] no-underline ${
              activeId === "" ? "font-bold text-[color:var(--text)]" : "text-[color:var(--link)]"
            }`}
          >
            (Top)
          </a>
        </li>
        {sections.map((section) => (
          <li key={section.id} className="pl-3">
            <a
              href={`#${section.id}`}
              className={`block py-[5px] no-underline ${
                activeId === section.id
                  ? "font-bold text-[color:var(--text)]"
                  : "text-[color:var(--link)]"
              }`}
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
