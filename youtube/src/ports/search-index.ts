/**
 * Search, behind a port from the first day.
 *
 * The implementation is Postgres full-text search — `tsvector`, a GIN index,
 * `ts_rank_cd` for ordering. That is an honest choice up to something like a
 * few million rows, and a dishonest one past it: `tsvector` has no fuzzy
 * matching worth the name, its ranking cannot be tuned the way a real engine's
 * can, and its query latency degrades in a way that indexes do not fix.
 *
 * The point of the port is that the swap is a file rather than a refactor. The
 * interface deliberately does not expose anything Postgres-shaped — no SQL, no
 * `tsquery`, no ranking function — so an OpenSearch or Typesense adapter can
 * satisfy it without the callers learning anything new.
 *
 * One Postgres constraint worth recording here, because it is invisible until
 * it fails: PGlite's base bundle ships **no extensions**. `pg_trgm` is not
 * available, so there is no trigram similarity and no fuzzy fallback locally.
 * `to_tsvector` is core Postgres and is fine. Any adapter that reaches for
 * `unaccent` or `pg_trgm` will work against Neon and fail to install against
 * the development database, which is the worst possible direction for a
 * difference to run.
 */

export type SearchDocumentKind = "video" | "channel" | "playlist";

/** What the index stores. Deliberately flat — an index is not a database. */
export interface SearchDocument {
  readonly id: string;
  readonly kind: SearchDocumentKind;
  /** Weighted highest. */
  readonly title: string;
  /** Weighted below the title. */
  readonly description: string;
  /** Weighted alongside the title: people search for the channel by name. */
  readonly channelName: string;
  readonly tags: readonly string[];
  /** Drives recency ranking and the "upload date" filter. */
  readonly publishedAt: Date;
  /** Drives popularity ranking. */
  readonly viewCount: number;
  /**
   * Drive the `rating` sort.
   *
   * These are on the document rather than joined at query time because the
   * first version of this port declared a `rating` sort with nothing behind
   * it — the adapter had no ratio to sort by and quietly fell back to
   * popularity, which is the kind of defect that looks like a working feature.
   * A sort option in the enum is a promise that the index can satisfy it.
   */
  readonly likeCount: number;
  readonly dislikeCount: number;
  /** Seconds. Drives the duration filter. */
  readonly durationSeconds: number;
}

export type SearchSort = "relevance" | "date" | "views" | "rating";

export type DurationBucket = "under4" | "4to20" | "over20";

export interface SearchFilters {
  readonly kind?: SearchDocumentKind;
  readonly uploadedAfter?: Date;
  readonly duration?: DurationBucket;
}

export interface SearchQuery {
  readonly text: string;
  readonly filters?: SearchFilters;
  readonly sort?: SearchSort;
  readonly limit: number;
  readonly offset: number;
}

export interface SearchHit {
  readonly id: string;
  readonly kind: SearchDocumentKind;
  /** Engine-specific magnitude. Comparable within a result set, not across. */
  readonly score: number;
  /**
   * The matched fragment with the query terms marked, or `null` when the
   * engine cannot produce one. Rendered as the bolded run in a result row.
   */
  readonly highlight: string | null;
}

export interface SearchResults {
  readonly hits: readonly SearchHit[];
  /**
   * Total matches, which for a large corpus is an estimate. The UI says
   * "About N results" precisely because this number is allowed to be wrong.
   */
  readonly total: number;
  /** A spelling correction, when the engine offers one. */
  readonly correction: string | null;
}

export interface SearchIndex {
  /** Add or replace. Called on publish and on metadata edit. */
  index(document: SearchDocument): Promise<void>;

  /** Bulk form, for seeding and reindexing. */
  indexMany(documents: readonly SearchDocument[]): Promise<void>;

  remove(id: string): Promise<void>;

  query(query: SearchQuery): Promise<SearchResults>;

  /**
   * Type-ahead for the masthead. Separate from {@link query} because it has
   * genuinely different semantics — prefix matching rather than term matching,
   * and it must answer in a few milliseconds because it fires per keystroke.
   */
  suggest(prefix: string, limit: number): Promise<readonly string[]>;
}
