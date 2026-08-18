import type { ReactNode } from "react";

/**
 * A superscript numbered citation marker, e.g. `[3]`. `n` is the 1-based
 * position of the corresponding entry in the article's `<References>`
 * list; the two components share the `cite_note-n` / `cite_ref-n` anchor
 * pair so a click jumps both ways, matching MediaWiki's own markup.
 */
export function Ref({ n }: { n: number }) {
  return (
    <sup id={`cite_ref-${n}`} className="reference">
      <a href={`#cite_note-${n}`}>[{n}]</a>
    </sup>
  );
}

export interface ReferencesProps {
  /** Ordered citation content; index 0 is reference [1]. */
  refs: ReactNode[];
}

/** The numbered "References" list a `<Ref>` marker jumps down to. */
export function References({ refs }: ReferencesProps) {
  return (
    <ol className="references">
      {refs.map((content, i) => {
        const n = i + 1;
        return (
          <li key={n} id={`cite_note-${n}`}>
            <a href={`#cite_ref-${n}`} aria-label={`Jump up to reference ${n}`}>
              ^
            </a>{" "}
            {content}
          </li>
        );
      })}
    </ol>
  );
}
