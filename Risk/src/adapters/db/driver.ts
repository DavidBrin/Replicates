import "server-only";

/**
 * One SQL dialect, two engines.
 *
 * The repositories write Postgres — real Postgres, `$1` placeholders and all —
 * exactly once, and that SQL runs unmodified in three places: an embedded
 * WASM Postgres for local development and tests, and Neon for a deployment.
 *
 * ## Why not SQLite locally
 *
 * The sibling project `dollar-pixels` runs SQLite locally and Postgres in
 * production, with the schema and every statement written twice. At six tables
 * that is tolerable. Here it would be nineteen — but the duplication is not
 * the real objection. The two engines disagree about things this schema
 * depends on, and they disagree *quietly*:
 *
 * - **Collation.** Manual ordering is a base-62 string compared byte-wise.
 *   SQLite's default `BINARY` collation is byte-wise; Postgres' default ICU
 *   collation folds case, so `Zz` — the key produced by dragging an item to
 *   the top of a list — sorts *last*. The data-model lane reproduced this
 *   against a real Postgres 16 (`research/03-data-model.md` §3.2). A
 *   SQLite-backed test suite cannot see the bug at all.
 * - **Types.** SQLite has no `boolean`, no `timestamptz`, and applies type
 *   affinity rather than checking; a column declared `integer` will happily
 *   store `'yes'`. Postgres rejects it. Every such difference is a test that
 *   passes locally and a 500 in production.
 *
 * PGlite is Postgres compiled to WASM — the same parser, planner and
 * collation. Running it locally means the local suite exercises the deployed
 * engine's semantics, and there is one `schema.sql` rather than two
 * (`research/06-stack-deployment.md` §4).
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
   * throw. Nested calls join the outer transaction rather than opening a
   * second one — Postgres would need savepoints to do otherwise, and nothing
   * here wants partial rollback.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;

  /** Apply the schema. Idempotent; safe against a populated database. */
  migrate(): Promise<void>;

  /** Release connections. Used by tests and by nothing in the request path. */
  close(): Promise<void>;

  /** Which engine this is, for diagnostics. */
  readonly engine: SqlEngine;
}

export type SqlEngine = "pglite" | "neon";

/**
 * Split a multi-statement script into individual statements.
 *
 * Neither driver accepts a whole script with parameters, and splitting also
 * means a syntax error names the statement that caused it rather than the
 * file. The walk respects string literals, dollar-quoted blocks and comments,
 * because `schema.sql` contains semicolons inside all three.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i]!;
    const next = script[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      current += char;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        current += "*/";
        i += 1;
        continue;
      }
      current += char;
      continue;
    }
    if (dollarTag !== null) {
      if (script.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      current += char;
      continue;
    }
    if (inString) {
      // A doubled quote escapes itself; toggling twice handles it naturally.
      if (char === "'") inString = false;
      current += char;
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "$") {
      // Dollar-quoted string: $tag$ ... $tag$. Used by function bodies.
      const match = /^\$[A-Za-z_]*\$/.exec(script.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "-" && next === "-") {
      inLineComment = true;
      current += "--";
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      current += "/*";
      i += 1;
      continue;
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
