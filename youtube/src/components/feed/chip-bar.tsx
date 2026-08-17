"use client";

// Imported as well as re-exported: `export … from` forwards a name without
// binding it locally, and the component below reads both.
import { ALL_CHIP_ID, ALL_CHIP_LABEL, type FeedChip } from "./chips";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { ChevronIcon } from "@/components/icons";
import { Button, Chip, ChipBar } from "@/components/primitives";

/**
 * The feed filter bar — the strip of chips under the masthead on `/`.
 *
 * The chip *itself* is the `Chip` primitive and stays there: 32px tall with an
 * **8px radius, not a pill**, `padding: 0 12px`, 14px/20px weight 500, a fill
 * inversion between states (R9 §2.2 and
 * `research/extracted/chips-and-miniguide.json`). `ChipBar` supplies the
 * 56px box, the 12px gap and the `role="tablist"`.
 *
 * What is left — and what this file is — is everything the primitive said
 * belonged to the feed slice because it needs the scroll position: the
 * overflow arrows, the roving tab order, and the fact that the bar is pinned
 * under the masthead.
 *
 * ## Measured (`research/extracted/home-1920.json`, `chipBar`)
 *
 * | Part | Value |
 * | --- | --- |
 * | `ytd-feed-filter-chip-bar-renderer` | 1680 × **56** at x=240, y=56 |
 * | `#chips-wrapper` | `position: fixed`, `z-index: 2019` |
 * | `#scroll-container` | 1632 wide at x=**264**, `overflow: hidden` |
 * | chip `margin` | `12px 12px 12px 0` — the 12px gap, and the 12px that centres a 32px chip in a 56px bar |
 * | `#right-arrow-button` | **56 × 56** at x=1864, i.e. flush with the content's right edge |
 * | arrow labels | `Previous` / `Next` (R8 §7) |
 * | `#chips` (the scrolled track) | `transition: 0.15s cubic-bezier(0.05, 0, 0, 1)` |
 *
 * The x=264 is the 24px page inset (`--yt-page-inset`) inside a content column
 * that starts at 240 — so the first chip lines up with the first card, and the
 * arrows sit *outside* that inset, hard against the column edge.
 *
 * Two of those need translating rather than copying.
 *
 * **`position: fixed` becomes `position: sticky`.** The product pins the bar
 * with `fixed` plus a JS-maintained width, because a fixed element's width
 * cannot follow a container that the guide rail resizes. `sticky` expresses
 * the same result — the bar scrolls with the page until it meets the 56px
 * masthead and then stops — and keeps the width the content column already
 * gives it, which is the width the container query is measuring anyway. The
 * measured `z-index: 2019` is kept verbatim: it sits below the guide (2021)
 * and the mini guide (2028), so the rail overlaps the bar and not the reverse.
 *
 * **The bar is painted.** The capture reports its background as transparent,
 * which is true of an element that never has content behind it — the product's
 * grid begins below it. A pinned bar has forty cards sliding underneath, so it
 * takes `--yt-base-background`: the page's own colour, identical at rest and
 * opaque once the page has scrolled.
 *
 * ## The scroll track does move, and it is the one thing here that animates
 *
 * `globals.css` records that every sampled chrome element computes
 * `transition: all 0s` — but `#chips` is the exception, at
 * `0.15s cubic-bezier(0.05, 0, 0, 1)`, because it is a *scroll*, not a state
 * change. This uses the platform's `scrollBy({ behavior: "smooth" })` rather
 * than a transformed track, which is the same motion expressed by the
 * scroller, respects `prefers-reduced-motion` for free, and leaves the
 * trackpad and the keyboard driving the same box.
 *
 * ## Semantics: these are tabs, and that is measured
 *
 * The captured chip is `<button role="tab" aria-selected>` inside the filter
 * bar, so the bar is a tablist. APG's tab pattern then obliges two things a
 * plain row of buttons does not: **one tab stop for the whole set** (the
 * selected chip, everything else at `tabIndex -1`) and **arrow keys moving
 * between them**. Twenty-one chips that each take a tab stop is twenty-one
 * presses to reach the grid.
 *
 * Activation follows focus, which is the APG default for tabs and is what the
 * product does — the feed reloads as you arrow along the bar.
 */

