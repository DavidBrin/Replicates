"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithRef,
  type ChangeEvent,
} from "react";

import { cn } from "@/lib/cn";

/**
 * The multi-line input.
 *
 * Used for an issue description, a comment, and a project update. All three are
 * prose fields whose measured type is 15px at line-height 1.6 — noticeably
 * larger and looser than the 13px chrome around them, because they are the only
 * text on the screen anybody *reads* rather than scans
 * (`research/01-visual-design.md` §2.4).
 *
 * ## Auto-resize
 *
 * On by default. A comment box with a scrollbar in it is a comment box that
 * hides what you just typed, and the alternative — a fixed tall field — wastes
 * a third of the activity feed on an empty form.
 *
 * The implementation resets `height` to `auto` before reading `scrollHeight`.
 * Skipping that reset is the classic bug: `scrollHeight` never reports less
 * than the current height, so the field grows and never shrinks. `overflow-y`
 * has to be pinned to `hidden` below the cap for the same reason — a scrollbar
 * appearing mid-measurement changes the value being measured.
 */

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  /** Grow to fit the content, up to {@link TextareaProps.maxRows}. */
  autoResize?: boolean;
  /** Cap the auto-resize. Past this the field scrolls. */
  maxRows?: number;
  /** `prose` is the 15px reading size; `control` is the 13px chrome size. */
  variant?: "prose" | "control";
  invalid?: boolean;
}

export function Textarea({
  autoResize = true,
  maxRows = 16,
  variant = "prose",
  invalid = false,
  className,
  onChange,
  rows = 3,
  ref,
  ...rest
}: TextareaProps) {
  const internal = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(
    (element: HTMLTextAreaElement | null) => {
      if (!element || !autoResize) return;
      element.style.height = "auto";
      const lineHeight =
        Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
      const max = lineHeight * maxRows;
      const next = Math.min(element.scrollHeight, max);
      element.style.height = `${next}px`;
      element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden";
    },
    [autoResize, maxRows],
  );

  // Re-fit when the value changes from outside — a form reset, an optimistic
  // rollback, or a draft restored from storage all change the content without
  // firing `onChange`.
  useEffect(() => {
    fit(internal.current);
  }, [fit, rest.value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    fit(event.currentTarget);
    onChange?.(event);
  };

  return (
    <textarea
      ref={(node) => {
        internal.current = node;
        fit(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      rows={rows}
      aria-invalid={invalid || undefined}
      onChange={handleChange}
      className={cn(
        "w-full resize-none rounded-[var(--radius-lg)] border bg-transparent",
        "px-3 py-2 text-primary outline-none placeholder:text-quaternary",
        "[transition:border-color_var(--speed-quick)_var(--ease-out-quad)]",
        "focus:border-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "prose"
          ? "text-regular leading-[1.6]"
          : "text-small leading-normal",
        invalid ? "border-danger" : "border-default",
        className,
      )}
      {...rest}
    />
  );
}
