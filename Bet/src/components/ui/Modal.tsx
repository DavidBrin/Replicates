"use client";

import { useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDialogBehavior } from "./dialog-behavior";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** Focus this element first instead of the first focusable descendant. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A centered, focus-trapping modal dialog (SPEC §7.4, G9). Renders via a
 * portal into `document.body`, closes on Escape or a backdrop click, locks
 * body scroll while open, and restores focus to the trigger on close.
 * Client component — it owns real DOM/focus side effects.
 */
export function Modal({ open, onClose, title, children, className, initialFocusRef }: ModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialogBehavior(open, onClose, containerRef, initialFocusRef);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-(--surface-0)/70"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative z-10 w-full max-w-md rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-6 shadow-2xl",
          className,
        )}
      >
        {title ? (
          <h2 id={titleId} className="mb-4 pr-8 text-base font-semibold text-(--text-1)">
            {title}
          </h2>
        ) : null}
        {children}
        {/* Rendered last in DOM order (though positioned top-right via CSS)
            so the tab order visits the dialog's own content before the
            close affordance, matching typical modal UX. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-(--radius-input) p-1 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
