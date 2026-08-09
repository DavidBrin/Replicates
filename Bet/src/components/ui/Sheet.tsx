"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDialogBehavior } from "./dialog-behavior";

export type SheetSide = "left" | "right" | "bottom";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: SheetSide;
  title?: string;
  children: ReactNode;
  className?: string;
}

const sideClasses: Record<SheetSide, string> = {
  left: "inset-y-0 left-0 h-full w-full max-w-sm border-r",
  right: "inset-y-0 right-0 h-full w-full max-w-sm border-l",
  bottom: "inset-x-0 bottom-0 w-full max-h-[85vh] rounded-t-(--radius-card) border-t",
};

/**
 * A side/bottom-anchored panel sharing `Modal`'s dismissal behavior (focus
 * trap, Escape, backdrop click, scroll lock) — used for mobile-first
 * overlays like the order ticket or filters. Client component.
 */
export function Sheet({ open, onClose, side = "right", title, children, className }: SheetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialogBehavior(open, onClose, containerRef);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-(--surface-0)/70" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "absolute flex flex-col gap-4 border-(--border) bg-(--surface-2) p-6 shadow-2xl",
          sideClasses[side],
          className,
        )}
      >
        <div className="flex items-center justify-between">
          {title ? (
            <h2 id={titleId} className="text-base font-semibold text-(--text-1)">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-(--radius-input) p-1 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
