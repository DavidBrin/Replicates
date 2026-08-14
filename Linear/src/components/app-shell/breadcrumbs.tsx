"use client";

/**
 * The header's breadcrumb: `Business › Issues`.
 *
 * A `<nav>` wrapping an ordered list, because that is what it is — the
 * separators are decorative and marked `aria-hidden`, so a screen reader hears
 * "Business, Issues" rather than "Business chevron Issues". The last crumb is
 * the current page and carries `aria-current`; it is deliberately *not* a link,
 * since a link to where you already are is a dead control that still takes a
 * tab stop.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ChevronRightIcon } from "@/components/ui/icons";

export interface Crumb {
  readonly label: string;
  readonly href?: string;
  readonly icon?: ReactNode;
}

export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRightIcon
                  size={12}
                  className="shrink-0 text-quaternary"
                  aria-hidden="true"
                />
              ) : null}
              {crumb.icon}
              {crumb.href && !last ? (
                <a
                  href={crumb.href}
                  className="truncate text-small text-tertiary hover:text-primary"
                >
                  {crumb.label}
                </a>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "truncate text-small",
                    last
                      ? "text-primary [font-weight:var(--weight-medium)]"
                      : "text-tertiary",
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
