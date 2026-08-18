import type { ReactNode } from "react";

export function P({ children }: { children: ReactNode }) {
  /* Paragraph spacing (8px top / 16px bottom) is set in globals.css under
     `.mw-body-content p`, so nested paragraphs inside an infobox cell or a
     hatnote don't inherit an article-body margin they shouldn't have. */
  return <p>{children}</p>;
}

/** Bold lead term, e.g. the subject's name in an article's first sentence. */
export function B({ children }: { children: ReactNode }) {
  return <b className="font-bold">{children}</b>;
}
