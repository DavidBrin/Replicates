"use client";

import { useEffect, useState } from "react";

export interface TocEntry {
  id: string;
  heading: string;
}

/**
 * The sticky left "Contents" panel. "(Top)" is always the first entry
 * (research/03); the active section is tracked via IntersectionObserver
 * and highlighted; the whole panel hides at narrow widths (it has nowhere
 * to sit once the left rail collapses).
 */
export function Toc({ sections }: { sections: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
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
     * heading carries a "hide" affordance and a hairline beneath it.
     */
    <nav
      aria-label="Contents"
      className="sticky top-16 ml-1 hidden max-h-[calc(100vh-5rem)] w-[176px] overflow-auto text-[14px] min-[1120px]:block"
    >
      <div className="flex items-center gap-4 border-b border-[color:var(--toolbar-rule)] pb-2">
        <span className="font-bold">Contents</span>
        <span
          className="cursor-not-allowed select-none rounded-[2px] bg-[color:var(--subtle-bg)] px-2 py-0.5 text-[13px] text-[color:var(--text)]/50"
          title="Collapsing the contents panel is not functional in this replica"
          aria-disabled="true"
        >
          hide
        </span>
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
