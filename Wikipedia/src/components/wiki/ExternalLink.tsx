import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";

export interface ExternalLinkProps {
  /** The real URL, or null when the project it points to isn't deployed yet. */
  href: string | null;
  children: ReactNode;
  className?: string;
}

/**
 * A link to a live site, with Wikipedia's small external-link arrow. When
 * `href` is null (no project in this repo is deployed yet — DECISIONS D3),
 * it instead renders as a red stub pointing at a guaranteed-missing wiki
 * route, so it lands on the same "page does not exist" screen as any other
 * red link rather than inventing a separate "coming soon" idiom.
 */
export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  if (href === null) {
    return (
      <Link
        href="/wiki/Website_not_yet_deployed"
        className={clsx("new external-link", className)}
        title="the project is not deployed yet"
      >
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx("external-link", className)}
    >
      {children}
    </a>
  );
}
