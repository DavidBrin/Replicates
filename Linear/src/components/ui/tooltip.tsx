"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { Shortcut } from "@/components/ui/kbd";
import { useIsClient } from "@/components/ui/popover";

/**
 * The tooltip.
 *
 * In a keyboard-first product a tooltip is mostly a **shortcut teacher** —
 * Linear's read "Change status  S", and that trailing cap is the reason the
 * user ever discovers the keymap, since Linear publishes no shortcuts page at
 * all (`research/04-interaction.md` §1). Hence {@link TooltipProps.shortcut},
 * which renders a {@link Shortcut} chip inside the bubble.
 *
 * ## Delay is asymmetric, on purpose
 *
 * 500ms to open, 0 to close. A tooltip that appears instantly fires on every
 * pointer that crosses a toolbar; one that lingers on the way out follows the
 * cursor around like a smear. The research lane's phrasing for the whole motion
 * system applies exactly here: *arrival is information the user asked for;
 * departure is politeness.*
 *
 * A **group delay** makes the second tooltip in a toolbar open immediately —
 * once you are reading tooltips, waiting half a second per button is the wrong
 * trade. The window is module-scoped rather than context-scoped so it spans
 * toolbars that do not share a provider.
 *
 * ## Why the trigger is wrapped in `display: contents`
 *
 * The alternative is `cloneElement` with a merged ref, which fails on any
 * child that is not a DOM element or does not forward its ref — including a
 * plain function component, which is most of them. A wrapper with
 * `display: contents` generates no box of its own, so flex and grid parents lay
 * the real trigger out exactly as they would have; pointer and focus events
 * bubble to it either way. The bubble is positioned from the wrapper's first
 * element child, which *does* have a box.
 */

/** Open instantly if another tooltip closed within this window. */
const GROUP_WINDOW_MS = 300;
const OPEN_DELAY_MS = 500;

let lastClosedAt = 0;

export interface TooltipProps {
  content: ReactNode;
  /**
   * A shortcut expression for {@link Shortcut} — `"S"`, `"mod+z"`, `"G then I"`.
   * Rendered as caps at the end of the bubble.
   */
  shortcut?: string;
  side?: "top" | "bottom";
  /** Skip the delay. For a control whose label is genuinely ambiguous. */
  instant?: boolean;
  children: ReactElement;
  className?: string;
}

export function Tooltip({
  content,
  shortcut,
  side = "top",
  instant = false,
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const mounted = useIsClient();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The bubble is measured here rather than in an effect after it opens: the
  // *trigger* is what gets measured, and it exists long before the bubble does.
  // Measuring on open would mean a second render for a value that was already
  // knowable, and a frame in which the bubble is drawn at the wrong place.
  const show = useCallback(() => {
    const delay =
      instant || Date.now() - lastClosedAt < GROUP_WINDOW_MS ? 0 : OPEN_DELAY_MS;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trigger = wrapperRef.current?.firstElementChild;
      if (trigger instanceof HTMLElement) {
        const box = trigger.getBoundingClientRect();
        setRect({
          top: side === "top" ? box.top - 6 : box.bottom + 6,
          left: box.left + box.width / 2,
        });
      }
      setOpen(true);
    }, delay);
  }, [instant, side]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) lastClosedAt = Date.now();
    setOpen(false);
  }, [open]);

  // Escape dismisses. A tooltip that survives Escape while a menu closes
  // underneath it is left hanging over nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  return (
    <>
      <span
        ref={wrapperRef}
        className="contents"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Pressing the control means the user knows what it does; keeping the
        // bubble up over the thing they just clicked is pure obstruction.
        onPointerDown={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>

      {mounted && open && rect
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className={cn(
                "pointer-events-none fixed flex items-center gap-1.5",
                "rounded-[var(--radius-md)] border border-default",
                "bg-[var(--bg-overlay)] px-2 py-1",
                "text-mini text-primary shadow-[var(--shadow-low)]",
                "whitespace-nowrap",
                className,
              )}
              style={{
                top: rect.top,
                left: rect.left,
                transform: `translate(-50%, ${side === "top" ? "-100%" : "0"})`,
                zIndex: "var(--z-toast)",
              }}
            >
              {content}
              {shortcut ? <Shortcut keys={shortcut} /> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
