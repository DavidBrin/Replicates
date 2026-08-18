"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toc, type TocEntry } from "./Toc";
import { PageTitlebar } from "./PageTitlebar";
import { PageToolbar } from "./PageToolbar";
import { PageTools } from "./PageTools";
import { Footer } from "./Footer";

/**
 * The `.mw-body` grid shared by every article-styled route: `[left rail
 * (Contents TOC)] [content column max 59.25rem, gap 24px]`, with the
 * titlebar/toolbar above the content column and the footer below the
 * grid entirely (research/03). `layout.tsx` owns the page-level
 * `#mw-page-container`; this owns the per-route body composition so
 * `src/app/page.tsx` and `src/app/wiki/[slug]/page.tsx` don't each
 * reimplement it.
 *
 * The registry's `ArticleModule` carries only `meta` + `body` — no
 * separate sections list (`src/lib/registry.ts` is out of this agent's
 * scope to extend). Every article section is built from the `Section`
 * wiki primitive, which always renders an `h2[id]` derived from its
 * heading, so the TOC is derived by reading those headings out of the
 * rendered content after mount rather than requiring a second,
 * hand-maintained sections list that could drift from the real markup.
 */
export function ArticleShell({
  title,
  lastEdited,
  children,
}: {
  title: string;
  lastEdited?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<TocEntry[]>([]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const headings = Array.from(container.querySelectorAll<HTMLHeadingElement>("h2[id]"));
    setSections(
      headings.map((h) => ({
        id: h.id,
        // `.mw-headline` is the heading text alone. Reading the h2's own
        // textContent would drag the inline `[edit]` affordance into every
        // TOC entry ("Overview[edit]").
        heading: (h.querySelector(".mw-headline") ?? h).textContent ?? "",
      })),
    );
  }, [children]);

  return (
    <>
      {/*
        Three columns, not two: on the served page at 1440x900 the left rail
        occupies a 196px slot, the content column 912px, and a 196px right
        rail carries the page-tools panel — 196 + 24 + 912 + 24 + 196 = the
        1352px inner container exactly. Dropping the right rail (as this used
        to) left the content column hanging left of centre with a 220px hole
        beside it, which is the first thing a daily reader notices.
        `minmax(0, var(--content-max))` keeps the 948px ceiling research/03
        measured while letting the column shrink to 912px here.
      */}
      <main
        id="content"
        className="mw-body grid grid-cols-1 gap-x-6 pt-6 min-[1120px]:grid-cols-[var(--rail)_minmax(0,var(--content-max))_var(--rail)]"
      >
        {/* The rails hang 2.8rem below the content column's top edge, level
            with the toolbar rather than the title. */}
        <div className="order-2 mt-0 min-[1120px]:order-1 min-[1120px]:mt-[2.8rem]">
          <Toc sections={sections} />
        </div>
        <div id="top" className="order-1 min-w-0 min-[1120px]:order-2">
          <PageTitlebar title={title} />
          <PageToolbar />
          <div ref={contentRef} className="mw-body-content mt-4">
            {children}
          </div>
        </div>
        <div className="order-3 hidden min-[1120px]:mt-[2.8rem] min-[1120px]:block">
          <PageTools />
        </div>
      </main>
      <Footer lastEdited={lastEdited} />
    </>
  );
}
