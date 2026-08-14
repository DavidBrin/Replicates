"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

/**
 * The positioned overlay primitive.
 *
 * Everything that floats in this app sits on top of this: the property picker,
 * the display-options panel, the context menu, the workspace switcher. It is
 * hand-rolled rather than pulled from Radix because it needs exactly three
 * behaviours — anchor, trap, escape — and a floating-UI dependency is ~15 kB to
 * do arithmetic that fits in `positionFor()` below.
 *
 * ## Non-modal, but focus-trapping
 *
 * Linear's pickers are **not** modal dialogs: the page behind stays visible and
 * live, nothing is inert, and there is no scrim. But focus does move into them
 * and `Tab` does stay inside, because the alternative — tabbing out of an open
 * picker into the list behind it — leaves an orphaned popover floating over a
 * page you are now navigating. So this traps focus without claiming
 * `aria-modal`, which would lie to a screen reader about the rest of the page.
 *
 * ## The Escape ladder
 *
 * `Escape` closes exactly one layer, and it is handled on the *content* rather
 * than on `document`, so a popover nested inside another closes the inner one
 * only. `stopPropagation` on the handled event is what enforces that; without
 * it a single keypress collapses the whole stack, which is the bug every
 * hand-rolled overlay has the first time.
 *
 * ## Positioning
 *
 * Measured from the anchor with `getBoundingClientRect()` in a layout effect,
 * then flipped and clamped inside the viewport. Fixed positioning, so the
 * coordinates are viewport-relative and no ancestor's `transform` or
 * `overflow` can move or clip the panel — a popover clipped by the scroll
 * container it was opened from is the other bug every hand-rolled overlay has.
 */

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element to position against — usually the trigger button. */
  anchor: RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  /** Gap between anchor and panel, in pixels. 4 is Linear's menu offset. */
  offset?: number;
  /** Match the panel's width to the anchor's — right for a full-width trigger. */
  matchAnchorWidth?: boolean;
  /** Focused on open. Defaults to the first focusable descendant. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Return focus to the anchor on close. Off only when the anchor is unmounting. */
  returnFocus?: boolean;
  /** Accessible name for the panel itself, when it needs one. */
  "aria-label"?: string;
  role?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Position {
  top: number;
  left: number;
}

/** `subscribe` for a store that never changes. Module-scoped so it is stable. */
const neverChanges = (): (() => void) => () => {};

/**
 * False on the server and during hydration, true from the first client render
 * after it.
 *
 * `createPortal` needs `document.body`, which does not exist during SSR. The
 * obvious `useState(false)` + `useEffect(() => setState(true))` does the same
 * job and is what the React docs used to show, but it is a setState inside an
 * effect — a cascading render on every mount of every portalling component.
 * `useSyncExternalStore` expresses the same thing as what it actually is: a
 * value that differs between the server snapshot and the client one.
 *
 * Exported because the three components that portal — popover, tooltip and the
 * toast viewport — all need it, and three copies would be three places to fix.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}

function positionFor(
  anchor: DOMRect,
  panel: DOMRect,
  placement: PopoverPlacement,
  offset: number,
  viewport: { width: number; height: number },
): Position {
  const wantsTop = placement.startsWith("top");
  const wantsEnd = placement.endsWith("end");
  const margin = 8;

  const below = anchor.bottom + offset;
  const above = anchor.top - panel.height - offset;

  // Flip only when the preferred side genuinely does not fit *and* the other
  // side does. Flipping on the first pixel of overflow makes a popover near the
  // fold jitter between sides as the page scrolls.
  let top = wantsTop ? above : below;
  if (!wantsTop && below + panel.height > viewport.height - margin && above >= margin) {
    top = above;
  } else if (wantsTop && above < margin && below + panel.height <= viewport.height - margin) {
    top = below;
  }

  let left = wantsEnd ? anchor.right - panel.width : anchor.left;
  left = Math.min(left, viewport.width - panel.width - margin);
  left = Math.max(margin, left);
  top = Math.max(margin, Math.min(top, viewport.height - panel.height - margin));

  return { top, left };
}

export function Popover({
  open,
  onOpenChange,
  anchor,
  placement = "bottom-start",
  offset = 4,
  matchAnchorWidth = false,
  initialFocus,
  returnFocus = true,
  role,
  className,
  style,
  children,
  ...aria
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const mounted = useIsClient();

  /**
   * Measure, then write straight to the node — and subscribe to whatever could
   * invalidate the measurement.
   *
   * One effect, holding the whole positioning concern. Two reasons it is shaped
   * this way:
   *
   * **The position never becomes React state.** It is a *layout* fact, and
   * routing it through state means a render, a commit and a second layout pass
   * on every scroll frame the popover is open, to tell the DOM something it
   * already knows. Writing `style.top` directly also fixes first paint: the
   * panel mounts `visibility: hidden` and is revealed in the same layout pass
   * that positions it, so there is no frame in which it is drawn in the corner.
   *
   * **A layout effect, not an ordinary one.** An ordinary effect runs after
   * paint, and the eye catches the jump.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const reposition = (): void => {
      const anchorEl = anchor.current;
      const panel = panelRef.current;
      if (!anchorEl || !panel) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const next = positionFor(
        anchorRect,
        panel.getBoundingClientRect(),
        placement,
        offset,
        { width: window.innerWidth, height: window.innerHeight },
      );
      panel.style.top = `${next.top}px`;
      panel.style.left = `${next.left}px`;
      if (matchAnchorWidth) panel.style.width = `${anchorRect.width}px`;
      panel.style.visibility = "visible";
    };

    reposition();
    // `capture` on scroll: a popover anchored inside a scrolling pane has to
    // follow that pane, and scroll does not bubble.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, anchor, placement, offset, matchAnchorWidth]);

  /* --- focus ---------------------------------------------------------- */

  useEffect(() => {
    if (!open) return;
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const target =
      initialFocus?.current ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus({ preventScroll: true });

    return () => {
      if (!returnFocus) return;
      const previous = restoreTo.current;
      // Only restore if focus is still inside the closing panel. If the user
      // clicked something else on the page, yanking focus back to the trigger
      // is worse than leaving it where they put it.
      if (previous && document.body.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open, initialFocus, returnFocus]);

  /* --- dismissal ------------------------------------------------------ */

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // Clicks on the trigger are the trigger's business — it will toggle. If
      // this closed as well, the two would fight and the popover would never
      // open on a second click.
      if (anchor.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onOpenChange, anchor]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      // One layer per press. See the Escape-ladder note above.
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      {...aria}
      data-popover=""
      data-placement={placement}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed outline-none",
        "rounded-[var(--radius-lg)] border border-default",
        // Elevation in dark Linear is a background step plus a hairline; the
        // shadow is there for the light theme, where the panel and the page
        // are both white and only the shadow separates them.
        "bg-[var(--bg-overlay)] shadow-[var(--shadow-medium)]",
        className,
      )}
      style={{
        top: 0,
        left: 0,
        zIndex: "var(--z-dropdown)",
        // Hidden until measured, rather than not rendered: the panel has to be
        // in the DOM to have a size worth measuring. `reposition` clears this
        // in the same layout pass.
        visibility: "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
