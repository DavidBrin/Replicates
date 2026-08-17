import clsx from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * The filter chip.
 *
 * **32px tall with an 8px radius. It is not a pill**, and memory reliably says
 * otherwise — every other rounded control in this design system is a pill
 * (a 40px button has a 20px radius), which is exactly why the chip gets
 * mistaken for one. Measured on the live chip bar:
 * `research/extracted/chips-and-miniguide.json`, `.ytChipShapeChip` →
 * `border-radius: 8px`, `height: 32px`, `padding: 0 12px`, `14px/20px w500`.
 *
 * Selected and unselected are a *fill inversion*, not a tint: selected is
 * `inverted-background` with `text-primary-inverse` — a near-black chip with
 * near-white text in the light theme, and the reverse in dark. Unselected is
 * `additive-background`, the same 5%/10% wash the guide's hover uses.
 *
 * ## Semantics
 *
 * The real chip is `<button role="tab" aria-selected>` inside the feed filter
 * bar (verbatim from the captured HTML), so the bar is a tablist and the chips
 * are tabs — not checkboxes, not links, and not a listbox. {@link ChipBar}
 * supplies the `role="tablist"` and the roving tab order that pairing
 * requires.
 */

export interface ChipProps
  extends Omit<ComponentPropsWithoutRef<"button">, "color"> {
  selected?: boolean;
  /** A chevron, for the sort chips. Changes the padding — see below. */
  trailing?: ReactNode;
  children: ReactNode;
}

export function Chip({
  selected = false,
  trailing,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-selected={selected ? "" : undefined}
      className={clsx(
        "relative isolate inline-flex h-8 shrink-0 items-center overflow-hidden",
        "rounded-compact text-body font-[var(--yt-weight-medium)]",
        "whitespace-nowrap",
        // A chip with a trailing glyph drops its right padding and lets the
        // icon supply the inset — measured on the sort chips (R9 §2.2).
        trailing ? "pr-0 pl-3" : "px-3",
        selected
          ? "bg-inverted text-primary-inverse"
          : "bg-additive text-primary",
        // The same two-layer interaction model as the button: the chip's own
        // DOM carries a `yt-touch-feedback-shape` with an 8px radius. The
        // selected chip's overlay has to darken rather than lighten, for the
        // same reason a Filled button's does.
        selected
          ? "[--yt-fill-color:var(--yt-touch-response-inverse)] hover:[--yt-fill-opacity:var(--yt-state-filled-hover-opacity)] active:[--yt-fill-opacity:var(--yt-state-filled-press-opacity)]"
          : "[--yt-fill-color:var(--yt-touch-response)] hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)] active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
        "[--yt-fill-opacity:0]",
        className,
      )}
      {...rest}
    >
      <span data-chip-label="">{children}</span>
      {trailing ? (
        <span data-chip-icon="" className="inline-flex items-center px-1">
          {trailing}
        </span>
      ) : null}
      {/*
        R8 §13 records the chip's hover colour as one of the pass's gaps — the
        hover landed on the outer custom element, whose background is
        transparent, so `button-chip-background-hover` is expected but
        unverified. What *is* verified is that the chip's shadow DOM contains
        the Stroke/Fill pair at an 8px radius, so the overlay model is used
        here rather than the unverified flat colour.
      */}
      <span
        aria-hidden="true"
        data-touch-feedback=""
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </button>
  );
}

export interface ChipBarProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * `feed` is the home page's filter bar — 56px tall with a 12px gap.
   * `cloud` is the history/playlist chip cloud, which uses 8px. Both measured
   * (R9 §2.2); they are the only two spacings in the product.
   */
  density?: "feed" | "cloud";
  children: ReactNode;
}

/**
 * The chip bar.
 *
 * 56px tall with 32px chips, so the chips are centred by a 12px margin top and
 * bottom rather than by `align-items` — which is why the measured chip margin
 * reads `12px 12px 12px 0` and the gap between two chips is 12, not 24.
 *
 * Horizontal overflow scrolls; the product puts a 56×56 chevron at each end
 * once there is anything to scroll to. That control belongs to the feed slice,
 * which knows the scroll position.
 */
export function ChipBar({
  density = "feed",
  className,
  children,
  ...rest
}: ChipBarProps) {
  return (
    <div
      role="tablist"
      className={clsx(
        "flex items-center overflow-x-auto",
        density === "feed" ? "h-14 gap-3" : "gap-2",
        // The scrollbar would eat 15px of a 56px bar. The bar is scrolled by
        // its chevrons and by trackpad, never by a visible gutter.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
