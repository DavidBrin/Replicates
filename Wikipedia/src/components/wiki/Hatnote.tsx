import type { ReactNode } from "react";

/** Italic note above the lead, e.g. "This article is about X. For Y, see Z." */
export function Hatnote({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="hatnote mb-[0.5em] pl-[1.6em] italic">
      {children}
    </div>
  );
}
