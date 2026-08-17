"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/primitives";
import { ChevronIcon } from "@/components/icons";
import type { VideoCard } from "@/domain/types";

import { VideoCardView } from "./video-card";

/**
 * A horizontally-scrolling row of cards — the home feed's `Shorts` shelf, the
 * subscriptions feed's `Most relevant`, the four shelves on the "You" page.
 *
 * ## Geometry
 *
 * `--yt-sys-measurement--shelf-item-gap-{small,med,wide}` is 12 / 16 / 16px
 * (R9 §1.1); the wide value is the same 16px the grid uses, so the two agree
 * and this reuses `--yt-size-compact` rather than adding a token. Items are
 * sized as a fraction of the shelf rather than at a fixed width, because the
 * measured shelves declare `elements-per-row` — 3 on `Most relevant`, 4 on the
 * You page, 5 on the subscriptions Shorts shelf (R9 §5, §7) — and let the
 * width fall out.
 *
 * The heading is **15px / weight 700**, measured on the home shelf's `h2` in
 * `research/extracted/card-dump-1920.json` (`shelf.shelfTitle`). Note that the
 * signed-in `ytd-shelf-renderer` headings on `/feed/subscriptions` and
 * `/feed/you` measure **20px / 28px / 700** instead (R9 §5, §7) — two shelf
 * headings at two sizes in one product. The home value is used here because
 * home is where a shelf of *video cards* appears; a surface that needs the
 * larger one can pass its own heading through `action` and set `title` empty,
 * or this grows a prop, which is an additive change.
 *
 * ## What is assumed
 *
 * * **The arrow position.** R9 §6 describes the history reel shelf's control
 *   only as a "right-arrow circular button on hover" and never measures it.
 *   Centring on the scroller is this file's choice; centring on the thumbnail
 *   band, which is what the product looks like it does, cannot be expressed in
 *   CSS without knowing the card's aspect-driven height.
 * * **Four items per row** as the default. Every measured shelf declares a
 *   count and they are all different; 4 is the middle of them.
 *
 * The arrows are always in the DOM and are `disabled` at the ends rather than
 * removed, for the same reason the card's kebab is always present: a control
 * that appears on hover is unreachable by keyboard.
 *
 * ## Why `Shelf` takes no callbacks
 *
 * It is a client component — the arrows need a ref and a scroll listener — so
 * a function prop cannot reach it from a server page. Everything it accepts is
 * serialisable. A shelf that needs per-item menus renders its own cards and
 * passes them as {@link ShelfProps.children}.
 */

/** Measured `shelf-item-gap-wide`, and the grid's item margin: the same 16px. */
const ITEM_GAP = "var(--yt-size-compact)";

export interface ShelfProps {
  title: string;
  /** A 24px glyph before the title — the Shorts shelf has one (R9 §5). */
  titleIcon?: ReactNode;
  /** `View all`, `Show more`, a new-playlist button. Sits at the row's end. */
  action?: ReactNode;
  /** The simple path: cards with no per-item menu. */
  videos?: readonly VideoCard[];
  /** The composed path, for per-item menus. Replaces `videos` when present. */
  children?: ReactNode;
  itemsPerRow?: number;
  showAvatar?: boolean;
  showChannel?: boolean;
  now?: Date;
  className?: string;
}

export function Shelf({
  title,
  titleIcon,
  action,
  videos,
  children,
  itemsPerRow = 4,
  showAvatar = true,
  showChannel = true,
  now,
  className,
}: ShelfProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const sync = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    // A one-pixel tolerance: fractional item widths mean `scrollLeft` at the
    // far end lands a fraction short of `scrollWidth - clientWidth`, and a
    // strict comparison leaves the arrow enabled with nowhere to go.
    setAtStart(node.scrollLeft <= 1);
    setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 1);
  }, []);

  useEffect(() => {
    sync();
  }, [sync, videos, children]);

  const page = (direction: -1 | 1): void => {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth, behavior: "smooth" });
  };

  const items =
    children ??
    (videos ?? []).map((video) => (
      <VideoCardView
        key={video.id}
        video={video}
        showAvatar={showAvatar}
        showChannel={showChannel}
        now={now}
      />
    ));

  return (
    <section data-shelf="" className={clsx("relative", className)}>
      <div className="flex items-center">
        {titleIcon ? <span className="mr-2 inline-flex">{titleIcon}</span> : null}
        <h2 className="m-0 flex-1 text-shelf font-[var(--yt-weight-bold)] text-primary">
          {title}
        </h2>
        {action}
      </div>

      <div className="relative">
        <div
          ref={scroller}
          data-shelf-scroller=""
          onScroll={sync}
          className={clsx(
            "mt-3 flex overflow-x-auto overscroll-x-contain",
            // Snap to the start of an item so a page never leaves a card half
            // off the edge. `proximity`, Tailwind's default strictness — a
            // mandatory snap fights a user's own flick.
            "snap-x",
            // The product's shelves show no scrollbar; the platform one would
            // eat 15px of the last row of cards.
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
          style={{ columnGap: ITEM_GAP }}
        >
          {shelfItems(items, itemsPerRow)}
        </div>

        <ShelfArrow side="start" disabled={atStart} onClick={() => page(-1)} />
        <ShelfArrow side="end" disabled={atEnd} onClick={() => page(1)} />
      </div>
    </section>
  );
}

/**
 * Each item gets `flex: 0 0 calc((100% − (n−1)·gap) / n)`.
 *
 * The same arithmetic the grid uses, applied along one axis: with n items
 * visible and n−1 gaps between them, the leftover divided by n is the item.
 */
function shelfItems(items: ReactNode, itemsPerRow: number): ReactNode {
  const basis = `calc((100% - ${itemsPerRow - 1} * ${ITEM_GAP}) / ${itemsPerRow})`;
  return toArray(items).map((item, index) => (
    <div
      // The children are a caller-supplied list with no identity of its own,
      // and the shelf never reorders them in place, so the index is the honest
      // key rather than a lazy one.
      key={index}
      data-shelf-item=""
      className="snap-start"
      style={{ flex: `0 0 ${basis}` }}
    >
      {item}
    </div>
  ));
}

function toArray(items: ReactNode): ReactNode[] {
  return Array.isArray(items) ? (items as ReactNode[]) : [items];
}

function ShelfArrow({
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
        "pointer-events-none absolute top-1/2 -translate-y-1/2",
        side === "start" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
      )}
    >
      <Button
        variant="outline"
        iconOnly
        size="m"
        disabled={disabled}
        onClick={onClick}
        aria-label={side === "start" ? "Previous" : "Next"}
        className={clsx(
          "pointer-events-auto bg-base",
          // Disabled loses its pointer events via `Button`'s own rule; hiding
          // it entirely would move the remaining arrow, so it stays put.
          disabled && "opacity-0",
        )}
      >
        <ChevronIcon direction={side === "start" ? "left" : "right"} size={24} />
      </Button>
    </div>
  );
}
