"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SearchBox } from "./SearchBox";
import { STICKY_HEADER_HEIGHT_PX } from "./layout-constants";

// Re-exported so anything already importing the component module can still
// get the constant; `Toc.tsx` imports it from `./layout-constants` directly
// instead, to avoid pulling this "use client" component's own imports
// (Link, Greyed, SearchBox) into its bundle just for one number.
export { STICKY_HEADER_HEIGHT_PX };

/**
 * A separate, duplicate condensed bar (`#vector-sticky-header`) that slides
 * in once the real header scrolls out of view. Per research/03 this is
 * genuinely a second DOM node, not the same header re-positioned.
 */
export function StickyHeader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 180);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      id="vector-sticky-header"
      /*
        `-mb-[3.125rem]` pulls the bar back out of the flow. It still sticks
        on scroll, but it no longer pushes the h1 50px down the page: on the
        served site the title sits 24px under the header, and with the bar
        occupying flow space the replica's sat at 160px against Wikipedia's
        90px — the single biggest above-the-fold offset.
      */
      className={`sticky top-0 z-40 -mb-[3.125rem] h-[3.125rem] min-h-[3.125rem] border-b border-[color:var(--sticky-rule)] bg-white transition-opacity ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!visible}
      // WCAG 4.1.2: opacity/pointer-events alone hide the bar visually but
      // leave its link/input/button in the tab order while invisible.
      // `inert` (driven by the same `visible` state as `aria-hidden`)
      // removes them from focus and interaction, not just from the a11y
      // tree.
      inert={!visible}
    >
      <div className="flex min-h-[3.125rem] items-center gap-4">
        <Link
          href="/"
          className="shrink-0 font-serif text-[15px] text-[color:var(--text)] no-underline"
          style={{ fontVariant: "small-caps" }}
        >
          Wikipedia
        </Link>
        <div className="w-full max-w-[474px]">
          <SearchBox />
        </div>
        <div className="flex-1" />
      </div>
    </div>
  );
}
