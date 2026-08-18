import type { ReactNode } from "react";
import { slugifyHeading } from "./slugify";

export interface Subsection {
  heading: string;
  children: ReactNode;
}

export interface SectionProps {
  /** Section heading text, e.g. "History". */
  heading: string;
  /** Overrides the id derived from `heading` (rarely needed). */
  id?: string;
  children: ReactNode;
  subsections?: Subsection[];
}

/**
 * An h2 section with a derived anchor id and optional h3 subsections. This
 * replica has no editing, so it carries no `[edit]` affordance at all — per
 * DECISIONS D5 (superseded 2026-08-18), controls for unsupported features are
 * removed outright rather than greyed.
 */
export function Section({ heading, id, children, subsections }: SectionProps) {
  const sectionId = id ?? slugifyHeading(heading);

  return (
    <section aria-labelledby={sectionId}>
      <h2 id={sectionId}>
        <span className="mw-headline">{heading}</span>
      </h2>
      {children}
      {subsections?.map((sub) => {
        const subId = slugifyHeading(sub.heading);
        return (
          <div key={subId}>
            <h3 id={subId}>{sub.heading}</h3>
            {sub.children}
          </div>
        );
      })}
    </section>
  );
}
