import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DurationBucket,
  SearchDocumentKind,
  SearchFilters,
  SearchSort,
} from "@/ports/search-index";
import { exactCount } from "@/domain/format";

import { SearchResultRow, type SearchResultItem } from "./result-row";

/**
 * The results column, and the URL contract behind it.
 *
 * ## Why the URL contract lives in this file
 *
 * Three things have to agree about what `/results?…` means: the page that runs
 * the query (a Server Component), the filter panel that writes the links (a
 * Client Component, because it reads `useSearchParams`), and
 * `src/app/api/search/route.ts`. A `"use client"` module cannot host it —
 * every export of one becomes a client reference in the server graph, so the
 * page could not call `parseSearchQuery` at all. This module is deliberately
 * *not* `"use client"`, imports nothing server-only, and is therefore the one
 * place all three can reach. The alternative was three copies of a key name,
 * which is the defect where a filter silently stops applying because one
 * caller spells it `uploadDate` and another `uploaded`.
 *
 * ## The measured column
 *
 * R8 §3.6, against `research/extracted/search-and-breakpoints.json`:
 *
 * | Part | Value |
 * |---|---|
 * | `ytd-search` padding | `0 24px 16px` |
 * | two-column wrapper | 1280 max-width |
 * | `#primary` | 855 wide, `max-width: 1250px` |
 * | row → row | `margin-top: 16px` on `ytd-video-renderer` |
 *
 * The second column — a knowledge panel beside the results in
 * `screenshots/08-search-results-1920.png` — is not reproduced. It is an ad
 * unit and a TV-series entity card, neither of which this application has
 * anything to put in.
 *
 * Every link out of this module is a `next/link`, including the pager: the
 * offset is in the URL so that a page of results is shareable, and once it is
 * in the URL a link is the honest control for it — back and forward work, a
 * page can be sent to someone, and a middle click opens a tab. `Link` rather
 * than a bare anchor so that moving between pages does not tear down the shell
 * around them.
 *
 * ## "About N results"
 *
 * The wording is the port's, not a choice made here: `ports/search-index.ts`
 * documents `total` as an estimate and says "The UI says 'About N results'
 * precisely because this number is allowed to be wrong." Under the Postgres
 * adapter it happens to be exact — `count(*) over ()` — and the adapter's own
 * header warns that it will stop being exact the day the adapter is swapped
 * and nothing else will announce it. Rendering "N results" today would be
 * accurate today and a lie later, with no diff to blame.
 *
 * ## The empty state is assumed, and had to be
 *
 * R8 §8.3 is explicit: "A nonsense query does **not** produce a 'no results'
 * panel; it produces `Did you mean: <corrected query>` followed by a
 * `People also watched` shelf. There is no empty state to build for search on
 * this surface." That path is closed to us. `SearchResults.correction` is
 * always `null` under this adapter — PGlite ships no `pg_trgm`, so there is no
 * trigram index to spell-correct against and no query log either (D13,
 * `src/adapters/search/postgres.ts`) — and there is no recommender surface on
 * this page to fall back to. So an empty state exists here that does not exist
 * in the product, and its copy is written rather than measured.
 */

/* --------------------------------------------------------- the URL shape -- */

/**
 * The query parameter, verbatim.
 *
 * **Measured twice**: the masthead input is `name="search_query"`
 * (`src/components/layout/masthead.tsx`, from the focused-searchbox dump) and
 * the captured results URL is
 * `https://www.youtube.com/results?search_query=how+it+is+made`. Everything
 * else below is ours — YouTube encodes its filters into one opaque `sp=`
 * protobuf, which is unreadable, unshareable by hand and impossible to
 * round-trip in a test.
 */
export const QUERY_PARAM = "search_query";

export const SORT_PARAM = "sort";
export const TYPE_PARAM = "type";
export const UPLOADED_PARAM = "uploaded";
export const DURATION_PARAM = "duration";
export const PAGE_PARAM = "page";

/** Where the results live. */
export const RESULTS_PATH = "/results";

