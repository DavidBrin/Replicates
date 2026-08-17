/**
 * The search slice: the results page's parts, and the masthead's type-ahead.
 *
 * ## The server/client seam, which is the part that will bite a caller
 *
 * Two of these four modules are `"use client"` and two are not, and the split
 * is load-bearing rather than incidental:
 *
 * * `search-results.tsx` and `result-row.tsx` are **server-safe**. They own no
 *   state and import nothing server-only, so a `page.tsx` renders them
 *   directly, and `parseSearchQuery` / `searchHref` / `searchFilters` can be
 *   *called* on the server. Every export of a `"use client"` module becomes a
 *   client reference in the server graph, so a URL helper living in one could
 *   not be called by the page at all — which is why the URL contract lives in
 *   `search-results.tsx` rather than beside the panel that writes the links.
 * * `filter-panel.tsx` and `suggestions.tsx` are **client components**. The
 *   panel reads `useSearchParams` and owns its open/closed state; the type-ahead
 *   owns a debounce, an `AbortController` and a keyboard focus ring.
 *
 * Importing this barrel from a Server Component is fine — the client modules
 * cross the boundary as references. What is *not* fine, and is the reason
 * `result-row.tsx` copies two constants instead of importing them, is reaching
 * `@/adapters/search` from anything renderable on the client: that module opens
 * with `import "server-only"` and pulls a WASM Postgres behind it.
 *
 * ## Where the numbers come from
 *
 * `research/08-youtube-ui-measured.md` §3.6 (the results column), §9 (the
 * focused searchbox and its dropdown) and §8.3 (exact strings), against
 * `research/extracted/search-and-breakpoints.json` and
 * `screenshots/07-search-suggestions-1920.png` /
 * `screenshots/08-search-results-1920.png`.
 *
 * Four things in this slice are **assumed** rather than measured, and each says
 * so where it is chosen:
 *
 *   1. the filter panel's entire interior — the capture never opened it, so
 *      every label, column and spacing inside it is written rather than read
 *      (`filter-panel.tsx`);
 *   2. the channel result row's geometry — the dump descends into
 *      `ytd-video-renderer` only (`result-row.tsx`);
 *   3. the empty state, which the product does not have on this surface at all
 *      (`search-results.tsx`);
 *   4. the type-ahead's debounce, which is not observable from a DOM dump
 *      (`suggestions.tsx`).
 */

export {
  HighlightedSnippet,
  SearchResultRow,
  splitHighlight,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  type HighlightRun,
  type SearchChannelCard,
  type SearchResultItem,
  type SearchResultRowProps,
} from "./result-row";

export {
  DEFAULT_SORT,
  DURATION_BUCKETS,
  DURATION_PARAM,
  EMPTY_QUERY_STATE,
  PAGE_PARAM,
  PAGE_SIZE,
  QUERY_PARAM,
  RESULTS_PATH,
  RESULT_TYPES,
  SORTS,
  SORT_PARAM,
  SearchResults,
  TYPE_PARAM,
  UPLOADED_PARAM,
  UPLOAD_WINDOWS,
  hasActiveFilters,
  parseSearchQuery,
  searchFilters,
  searchHref,
  type ReadableParams,
  type SearchQueryState,
  type SearchResultsProps,
  type UploadWindow,
} from "./search-results";

export {
  SearchFilterPanel,
  type SearchFilterPanelProps,
} from "./filter-panel";

export {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_SUGGESTION_LIMIT,
  SearchSuggestions,
  type SearchSuggestionsProps,
  type SuggestionFetcher,
} from "./suggestions";