/** The first chip, always present and selected by default (R8 §8.3). */
export { ALL_CHIP_ID } from "./chips";

/** Its label, verbatim from R8 §8.3's exact strings. */
export { ALL_CHIP_LABEL } from "./chips";

/** The tablist's accessible name. Ours — see where it is used. */
export const FILTER_BAR_LABEL = "Filter the feed";

/**
 * One chip.
 *
 * `videoIds` is the membership, supplied rather than derived: the chip bar has
 * no opinion about what a topic *is*, and the surface that loaded the feed is
 * the only thing that can say which cards a label covers. Absent means "every
 * card" — which is what makes {@link ALL_CHIP_ID} an ordinary chip rather than
 * a special case in the filter.
 */
export type { FeedChip } from "./chips";

export interface FeedChipBarProps {
  chips: readonly FeedChip[];
  selectedId: string;
  onSelect: (id: string) => void;
  /**
   * The `id` of the region these tabs filter.
   *
   * Required by the tab pattern: a `role="tab"` with no `aria-controls` and no
   * matching `role="tabpanel"` announces a selection state that points at
   * nothing. {@link feedTabId} builds the reciprocal `aria-labelledby`.
   */
  panelId: string;
  className?: string;
}

/**
 * The DOM id of one chip, so the panel can point back at the selected one.
 *
 * A shared function rather than two template literals in two files: the tab
 * and its panel have to agree on the string, and an `aria-labelledby` that
 * resolves to nothing is invisible until somebody runs a screen reader.
 */
export function feedTabId(panelId: string, chipId: string): string {
  return `${panelId}-chip-${chipId}`;
}

