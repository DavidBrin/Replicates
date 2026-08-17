"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/primitives";
import { HistoryIcon, PauseIcon, SearchIcon, GearIcon } from "@/components/icons";
import { VideoRowView } from "@/components/video";
import type { VideoCard } from "@/domain/types";

/**
 * Watch history: the day-grouped list, and the controls rail beside it.
 *
 * ## Layout (R9 §6)
 *
 * `/feed/history` is **the only browse page with a persistent right rail**:
 *
 * ```
 * ytd-two-column-browse-results-renderer   1070 wide @ x=341
 *   #primary     1070 × …   padding-right 441px
 *   #secondary    441 × 827  @ x=1071        ← sticky controls rail
 * ```
 *
 * The primary column is a `yt-page-header-view-model` h1 at 36/50 w700, a
 * 5-chip cloud (`All · Videos · Shorts · Podcasts · Music`, 8px gap), then one
 * `ytd-item-section-renderer` **per day**, each opening with a 20/28 w700 day
 * label at `padding: 24px 0 8px` and holding that day's horizontal lockups.
 *
 * The rail is a search field over a 1px rule (not a boxed input), then three
 * 40px-tall **Text/Mono** icon-leading pills on a 56px pitch — «Clear all watch
 * history», «Pause watch history», «Manage all history» — with three
 * `ytd-compact-link-renderer` sub-links indented by a plain `margin-left: 32px`
 * under the last of them. R9 is emphatic that those three are transparent text
 * buttons and not tonal pills.
 *
 * ## The day headings are measured, and this contradicts `domain/format.ts`
 *
 * `formatDayHeading` documents `Today`/`Yesterday` as **assumed**, on the
 * grounds that "R8 did not capture a signed-in history page". True of R8 — and
 * R9 did. §6 records the day label verbatim as «Today», «Yesterday», then a
 * date. So the two words are measured; that doc comment is stale, and it lives
 * in another slice's file.
 *
 * What remains genuinely **assumed** is the fallback: R9 says only "then a
 * date" and never records its format, so `formatDayHeading`'s `en-GB`
 * `16 August 2026` is a choice, not a measurement.
 *
 * ## Grouping is not this component's job
 *
 * `adapters/repositories/history.ts` already groups, and its header explains
 * why it does so in TypeScript rather than with `date_trunc`: a watch at 23:30
 * in New York is 03:30 the next day in UTC, so SQL-side truncation files half
 * of everyone's evening under tomorrow. Regrouping a flat list here would be a
 * second implementation of that rule, and the two would disagree at exactly the
 * boundary that matters. {@link HistoryList} renders the days it is given.
 *
 * ## Motion
 *
 * None. The rows are `VideoRowView` at `density="history"`, whose hover surface
 * appears instantly, and nothing in the rail transitions.
 */

/** One day's section, as `listHistory` produces it (`HistoryDay`). */
export interface HistoryDayView {
  /** `2026-08-16` in the viewer's zone — stable, sortable, and the React key. */
  readonly dayKey: string;
  /** `Today`, `Yesterday`, or a date. Formatted by the repository. */
  readonly heading: string;
  readonly items: readonly VideoCard[];
}

export interface HistoryListProps {
  days: readonly HistoryDayView[];
  /**
   * Signed out gets an empty state, never an error.
   *
   * `listHistory` already returns `[]` for a null viewer rather than throwing —
   * its header calls that "the honest answer", because the page is reachable
   * while signed out. This renders the other half of that: a sign-in prompt,
   * which is a different empty state from "you have watched nothing".
   */
  signedIn?: boolean;
  /** The server's clock, passed to every row so none hydrates a different time. */
  now?: Date;
  /**
   * The kebab's rows, rendered on every row of every day.
   *
   * A `ReactNode` and **not** a `(video) => ReactNode` callback, for the reason
   * `components/video/index.ts` sets out at length: this is a client component,
   * a function cannot cross the RSC boundary, and `/feed/history/page.tsx` is a
   * server component. A node can cross it. Every history row offers the same
   * one action, so there is nothing per-video for a callback to compute
   * anyway — see {@link historyRowMenu}.
   */
  rowMenu?: ReactNode;
  className?: string;
}

