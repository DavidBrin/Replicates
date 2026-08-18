import type { Metadata } from "next";
import { SCROLL_ANCHOR_OFFSET_PX } from "@/components/chrome/layout-constants";
import type { ReactNode } from "react";
import "./globals.css";
import { Header, StickyHeader } from "@/components/chrome";

export const metadata: Metadata = {
  title: {
    template: "%s - Wikipedia",
    default: "Wikipedia",
  },
};

/**
 * The Vector 2022 page shell: header (+ its separate sticky duplicate),
 * then `#mw-page-container` — `min-width:18.75em; max-width:99.75rem;
 * margin:0 auto; padding-inline:1.5rem; background:#fff` on a `#f8f9fa`
 * page background (research/03).
 *
 * `children` is a route's full composed content — titlebar, toolbar, TOC,
 * article body, footer — built by that route (see
 * `src/app/wiki/[slug]/page.tsx`), because the TOC's sections are
 * per-article and this layout has no way to know them generically.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className="bg-[color:var(--subtle-bg)]"
        style={{ "--scroll-anchor-offset": `${SCROLL_ANCHOR_OFFSET_PX}px` } as React.CSSProperties}
      >
        {/*
          `padding-inline` is 1.5rem on narrow viewports and widens to 44px
          from 1120px up — measured on the served page at 1440x900, where
          `.mw-page-container-inner` starts at x=44 and the content column
          lands at x=264.
        */}
        <div id="mw-page-container" className="mx-auto min-w-[18.75em] max-w-[var(--container-max)] bg-[color:var(--body-bg)] px-6 min-[1120px]:px-11">
          <Header />
          <StickyHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
