"use client";

/**
 * The two 44px rules at the top of the content pane.
 *
 * `mainHeaderHeight` and `subHeaderHeight` are both 44 in Linear's own source,
 * and the running app draws them as two rows: the breadcrumb above, the view
 * tabs and view controls below (`research/01-visual-design.md` §6.1, and the
 * captured issue-list screenshot). The rule between them is **0.5px on
 * retina** — `border-b` at 1px is item 13 on the list of things clones get
 * wrong, which is why the hairline is drawn with a `box-shadow` at a fractional
 * offset rather than a border.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Breadcrumbs, type Crumb } from "@/components/app-shell/breadcrumbs";

/**
 * A hairline that can be thinner than a pixel.
 *
 * `border-bottom: 0.5px` is rounded up to 1px by every engine; an inset shadow
 * is not, so this renders at the measured half-pixel on a retina display and
 * degrades to a solid 1px elsewhere.
 */
const HAIRLINE = "[box-shadow:inset_0_-0.5px_0_0_var(--border-subtle)]";

export interface AppHeaderProps {
  readonly crumbs: readonly Crumb[];
  /** Right-aligned: a star, an overflow menu, a pager. */
  readonly actions?: ReactNode;
}

export function AppHeader({ crumbs, actions }: AppHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-[var(--header-height)] shrink-0 items-center gap-2 px-2",
        HAIRLINE,
      )}
    >
      <Breadcrumbs crumbs={crumbs} />
      <span className="flex-1" />
      {actions}
    </header>
  );
}

export interface SubHeaderProps {
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

/** The second rule: view tabs on the left, view controls on the right. */
export function SubHeader({ children, actions }: SubHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-[var(--header-height)] shrink-0 items-center gap-2 px-2",
        HAIRLINE,
      )}
    >
      {children}
      <span className="flex-1" />
      {actions}
    </div>
  );
}