export function HistoryList({
  days,
  signedIn = true,
  now,
  rowMenu,
  className,
}: HistoryListProps) {
  if (!signedIn) {
    return (
      <div data-history-empty="signed-out" className={className}>
        <p className="m-0 text-title text-primary">
          Keep track of what you watch
        </p>
        <p className="m-0 mt-2 text-body text-secondary">
          Watch history is saved to your account. Sign in to see it here.
        </p>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div data-history-empty="none" className={className}>
        <p className="m-0 text-title text-primary">No watch history</p>
        <p className="m-0 mt-2 text-body text-secondary">
          Videos you watch will show up here.
        </p>
      </div>
    );
  }

  return (
    <div data-history-list="" className={clsx("flex flex-col", className)}>
      {days.map((day) => (
        <section key={day.dayKey} data-history-day={day.dayKey}>
          {/* 20/28 w700 with `padding: 24px 0 8px` — measured on
              `ytd-item-section-renderer #title`. */}
          <h2
            data-history-heading=""
            className="m-0 pt-6 pb-2 text-heading font-[var(--yt-weight-bold)] text-primary"
          >
            {day.heading}
          </h2>
          <div className="flex flex-col gap-4">
            {day.items.map((video) => (
              <VideoRowView
                key={`${day.dayKey}:${video.id}`}
                video={video}
                density="history"
                now={now}
                menuItems={rowMenu}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- rail ----- */

export interface HistoryControlsProps {
  /** `true` when recording is currently paused for this viewer. */
  paused?: boolean;
  signedIn?: boolean;
  /** Prefills the field from `?q=`, so a reload keeps the filter. */
  query?: string;
  className?: string;
}

/**
 * The right rail.
 *
 * The three actions are **not** wired to endpoints, and that is a decision
 * rather than an omission: pausing history and clearing it are writes against
 * `watch_events`, and `src/adapters/repositories/watch-events.ts` is the write
 * path for that table — a slice this one does not own, with no pause flag on
 * any table and no bulk-delete in its API. Rendering enabled buttons that
 * silently do nothing would be worse than either alternative, so each one
 * confirms in place and then says plainly that nothing was recorded. When the
 * endpoint lands, the confirm step is already here.
 *
 * "Manage all history" and its three sub-links point at Google account
 * surfaces in the product and have no equivalent here; they render as the
 * measured rows, disabled.
 */
export function HistoryControls({
  paused = false,
  signedIn = true,
  query = "",
  className,
}: HistoryControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <aside
      data-history-controls=""
      // 441 wide with its contents inset to a 353px column, sticky under the
      // 56px masthead.
      className={clsx("w-[441px] shrink-0 self-start lg:sticky lg:top-20", className)}
    >
      <div className="w-[353px]">
        {/* 353 × 56 with `margin: 4px 16px 8px`. A leading 40×40 icon button, a
            14/20 field with `letter-spacing: 0.2px`, and a 1px rule under the
            whole thing — not a boxed input. */}
        <form
          role="search"
          data-history-search=""
          className="mt-1 mb-2 flex h-14 items-center border-b border-outline"
        >
          <span className="mr-2 inline-flex size-10 items-center justify-center text-primary">
            <SearchIcon size={24} />
          </span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            aria-label="Search watch history"
            placeholder="Search watch history"
            className="min-w-0 flex-1 bg-transparent text-body tracking-[0.2px] text-primary outline-none"
          />
        </form>

        {/* 40px tall, radius 20, `padding: 0 16px`, on a 56px pitch — Text and
            Mono, i.e. transparent with a leading 24px glyph. Not tonal pills. */}
        <div className="mt-4 flex flex-col gap-4">
          {confirming ? (
            <div data-history-confirm="" className="flex items-center gap-2">
              <span className="text-body text-primary">Clear all history?</span>
              <Button
                variant="filled"
                size="s"
                onClick={() => {
                  setConfirming(false);
                  setNotice(
                    "Clearing history is not wired up yet — nothing was deleted.",
                  );
                }}
              >
                Clear
              </Button>
              <Button
                variant="text"
                size="s"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="text"
              size="m"
              disabled={!signedIn}
              data-history-action="clear"
              leading={<HistoryIcon size={24} />}
              onClick={() => setConfirming(true)}
            >
              Clear all watch history
            </Button>
          )}

          <Button
            variant="text"
            size="m"
            disabled={!signedIn}
            data-history-action="pause"
            aria-pressed={paused}
            leading={<PauseIcon size={24} />}
            onClick={() =>
              setNotice(
                "Pausing history is not wired up yet — recording is unchanged.",
              )
            }
          >
            {paused ? "Resume watch history" : "Pause watch history"}
          </Button>

          <Button
            variant="text"
            size="m"
            disabled
            data-history-action="manage"
            leading={<GearIcon size={24} />}
          >
            Manage all history
          </Button>

          {/* `ytd-compact-link-renderer` × 3 — 40px rows at 14/20 w400,
              indented by a plain `margin-left: 32px` with no connecting rule. */}
          <ul className="m-0 ml-8 flex list-none flex-col p-0">
            {["Comments", "Posts", "Live chat"].map((label) => (
              <li key={label}>
                <span
                  data-history-sublink={label}
                  aria-disabled="true"
                  className="flex h-10 items-center text-body text-disabled"
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {notice === null ? null : (
          <p role="status" className="mt-4 text-small text-secondary">
            {notice}
          </p>
        )}
      </div>
    </aside>
  );
}

// `historyRowMenu` moved to `./row-menu`, which has no "use client"
// directive: the server-rendered history page calls it, and every export of a
// client module is a client *reference*. Re-exported so importers of this file
// are unaffected.
export { historyRowMenu } from "./row-menu";

