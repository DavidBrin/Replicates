"use client";

/**
 * Anchored popover — the substrate for every menu, picker and dropdown.
 *
 * Deliberately dependency-free: a floating-UI-class library would be the right
 * call for a product with arbitrary placement needs, but everything here
 * anchors below-or-above a trigger, which is ~60 lines of measurement.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import { useMounted } from "@/lib/utils/use-mounted";

export type PopoverAlign = "start" | "center" | "end";
export type PopoverSide = "bottom" | "top";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover is positioned against. */
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: PopoverAlign;
  side?: PopoverSide;
  /** Gap between the anchor and the panel, in px. */
  offset?: number;
  className?: string;
  /** Width in px, or "anchor" to match the trigger's width. */
  width?: number | "anchor";
}

const VIEWPORT_MARGIN = 8;

export function Popover({
  open,
  onOpenChange,
  anchor,
  children,
  align = "start",
  side = "bottom",
  offset = 4,
  className,
  width,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width?: number }>();
  // Portals need a DOM target, which does not exist during the server pass.
  const mounted = useMounted();

  // Positioning is defined inside the effect rather than hoisted into a
  // `useCallback`. It reads two refs and four props, which the React Compiler
  // cannot prove stable, so a hoisted memo would be discarded anyway — and a
  // callback that changes identity every render would re-arm the scroll and
  // resize listeners on each pass.
  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const trigger = anchor.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const rect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = width === "anchor" ? rect.width : panelRect.width;

      let left = rect.left;
      if (align === "center") left = rect.left + rect.width / 2 - panelWidth / 2;
      if (align === "end") left = rect.right - panelWidth;

      let top = side === "bottom" ? rect.bottom + offset : rect.top - panelRect.height - offset;

      // Flip rather than overflow when there is no room on the preferred side.
      if (side === "bottom" && top + panelRect.height > window.innerHeight - VIEWPORT_MARGIN) {
        const flipped = rect.top - panelRect.height - offset;
        if (flipped > VIEWPORT_MARGIN) top = flipped;
      }
      if (side === "top" && top < VIEWPORT_MARGIN) {
        top = rect.bottom + offset;
      }

      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, window.innerWidth - panelWidth - VIEWPORT_MARGIN),
      );
      top = Math.max(VIEWPORT_MARGIN, top);

      setPosition({ top, left, width: width === "anchor" ? rect.width : undefined });
    };

    reposition();
    window.addEventListener("resize", reposition);
    // Capture phase, so the popover follows a trigger inside any scroll
    // container rather than only the window.
    window.addEventListener("scroll", reposition, true);

    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [align, anchor, offset, open, side, width]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    // `true` so the popover closes before an underlying control reacts.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onOpenChange, open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: position?.width ?? (typeof width === "number" ? width : undefined),
        background: "var(--bac-ele)",
        boxShadow: "var(--shadow-menu)",
        // Hidden until measured, so it never flashes at the wrong place.
        visibility: position ? "visible" : "hidden",
      }}
      className={cn(
        "fixed z-50 overflow-hidden rounded-md",
        "animate-[popover-in_120ms_var(--ease-notion)]",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