/**
 * Rows per page.
 *
 * **Assumed.** The capture is an infinite-scroll column 7487px tall and the
 * number of rows in the first network batch is not recoverable from it. Twenty
 * is a page of results at 235.38px a row, and is comfortably under the
 * adapter's `MAX_PAGE_SIZE` of 100 — which matters because `ts_headline` runs
 * once per returned row.
 */
export const PAGE_SIZE = 20;

export type UploadWindow = "hour" | "today" | "week" | "month" | "year";

/**
 * How far back each upload-date option reaches, in milliseconds.
 *
 * The port's filter is a single `uploadedAfter: Date`, so a window is a
 * subtraction from `now` rather than a calendar operation. `month` is 30 days
 * and `year` is 365 — **assumed**, and knowingly different from
 * `domain/format.ts`, which counts *calendar* months for display because "4
 * weeks ago" on 2 March is a sentence no calendar agrees with. A filter
 * boundary is not a sentence: nobody can observe whether "This month" reached
 * back 30 days or to the 1st, and a fixed window keeps the parameter
 * shareable — the same URL means the same span whenever it is opened.
 */
const UPLOAD_WINDOW_MS: Readonly<Record<UploadWindow, number>> = {
  hour: 60 * 60 * 1000,
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

/**
 * The filter vocabulary, with the labels the panel renders.
 *
 * **The labels are assumed.** R8 §3.6 records the *Filters* button (95.17×40,
 * label `Filters`, accessible name `Search filters`) and never opened the
 * panel behind it, so nothing in `research/` records a single option's text.
 * These are the shapes the port can actually satisfy, named plainly.
 */
export const UPLOAD_WINDOWS: readonly {
  readonly value: UploadWindow;
  readonly label: string;
}[] = [
  { value: "hour", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

/**
 * `playlist` is a legal `SearchDocumentKind` and is deliberately absent.
 *
 * Nothing indexes one: `scripts/seed.ts` writes videos and channels and
 * nothing else, so a *Playlist* option would be a control that always returns
 * zero results — which reads as a broken search rather than as an empty
 * category. It comes back the day a playlist is indexed, and not before.
 */
export const RESULT_TYPES: readonly {
  readonly value: SearchDocumentKind;
  readonly label: string;
}[] = [
  { value: "video", label: "Video" },
  { value: "channel", label: "Channel" },
];

/** The adapter's own buckets, labelled. Boundaries are inclusive at 4:00 and
 * 20:00 — `src/adapters/search/postgres.ts` records why. */
export const DURATION_BUCKETS: readonly {
  readonly value: DurationBucket;
  readonly label: string;
}[] = [
  { value: "under4", label: "Under 4 minutes" },
  { value: "4to20", label: "4 – 20 minutes" },
  { value: "over20", label: "Over 20 minutes" },
];

/**
 * The four sorts the port promises.
 *
 * `rating` is a Wilson score lower bound, not a like ratio — a video with one
 * unopposed like sinks and an unrated one sorts to zero. The label says
 * "Rating" because that is what the product calls it; the behaviour is
 * documented where it is implemented.
 */
export const SORTS: readonly { readonly value: SearchSort; readonly label: string }[] =
  [
    { value: "relevance", label: "Relevance" },
    { value: "date", label: "Upload date" },
    { value: "views", label: "View count" },
    { value: "rating", label: "Rating" },
  ];

/** The sort a URL with no `sort` means. */
export const DEFAULT_SORT: SearchSort = "relevance";

/** Everything `/results` reads out of its URL. */
export interface SearchQueryState {
  readonly text: string;
  readonly sort: SearchSort;
  readonly kind: SearchDocumentKind | null;
  readonly uploaded: UploadWindow | null;
  readonly duration: DurationBucket | null;
  /** 1-based, so that `?page=2` reads the way a person expects. */
  readonly page: number;
}

/** The subset of `URLSearchParams` this module needs, so that a plain object
 * or a Next `ReadonlyURLSearchParams` both satisfy it. */
export interface ReadableParams {
  get(name: string): string | null;
}

export const EMPTY_QUERY_STATE: SearchQueryState = {
  text: "",
  sort: DEFAULT_SORT,
  kind: null,
  uploaded: null,
  duration: null,
  page: 1,
};

/**
 * Read the state out of a URL.
 *
 * Every unknown value is dropped rather than rejected. A search URL is
 * hand-editable and gets truncated by chat clients, so `?duration=medium` has
 * to mean "no duration filter" and not a 400 — the alternative is an error page
 * for a typo in a shared link. The one thing that is *not* silently coerced is
 * the text: it is passed through untrimmed-then-trimmed exactly once, here, so
 * that `?search_query=%20%20` and a missing parameter reach the same branch.
 */
export function parseSearchQuery(params: ReadableParams): SearchQueryState {
  return {
    text: (params.get(QUERY_PARAM) ?? "").trim(),
    sort: pick(SORTS, params.get(SORT_PARAM)) ?? DEFAULT_SORT,
    kind: pick(RESULT_TYPES, params.get(TYPE_PARAM)),
    uploaded: pick(UPLOAD_WINDOWS, params.get(UPLOADED_PARAM)),
    duration: pick(DURATION_BUCKETS, params.get(DURATION_PARAM)),
    page: parsePage(params.get(PAGE_PARAM)),
  };
}

function pick<T extends string>(
  options: readonly { readonly value: T }[],
  raw: string | null,
): T | null {
  if (raw === null) return null;
  return options.find((option) => option.value === raw)?.value ?? null;
}

function parsePage(raw: string | null): number {
  if (raw === null) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

/**
 * The state as the port's filters.
 *
 * `now` is a parameter rather than a `new Date()` because this runs on the
 * server for the page and again in a test with a frozen clock, and an
 * "uploaded after" boundary computed from an ambient clock is a query that
 * cannot be asserted.
 */
export function searchFilters(
  state: SearchQueryState,
  now: Date,
): SearchFilters | undefined {
  const filters: {
    kind?: SearchDocumentKind;
    uploadedAfter?: Date;
    duration?: DurationBucket;
  } = {};

  if (state.kind !== null) filters.kind = state.kind;
  if (state.uploaded !== null) {
    filters.uploadedAfter = new Date(now.getTime() - UPLOAD_WINDOW_MS[state.uploaded]);
  }
  if (state.duration !== null) filters.duration = state.duration;

  // `undefined` rather than `{}` so that "no filters" is one shape rather than
  // two the adapter has to treat alike.
  return Object.keys(filters).length === 0 ? undefined : filters;
}

/** True when anything other than the text is narrowing the result set. */
export function hasActiveFilters(state: SearchQueryState): boolean {
  return state.kind !== null || state.uploaded !== null || state.duration !== null;
}

/** The `SearchQueryState` key that carries the page, named once so that
 * {@link searchHref}'s reset rule cannot drift from the field. */
const PAGE_STATE_KEY: keyof SearchQueryState = "page";

/**
 * A URL for `state` with `patch` applied.
 *
 * Two rules, both of which exist because a shared link has to be the same link.
 *
 * **Defaults are omitted.** `sort=relevance` and `page=1` are never written, so
 * the URL a user arrives at from the masthead and the URL they get after
 * clicking *Relevance* are byte-identical.
 *
 * **Any change other than the page resets the page.** Applying a duration
 * filter while on page 4 of the unfiltered results otherwise lands on an offset
 * past the end of the filtered set — an empty page that looks like a broken
 * filter. The adapter answers that case correctly (its `left join` against a
 * one-row aggregate guarantees a total even past the end); it still reads as a
 * bug to the person who clicked.
 */
export function searchHref(
  state: SearchQueryState,
  patch: Partial<SearchQueryState> = {},
): string {
  const next: SearchQueryState = { ...state, ...patch };
  const keys = Object.keys(patch);
  const page =
    keys.length === 0 || (keys.length === 1 && keys[0] === PAGE_STATE_KEY)
      ? next.page
      : 1;

  const params = new URLSearchParams();
  if (next.text !== "") params.set(QUERY_PARAM, next.text);
  if (next.sort !== DEFAULT_SORT) params.set(SORT_PARAM, next.sort);
  if (next.kind !== null) params.set(TYPE_PARAM, next.kind);
  if (next.uploaded !== null) params.set(UPLOADED_PARAM, next.uploaded);
  if (next.duration !== null) params.set(DURATION_PARAM, next.duration);
  if (page > 1) params.set(PAGE_PARAM, String(page));

  const query = params.toString();
  return query === "" ? RESULTS_PATH : `${RESULTS_PATH}?${query}`;
}

/* -------------------------------------------------------------- the list -- */

export interface SearchResultsProps {
  state: SearchQueryState;
  /** `SearchResults.total`, which the port documents as an estimate. */
  total: number;
  items: readonly SearchResultItem[];
  /** The server's clock, passed down so relative times do not hydrate wrong. */
  now?: Date;
  className?: string;
}

export function SearchResults({
  state,
  total,
  items,
  now,
  className,
}: SearchResultsProps) {
  if (state.text === "") {
    return (
      <EmptyState
        className={className}
        title="Search YouTube"
        body="Type in the box above to find videos and channels."
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className={className}>
        <ResultCount total={total} />
        <EmptyState
          title="No results found"
          body={
            hasActiveFilters(state)
              ? "Try different keywords or remove some filters."
              : // A stopword-only query — "the a of" — lands here. The adapter
                // does not fail on it: `websearch_to_tsquery('english', 'the a
                // of')` is the empty tsquery, which matches nothing, so this is
                // a legitimately empty result set rather than an error, and it
                // must not read as one.
                "Try different keywords."
          }
          action={
            hasActiveFilters(state) ? (
              <Link
                href={searchHref(state, {
                  kind: null,
                  uploaded: null,
                  duration: null,
                })}
                className="text-body text-cta hover:text-cta-hover"
              >
                Clear filters
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <ResultCount total={total} />
      <ol data-search-results="" className="m-0 list-none p-0">
        {items.map((item) => (
          <li
            key={item.kind === "video" ? item.video.id : item.channel.id}
            // 16px between rows, measured as `margin: 16px 0 0` on
            // `ytd-video-renderer`. On the list rather than the row so that the
            // channel renderer inherits the same rhythm.
            className="mt-4 first:mt-0"
          >
            <SearchResultRow item={item} now={now} />
          </li>
        ))}
      </ol>
      <Pagination state={state} total={total} shown={items.length} />
    </div>
  );
}

/**
 * `About 1,234 results`.
 *
 * Comma-grouped through `exactCount`, which pins `en-US` so that a server
 * rendering for a German viewer does not emit `1.234` — a figure that reads as
 * a decimal to everyone else (`src/domain/format.ts`).
 */
function ResultCount({ total }: { total: number }) {
  return (
    <p data-result-count="" className="mt-0 mb-3 text-small text-secondary">
      About {exactCount(total)} {total === 1 ? "result" : "results"}
    </p>
  );
}

function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-search-empty=""
      className={clsx("py-16 text-center", className)}
    >
      <p className="m-0 text-title font-[var(--yt-weight-medium)] text-primary">
        {title}
      </p>
      <p className="mt-2 mb-0 text-body text-secondary">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Previous / Next.
 *
 * The product scrolls infinitely and has no pager at all, so this is an
 * addition rather than a reproduction — see the module header for why the
 * offset is in the URL in the first place.
 *
 * "Is there a next page" is decided against `total` rather than by asking for
 * one row more than needed. The adapter's total is exact, and the port allows
 * it not to be — so the worst case after a swap is a Next that lands on an
 * empty page, which the empty state already handles.
 */
function Pagination({
  state,
  total,
  shown,
}: {
  state: SearchQueryState;
  total: number;
  shown: number;
}) {
  const offset = (state.page - 1) * PAGE_SIZE;
  const hasPrevious = state.page > 1;
  const hasNext = offset + shown < total;

  if (!hasPrevious && !hasNext) return null;

  return (
    <nav aria-label="Search result pages" className="mt-8 flex justify-center gap-4">
      {hasPrevious ? (
        <Link
          href={searchHref(state, { page: state.page - 1 })}
          className="text-body text-cta hover:text-cta-hover"
          rel="prev"
        >
          Previous
        </Link>
      ) : null}
      {hasNext ? (
        <Link
          href={searchHref(state, { page: state.page + 1 })}
          className="text-body text-cta hover:text-cta-hover"
          rel="next"
        >
          Next
        </Link>
      ) : null}
    </nav>
  );
}
