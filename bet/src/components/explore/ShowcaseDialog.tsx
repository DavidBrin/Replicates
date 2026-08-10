"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogBehavior } from "@/components/ui/dialog-behavior";
import { cn } from "@/lib/cn";

export interface ShowcaseDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * A focus-trapping, Escape-closing dialog — deliberately NOT
 * `@/components/ui/Modal`, even though it shares that component's dismissal
 * behavior via the same `useDialogBehavior` hook. `Modal` renders through a
 * `createPortal(..., document.body)`, which escapes the `[data-surface=
 * "explore"]` div entirely: found by looking at this in the browser — the
 * "Go to your groups" button rendered in Bet's indigo `--accent`, not
 * Explore's mint, because CSS custom properties only inherit down the DOM
 * tree, and a body-level portal isn't a descendant of the scoped div no
 * matter where it's defined in JSX. This component uses `position: fixed`
 * instead of a portal — fixed positioning escapes ancestor layout/overflow
 * the same way a portal would for placement purposes, but (unlike a portal)
 * the element stays a real DOM descendant of wherever it's rendered, so it
 * still inherits the Explore token scope correctly.
 */
export function ShowcaseDialog({ open, onClose, title, children, className }: ShowcaseDialogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialogBehavior(open, onClose, containerRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-(--surface-0)/70" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 w-full max-w-md rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-6 shadow-2xl",
          className,
        )}
      >
        <h2 id={titleId} className="mb-4 pr-8 text-base font-semibold text-(--text-1)">
          {title}
        </h2>
        {children}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-(--radius-input) p-1 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
