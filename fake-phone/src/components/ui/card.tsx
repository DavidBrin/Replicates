"use client";

/**
 * A settings group.
 *
 * Six configuration groups otherwise become six piles of near-identical
 * markup, and the moment that happens they start drifting apart visually. One
 * card, one rhythm.
 *
 * The heading is small, wide-tracked and secondary on purpose: on this surface
 * the loudest thing must be the "start a call" action, not the furniture around
 * it (research/competitive-teardown.md §4 Q3 — "no bright, branded splash").
 */

import clsx from "clsx";
import type { ReactNode } from "react";

export interface CardProps {
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

export function Card({ title, children, className, testId }: CardProps) {
  return (
    <section
      data-testid={testId}
      className={clsx(
        "rounded-2xl border border-hairline bg-surface-1 px-4 py-4",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-text-secondary">
          {title}
        </h2>
      ) : null}
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}
