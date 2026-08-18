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
  /** Sections render an edit affordance by default; article intros do not. */
  editable?: boolean;
}

/**
 * An h2 section with a derived anchor id, an optional [edit] affordance
 * (greyed — this replica has no editing), and optional h3 subsections.
 */
export function Section({ heading, id, children, subsections, editable = true }: SectionProps) {
  const sectionId = id ?? slugifyHeading(heading);

  return (
    <section aria-labelledby={sectionId}>
      {/*
        The edit affordance follows the heading text inline. On the served
        page `.mw-editsection` sits 13px to the right of the last word, not
        flush against the right end of the rule — this used to render it as a
        `justify-between` flex row, which put `[edit]` ~600px away from the
        heading it edits.
      */}
      <h2 id={sectionId}>
        <span className="mw-headline">{heading}</span>
        {editable && <EditAffordance />}
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

/**
 * The classic `[edit]` link, greyed rather than removed: this is a static
 * replica with nothing to edit, but a live-looking-then-dead control is
 * worse than an honestly inert one (DECISIONS D5).
 */
function EditAffordance() {
  return (
    <span
      className="mw-editsection select-none text-[color:var(--text)]/50"
      title="Editing is not available in this replica"
      aria-hidden="true"
    >
      [edit]
    </span>
  );
}
