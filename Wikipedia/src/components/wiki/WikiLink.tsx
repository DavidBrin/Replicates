import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { articleExists } from "@/lib/registry";

export interface WikiLinkProps {
  /** Article slug to link to, e.g. "Linear" for /wiki/Linear. */
  to: string;
  children: ReactNode;
  className?: string;
}

/**
 * An internal link to another article. Renders red ("new") with a
 * "page does not exist" tooltip when the target isn't in the registry —
 * Wikipedia's own idiom for a link to a page that hasn't been written yet.
 */
export function WikiLink({ to, children, className }: WikiLinkProps) {
  const exists = articleExists(to);

  return (
    <Link
      href={`/wiki/${encodeURIComponent(to)}`}
      className={clsx(!exists && "new", className)}
      title={exists ? undefined : "page does not exist"}
    >
      {children}
    </Link>
  );
}