export function FeedChipBar({
  chips,
  selectedId,
  onSelect,
  panelId,
  className,
}: FeedChipBarProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  /**
   * The scroller, found by the role it declares rather than handed over.
   *
   * `ChipBar` is a frozen primitive whose props are
   * `ComponentPropsWithoutRef<"div">` — `ref` is not among them — so there is
   * no ref to take. Querying the `role="tablist"` it renders is stable
   * (the role is the primitive's whole reason for existing) and keeps the
   * measured 56px/12px density in the one place that owns it.
   */
  const scroller = useCallback(
    (): HTMLElement | null =>
      host.current?.querySelector<HTMLElement>('[role="tablist"]') ?? null,
    [],
  );

  const tabs = useCallback(
    (): HTMLElement[] =>
      Array.from(host.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
    [],
  );

  const sync = useCallback((): void => {
    const node = scroller();
    if (!node) return;
    // A one-pixel tolerance, for the same reason `Shelf` uses one: chip widths
    // are fractional (the measured `All` is 40.42px), so `scrollLeft` at the
    // far end lands a fraction short of `scrollWidth - clientWidth` and a
    // strict comparison leaves the arrow enabled with nowhere to go.
    setAtStart(node.scrollLeft <= 1);
    setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 1);
  }, [scroller]);

  /**
   * Re-measured when the bar's own box changes, not only when the window does.
   *
   * A `resize` listener alone is not enough, and the reason is the whole point
   * of this project's grid: collapsing the guide takes the content column from
   * 1680 to 1848 without the window moving a pixel, so no `resize` fires and
   * the bar would keep an arrow it no longer needs. `ResizeObserver` sees it,
   * because the bar is the thing that changed.
   *
   * `observe()` delivers a first callback with the element's current box, so
   * the initial measurement arrives down the same path as every later one and
   * nothing sets state synchronously in this effect body — which is both the
   * lint rule and the reason for it. The initial `true`/`true` means the
   * arrows start hidden and appear if there is somewhere to go, rather than
   * flashing on and then off.
   */
  useEffect(() => {
    const node = scroller();
    if (!node) return;

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(node);
    // The fallback for an environment with no `ResizeObserver` — which in
    // practice means a test renderer, where there is no layout to measure
    // either.
    window.addEventListener("resize", sync);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
    // `chips` re-runs the observation after a refetch changes the track's
    // width without the element being replaced.
  }, [sync, scroller, chips]);

  const page = (direction: -1 | 1): void => {
    const node = scroller();
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth, behavior: "smooth" });
  };

  /**
   * Arrow keys move the selection, Home and End jump to the ends.
   *
   * `scrollIntoView` afterwards because the bar overflows by design — arrowing
   * onto a chip that is off-screen would move focus somewhere invisible, which
   * is the failure mode a roving tab order introduces if nobody handles it.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const index = chips.findIndex((chip) => chip.id === selectedId);
    if (index === -1) return;

    const last = chips.length - 1;
    const next =
      event.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next === -1 || next === index) return;

    event.preventDefault();
    const chip = chips[next];
    if (!chip) return;
    onSelect(chip.id);
    const node = tabs()[next];
    node?.focus();
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div
      ref={host}
      data-chip-bar=""
      className={clsx(
        // 56px, pinned directly beneath the 56px masthead. See the header for
        // why this is `sticky` where the product uses `fixed`, and why an
        // element the capture reports as transparent is painted here.
        "sticky top-[var(--yt-masthead-height)] z-[2019] bg-base",
        className,
      )}
    >
      <div className="relative">
        <ChipBar
          density="feed"
          // **Ours, not measured.** The captured tablist carries no accessible
          // name at all; an unnamed tablist is announced as "tab list" with
          // nothing to say what it filters, so one is supplied.
          aria-label={FILTER_BAR_LABEL}
          onScroll={sync}
          onKeyDown={onKeyDown}
          // The 24px page inset, so the first chip lines up with the first
          // card. `scroll-p` matches it, or a paged scroll lands a chip
          // half-under the inset.
          className="px-[var(--yt-page-inset)] scroll-px-[var(--yt-page-inset)]"
        >
          {chips.map((chip) => {
            const selected = chip.id === selectedId;
            return (
              <Chip
                key={chip.id}
                id={feedTabId(panelId, chip.id)}
                selected={selected}
                aria-controls={panelId}
                // One tab stop for the whole bar — see the header.
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(chip.id)}
              >
                {chip.label}
              </Chip>
            );
          })}
        </ChipBar>

        <ChipArrow side="start" disabled={atStart} onClick={() => page(-1)} />
        <ChipArrow side="end" disabled={atEnd} onClick={() => page(1)} />
      </div>
    </div>
  );
}

/**
 * The overflow affordance: a 56×56 control at each end of the bar.
 *
 * Measured at 56×56 flush with the content column's edge — the right one at
 * x=1864 against a column ending at 1920 — and labelled `Previous` / `Next`
 * (R8 §7). `SizeXl` is the 56×56 rung of the button ladder (R9 §2.1).
 *
 * Both are always in the DOM and go `disabled` at their end rather than being
 * unmounted, which is the same rule `Shelf` and the card's kebab follow: a
 * control that only exists once you can use it is a control that moves the
 * ones beside it, and a control that only appears on hover cannot be reached
 * by keyboard or by touch. `opacity-0` hides the disabled one without
 * collapsing its box.
 *
 * `bg-base` is load-bearing rather than cosmetic: the chips scroll *under*
 * this button, and on a transparent one they would show through the glyph.
 */
function ChipArrow({
  side,
  disabled,
  onClick,
}: {
  side: "start" | "end";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={clsx(
        "pointer-events-none absolute top-0 h-14",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <Button
        variant="text"
        iconOnly
        size="xl"
        disabled={disabled}
        onClick={onClick}
        aria-label={side === "start" ? "Previous" : "Next"}
        className={clsx("pointer-events-auto bg-base", disabled && "opacity-0")}
      >
        <ChevronIcon direction={side === "start" ? "left" : "right"} size={24} />
      </Button>
    </div>
  );
}
