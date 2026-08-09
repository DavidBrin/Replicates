import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(el: HTMLElement): boolean {
  // jsdom never computes layout, so `offsetParent`/`getClientRects()` are
  // useless signals there — this checks the one thing jsdom *does* track
  // faithfully: inline and stylesheet-derived `display`/`visibility`.
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Shared behavior for `Modal` and `Sheet` (both dismissible overlay
 * dialogs): traps focus inside `containerRef` while `open`, closes on
 * Escape, locks body scroll, and restores focus to whatever triggered the
 * dialog once it closes. Returns nothing — callers read/write DOM directly
 * through `containerRef`, this hook only wires up the side effects.
 */
export function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const triggerRef = useRef<HTMLElement | null>(null);

  // Body scroll lock, for the lifetime of `open`.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Save the trigger, focus the dialog, restore focus on close.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const toFocus = initialFocusRef?.current ?? (container ? focusableElements(container)[0] : null);
    toFocus?.focus();

    return () => {
      triggerRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape to close, Tab to cycle within the dialog.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);

      if (e.shiftKey) {
        if (activeIndex <= 0) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeIndex === -1 || activeIndex === focusable.length - 1) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}
