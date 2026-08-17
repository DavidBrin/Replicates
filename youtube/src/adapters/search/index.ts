import "server-only";

import { database } from "@/adapters/db";
import type { SqlDatabase } from "@/adapters/db";
import type { SearchIndex } from "@/ports/search-index";

import { PostgresSearchIndex } from "./postgres";

export { PostgresSearchIndex, HIGHLIGHT_START, HIGHLIGHT_END } from "./postgres";

export type {
  DurationBucket,
  SearchDocument,
  SearchDocumentKind,
  SearchFilters,
  SearchHit,
  SearchIndex,
  SearchQuery,
  SearchResults,
  SearchSort,
} from "@/ports/search-index";

/**
 * The search composition point.
 *
 * There is exactly one implementation today, so this function does not branch,
 * and the honest thing is to say so rather than to dress a single `new` up as
 * a strategy. It still earns its place: `ports/search-index.ts` exists so that
 * swapping Postgres for OpenSearch is a file rather than a refactor, and *this*
 * is the file. A second adapter is a `case` here and nothing anywhere else —
 * which is only true while every caller goes through `searchIndex()` instead
 * of importing `PostgresSearchIndex` directly.
 *
 * Selection would key off `config()` the way `adapters/db` does, on a
 * `SEARCH_DRIVER` variable that does not exist yet. Adding one now would be a
 * setting with a single legal value, which is worse than no setting at all: it
 * reads as a supported choice and would be the first thing to rot.
 *
 * Memoised on a promise rather than a value, for the reason `adapters/db` is:
 * two requests arriving before the first has resolved must share one instance
 * instead of racing to build two — here that matters only because it would
 * boot two PGlite instances against one data directory.
 */
let instance: Promise<SearchIndex> | null = null;

export function searchIndex(): Promise<SearchIndex> {
  instance ??= create();
  return instance;
}

async function create(): Promise<SearchIndex> {
  return new PostgresSearchIndex(await database());
}

/**
 * Build an index over a database handle the caller already has.
 *
 * The seeding scripts and the test suites both need an index bound to a
 * specific database rather than to the memoised process-wide one, and neither
 * should have to know which class satisfies the port to get it.
 */
export function createSearchIndex(db: SqlDatabase): SearchIndex {
  return new PostgresSearchIndex(db);
}

/** Tests only. */
export function resetSearchIndexForTests(): void {
  instance = null;
}
