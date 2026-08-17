import "server-only";

/**
 * One SQL dialect, two engines.
 *
 * Every repository writes Postgres — real Postgres, `$1` placeholders and all —
 * exactly once, and that SQL runs unmodified in both places: an embedded WASM
 * Postgres for local development and tests, and Neon for a deployment.
 *
 * The sibling project `Linear` settled this argument and it is worth not
 * re-having. SQLite locally and Postgres deployed means writing the schema
 * twice, but the duplication is not the objection — the objection is that the
 * two engines disagree *quietly*. SQLite applies type affinity rather than
 * checking, so a column declared `integer` accepts `'yes'`; its default
 * collation is byte-wise where Postgres' folds case. Every such difference is
 * a green local suite and a 500 in production.
 *
 * This project adds a third reason. Search is `tsvector` and the recommender
 * is a self-join over a co-visitation table with a `GROUP BY` that the planner
 * has to get right. Neither has a SQLite equivalent that would prove anything.
 *
 * What remains engine-specific — connection lifecycle, transaction mechanics,
 * how a result set is shaped — lives behind this interface and nowhere else.
 */

/** A value that can cross the wire in either direction. */
export type SqlValue = string | number | boolean | null;

/** A row as returned by either engine: column name → value. */
export type SqlRow = Record<string, unknown>;

/**
 * A handle that can run statements. Both the pool and a transaction satisfy
 * it, which is what lets a repository method take an optional `SqlExecutor`
 * and be composed into a larger transaction without knowing it.
 */
export interface SqlExecutor {
  /** Run a statement and return its rows. Use for `select` and `returning`. */
  query<T extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T[]>;

  /** Run a statement and return how many rows it changed. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<number>;
}

/** A database. Adds lifecycle and transactions to {@link SqlExecutor}. */
export interface SqlDatabase extends SqlExecutor {
  /**
   * Run `fn` inside a transaction, committing on return and rolling back on
   * throw. Not nestable: an inner call joins the outer transaction rather than
   * opening a savepoint, because nothing in this application needs partial
   * rollback and a savepoint that silently does nothing is worse than an
   * honest absence.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;

  /** Apply `schema.sql`. Idempotent. */
  migrate(): Promise<void>;

  close(): Promise<void>;
}

/**
 * Postgres error codes this application distinguishes. Both drivers surface
 * the code in the same place, which is the only reason a shared helper works.
 */
export const PG_ERROR = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  NOT_NULL_VIOLATION: "23502",
} as const;

export function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
