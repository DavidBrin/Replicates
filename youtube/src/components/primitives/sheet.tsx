"use client";

import clsx from "clsx";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/**
 * The contextual sheet.
 *
 * **This is not a modal dialog, and the difference is the whole component.**
 * Save-to-playlist — the surface this is measured from — is
 * `yt-sheet-view-model.ytSheetViewModelContextual` inside a
 * `tp-yt-iron-dropdown`: it opens **anchored to the button that summoned it**,
 * above or below as space allows, with **no scrim**, and its rows are toggles
 * that **write immediately**. The old checkbox list with Cancel and Save in
 * the footer is gone (`research/09-youtube-signedin-surfaces.md` §9.3, §14).
 *
 * That has three consequences a modal implementation gets wrong:
 *
 * 1. **No `aria-modal`, and no focus trap.** The page behind stays interactive
 *    and stays in the accessibility tree, because it genuinely is still
 *    usable. Trapping focus in a surface with no scrim tells assistive
 *    technology something false about the page, and §8.1 of
 *    `research/07-captions-and-a11y.md` scopes the trap requirement to modal
 *    surfaces for exactly this reason. What *is* kept from that pattern is the
 *    half that applies to both: focus moves in on open, Escape closes, and
 *    focus returns to the trigger.
 * 2. **No footer confirm.** The footer holds "New playlist" — an action, not a
 *    commit. Modelling the rows as a form with a submit would change what the
 *    user is doing.
 * 3. **The toggle is a bookmark glyph that fills when saved, not a checkbox.**
 *    It is still `aria-checked` on a `menuitemcheckbox`-shaped control, so the
 *    semantics survive the visual.
 *
 * ## Geometry (all measured)
 *
 * 400px wide, 12px radius, `0 4px 32px rgba(0,0,0,0.1)`. A 48px header with an
 * 18px/26px weight-700 title at a 16px inset and no divider rule. A scrolling
 * content region. A 65px footer holding a 376×40 tonal button — 400 less two
 * 12px insets. Rows are a flat 54px pitch.
 */

export interface SheetTriggerProps {
  ref: (node: HTMLButtonElement | null) => void;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
}

export interface SheetProps {
  /** Renders the control the sheet is anchored to. See {@link SheetTriggerProps}. */
  trigger: (props: SheetTriggerProps) => ReactNode;
  title: string;
  /** The action row. Not a confirm — the sheet has already written. */
  footer?: ReactNode;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}

export function Sheet({
  trigger,
  title,
  footer,
  align = "start",
  className,
  children,
}: SheetProps) {
  const sheetId = useId();
  const titleId = `${sheetId}-title`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const close = (restoreFocus = true): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  /**
   * Move focus in.
   *
   * To the first focusable row if there is one, and to the sheet itself
   * otherwise — never left stranded on `document.body`, which is what makes a
   * keyboard user's next Tab jump to the top of the page instead of into the
   * thing that just opened.
   */
  useEffect(() => {
    if (!open) return;
    const node = sheetRef.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>(
      'button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
    );
    (first ?? node).focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {trigger({
        ref: (node) => {
          triggerRef.current = node;
        },
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        "aria-controls": open ? sheetId : undefined,
        onClick: () => (open ? close(false) : setOpen(true)),
      })}
      {open ? (
        <div
          id={sheetId}
          ref={sheetRef}
          role="dialog"
          aria-labelledby={titleId}
          // Deliberately no `aria-modal`: see the note above. The page behind
          // this sheet is genuinely still operable.
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={clsx(
            "absolute top-full z-[var(--yt-z-popup)] mt-2",
            align === "end" ? "right-0" : "left-0",
            "flex w-[var(--yt-sheet-width)] flex-col",
            "rounded-cozy bg-menu",
            "shadow-[var(--yt-sheet-shadow)] outline-none",
            className,
          )}
        >
          <div className="flex h-12 shrink-0 items-center px-4">
            <h2
              id={titleId}
              className="text-sheet font-[var(--yt-weight-bold)] text-primary"
            >
              {title}
            </h2>
          </div>
          {/* The content region is the only part that scrolls; the header and
              footer are pinned, which is why the measured heights add up to
              less than the sheet's own. */}
          <div className="max-h-[220px] flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="shrink-0 px-3 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface SheetListItemProps {
  title: string;
  /** The second line — "Private", "Public". 12px/18px secondary. */
  subtitle?: string;
  /** A 56×36 lead image; the playlist stack, where one exists. */
  leading?: ReactNode;
  checked: boolean;
  onToggle: (next: boolean) => void;
  /**
   * The glyph, filled when checked.
   *
   * Passed in rather than drawn here because the measured control is a
   * *bookmark* that fills, and a different sheet would use a different mark —
   * the shape of the row is what this component owns.
   */
  icon: ReactNode;
}

/**
 * One row: a flat 54px, `padding: 6px 16px`, lead image 56×42 with a 12px gap,
 * title 14/20 primary, subtitle 12/18 secondary, and the toggle glyph 24px in
 * from the right.
 *
 * `menuitemcheckbox` rather than `checkbox`: the row is not inside a form and
 * has no label element, and the sheet's content region is the closest thing it
 * has to a list. `aria-checked` is what carries the state either way.
 */
export function SheetListItem({
  title,
  subtitle,
  leading,
  checked,
  onToggle,
  icon,
}: SheetListItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onToggle(!checked)}
      className={clsx(
        "relative flex h-[54px] w-full items-center px-4 py-1.5 text-left",
        "[--yt-fill-color:var(--yt-touch-response)] [--yt-fill-opacity:0]",
        "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
        "active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
      )}
    >
      {leading ? (
        <span className="mr-3 inline-flex h-[42px] w-14 shrink-0 items-center">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-primary">
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-small text-secondary">
            {subtitle}
          </span>
        ) : null}
      </span>
      <span className="ml-4 inline-flex size-6 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </button>
  );
}
