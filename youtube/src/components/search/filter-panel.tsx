"use client";

import clsx from "clsx";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { SortIcon } from "@/components/icons";
import { Button } from "@/components/primitives";

import {
  DURATION_BUCKETS,
  RESULT_TYPES,
  SORTS,
  UPLOAD_WINDOWS,
  hasActiveFilters,
  searchHref,
  type SearchQueryState,
} from "./search-results";

/**
 * The search filter panel.
 *
 * ## What is measured
 *
 * Only the trigger. `research/extracted/search-and-breakpoints.json` records
 * `#filter-button` at 95.17×40, sitting at the right-hand end of a 50.5px chip
 * bar, labelled `Filters` with the accessible name `Search filters` (R8 §3.6,
 * and `screenshots/08-search-results-1920.png` shows the trailing tune glyph).
 * The capture never opened the panel, so **every measurement inside it is
 * absent**: no column widths, no row height, no group heading type, no divider
 * colour. What is built below is the four groups the port can satisfy, laid out
 * as columns the way the product's is, with spacing borrowed from the design
 * system's own tokens rather than invented pixel values.
 *
 * ## What is deliberately not built
 *
 * The measured chip row — `All, Shorts, Unwatched, Watched, Videos, Recently
 * uploaded, Live` (R8 §3.6 and §8.3) — is absent, and that is a decision rather
 * than an omission. Five of its seven chips have nothing behind them here:
 * `SearchDocument` carries no `is_short`, no live flag, and no per-viewer watch
 * history, so *Shorts*, *Unwatched*, *Watched* and *Live* could only ever be
 * chips that filter nothing. A control that does nothing is a worse defect than
 * a missing one, because it is indistinguishable from a broken query. The two
 * that do map — *Videos* and *Recently uploaded* — are the Type and Upload date
 * groups below, which is where the panel would put them anyway.
 *
 * ## Why every option is a link
 *
 * Because the requirement is that a search is shareable and that back and
 * forward work, and a link is the control that already does both. It also
 * middle-clicks, it is announced as a navigation, and it needs no JavaScript to
 * have run. The only client state in this component is whether the panel is
 * open — everything else is in the URL, which is the point.
 *
 * Clicking the *active* option in a filter group clears it, so the group needs
 * no separate reset. Sort has no cleared state; picking it always sets one, and
 * `relevance` is simply the value that is omitted from the URL.
 */

export interface SearchFilterPanelProps {
  state: SearchQueryState;
  /** Start expanded. The panel is collapsed by default, as the product's is. */
  defaultOpen?: boolean;
  className?: string;
}

export function SearchFilterPanel({
  state,
  defaultOpen = false,
  className,
}: SearchFilterPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={className}>
      {/*
        The measured bar is 50.5px tall with the trigger pushed to its right
        edge. With the chip row deliberately absent (see the header) the bar
        carries only the trigger, so it is a right-aligned row rather than a
        `justify-between` one that would put the button in the middle of
        nothing.
      */}
      <div className="flex h-[50px] items-center justify-end">
        <Button
          variant="text"
          size="m"
          aria-expanded={open}
          aria-controls={panelId}
          // The visible label is `Filters`; the accessible name measured on the
          // button is `Search filters`, which is the more useful of the two out
          // of context and is what the capture records.
          aria-label="Search filters"
          onClick={() => setOpen((current) => !current)}
          trailing={<SortIcon size={24} />}
          data-filter-trigger=""
        >
          Filters
        </Button>
      </div>

      {open ? (
        <div
          id={panelId}
          data-filter-panel=""
          // A top and bottom rule, which is what the product's panel has;
          // `--yt-guide-divider` is the one divider token measured in the
          // chrome. The columns wrap rather than scroll — four fixed columns at
          // 855px leave ~200px each, which is not enough for `Under 4 minutes`.
          className={clsx(
            "flex flex-wrap gap-x-12 gap-y-6",
            "border-y border-[var(--yt-guide-divider)] py-4",
          )}
        >
          <FilterGroup heading="Upload date">
            {UPLOAD_WINDOWS.map((option) => (
              <FilterOption
                key={option.value}
                label={option.label}
                active={state.uploaded === option.value}
                href={searchHref(state, {
                  uploaded: state.uploaded === option.value ? null : option.value,
                })}
              />
            ))}
          </FilterGroup>

          <FilterGroup heading="Type">
            {RESULT_TYPES.map((option) => (
              <FilterOption
                key={option.value}
                label={option.label}
                active={state.kind === option.value}
                href={searchHref(state, {
                  kind: state.kind === option.value ? null : option.value,
                })}
              />
            ))}
          </FilterGroup>

          <FilterGroup heading="Duration">
            {DURATION_BUCKETS.map((option) => (
              <FilterOption
                key={option.value}
                label={option.label}
                active={state.duration === option.value}
                href={searchHref(state, {
                  duration: state.duration === option.value ? null : option.value,
                })}
              />
            ))}
          </FilterGroup>

          <FilterGroup heading="Sort by">
            {SORTS.map((option) => (
              <FilterOption
                key={option.value}
                label={option.label}
                active={state.sort === option.value}
                // No toggle-off: one sort is always in effect, and clicking the
                // active one should be a no-op rather than a jump back to
                // relevance the user did not ask for.
                href={searchHref(state, { sort: option.value })}
              />
            ))}
          </FilterGroup>

          {hasActiveFilters(state) ? (
            <div className="basis-full">
              <Link
                href={searchHref(state, {
                  kind: null,
                  uploaded: null,
                  duration: null,
                })}
                data-clear-filters=""
                className="text-body text-cta hover:text-cta-hover"
              >
                Clear all filters
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterGroup({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={heading} className="min-w-[140px]">
      <h3 className="m-0 mb-2 text-body font-[var(--yt-weight-medium)] text-primary">
        {heading}
      </h3>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

/**
 * One option.
 *
 * `aria-current="true"` rather than `aria-pressed`: this is a link, and a link
 * that represents the current state of the page is what `aria-current` is for.
 * A `<button aria-pressed>` would announce the right thing and lose every
 * property that made a link the right control.
 */
function FilterOption({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <li className="leading-[32px]">
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        data-filter-option=""
        data-active={active ? "" : undefined}
        className={clsx(
          "text-body",
          active
            ? "font-[var(--yt-weight-medium)] text-primary"
            : "text-secondary hover:text-primary",
        )}
      >
        {label}
      </Link>
    </li>
  );
}
