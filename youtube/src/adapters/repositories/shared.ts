import "server-only";

/**
 * The parts every repository needs and none of them should own.
 *
 * Four jobs: turning driver values into domain values, generating ids, holding
 * the optional-executor convention in one place, and translating the Postgres
 * error codes that are actually domain events into domain errors.
 *
 * ## Why the coercions exist at all
 *
 * Both engines return *typed* values rather than strings, and the types they
 * choose are not the ones `domain/types.ts` uses:
 *
 * - `timestamptz` arrives as a JavaScript `Date` under PGlite. Neon's HTTP
 *   client parses it too, but the pool and the HTTP path have historically
 *   disagreed about a handful of types, so nothing here assumes a `Date` — it
 *   accepts a `Date`, a string or an epoch and produces a `Date`.
 * - `bigint` columns — `count(*)`, `view_count`, `like_count` — are a `number`
 *   in PGlite (measured: `select count(*)` came back `typeof "number"`) and a
 *   decimal *string* in Neon, because a 64-bit integer does not fit a double
 *   and the driver refuses to lie about it. Every count in this schema is
 *   comfortably inside `Number.MAX_SAFE_INTEGER`, so they are parsed rather
 *   than carried as bigints — a `bigint` would poison every arithmetic
 *   expression and every `JSON.stringify` downstream of it.
 *
 * A repository that reads `row.created_at` directly works locally and breaks on
 * the one column where the two drivers differ. Going through these functions is
 * the only way that difference gets caught, and it gets caught with a
 * `TypeError` naming the column rather than an `Invalid Date` three layers up.
 */

import { randomBytes } from "node:crypto";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "@/adapters/db/driver";
import { PG_ERROR, isPgError } from "@/adapters/db/driver";

/* ============================================================ coercions == */

/** A required text column. */
export function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value === "string") return value;
  if (value === null || value === undefined) {
    throw new TypeError(`Expected ${column} to be text, got ${String(value)}`);
  }
  return String(value);
}

export function nullableText(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

/**
 * A numeric column, including `bigint` ones.
 *
 * `Number(value)` rather than a `typeof` branch because the same column is a
 * number from one driver and a string from the other; the conversion has to
 * happen somewhere and doing it once here is the difference between a count
 * that sorts numerically and one that sorts `"10" < "9"`.
 */
export function num(row: SqlRow, column: string): number {
  const value = row[column];
  // `Number(null)` is `0` and `Number("")` is `0`, so the finite check below
  // cannot catch a missing column — a typo'd alias would arrive as a plausible
  // zero rather than as an error, and a subscriber count of zero is exactly the
  // kind of wrong answer nobody questions.
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`Expected ${column} to be a number, got ${String(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Expected ${column} to be a number, got ${String(value)}`);
  }
  return parsed;
}

export function nullableNum(row: SqlRow, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return num(row, column);
}

/**
 * A boolean column.
 *
 * `'t'` and `'true'` are in the list because a boolean that has been through
 * `json_build_object` or a `::text` cast arrives as one of them, and the
 * alternative — `Boolean("f")` — is `true`.
 */
export function bool(row: SqlRow, column: string): boolean {
  const value = row[column];
  return value === true || value === "t" || value === "true" || value === 1;
}

/** A `timestamptz`, as the domain's `Date`. */
export function timestamp(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Expected a timestamp, got ${String(value)}`);
    }
    return parsed;
  }
  throw new TypeError(`Expected a timestamp, got ${String(value)}`);
}

export function nullableTimestamp(value: unknown): Date | null {
  return value === null || value === undefined ? null : timestamp(value);
}

/**
 * A `json`/`jsonb` column.
 *
 * Both drivers parse these, but a `json_agg` over zero rows is SQL `null`
 * rather than `[]` unless the query coalesces it, and a column written by hand
 * can still be a string. Tolerating all three costs four lines and removes the
 * class of "cannot read properties of null" that only shows up once the demo
 * data contains a video with no tags on it.
 */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/* ============================================================== helpers == */

/**
 * The first row, or `undefined`.
 *
 * `noUncheckedIndexedAccess` already makes `rows[0]` possibly-undefined, so
 * this buys nothing from the compiler. It buys the reader a name: `first(rows)`
 * at a call site says "at most one row was expected", which `rows[0]` does not.
 */
export function first<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

/** `$3, $4, $5` — for an `in (…)` whose values are bound separately. */
export function placeholders(count: number, start = 1): string {
  return Array.from(
    { length: count },
    (_, index) => `$${start + index}`,
  ).join(", ");
}

/**
 * Escape a value being used as a `like` *prefix*.
 *
 * `_` matches any single character in `like`, and `_` is a legal character in a
 * channel handle — so an unescaped prefix search for `ada_x` also matches
 * `adaXx`. That is not a cosmetic difference: the handle allocator uses this to
 * find the family of handles already taken, and a false positive there silently
 * skips a handle that was actually free.
 *
 * Pair it with `escape '\'` in the statement.
 */
export function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * An application-generated id.
 *
 * The schema's header explains why ids are text rather than uuids: an id that
 * appears in a URL has a shape, and a video id is eleven characters because
 * that is what sits in `/watch?v=`. Those shapes belong to the modules that own
 * those tables. This is the default for everything else — a short prefix so a
 * row is identifiable at a glance in a diagnostic query, and 96 bits of
 * randomness, which is more than enough for a table that will never hold more
 * than a few million rows and cheap enough to generate per insert.
 *
 * `randomBytes` rather than `nanoid`, which is also a dependency here: this
 * module is imported by every repository, and `node:crypto` is already in the
 * graph for password hashing and session ids. `nanoid`'s alphabet includes `-`,
 * which is fine in a URL and irritating in a hand-typed diagnostic query.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** The executor to read through: the caller's transaction, or the pool. */
export function reader(db: SqlDatabase, tx?: SqlExecutor): SqlExecutor {
  return tx ?? db;
}

/**
 * Run `fn` atomically.
 *
 * A caller that supplied an executor already owns the transaction boundary, so
 * this joins it rather than opening a second one — the driver documents that
 * nesting joins rather than taking a savepoint, and a savepoint that silently
 * does nothing would be worse than an honest absence.
 *
 * The consequence is worth stating because it is invisible at the call site:
 * passing the *pool* as `tx` is indistinguishable from passing a transaction,
 * and gets no atomicity at all.
 */
export async function atomically<T>(
  db: SqlDatabase,
  tx: SqlExecutor | undefined,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  if (tx) return fn(tx);
  return db.transaction(fn);
}

/* =============================================================== errors == */

/**
 * A uniqueness rule the caller broke.
 *
 * `field` is the domain's name for it — `email`, `handle` — not the index's, so
 * a sign-up form can decide what to say without knowing what `schema.sql` calls
 * its indexes.
 *
 * Whether to *relay* this to an anonymous caller is the route's decision, not
 * the repository's: telling a stranger that an address is registered is an
 * account-enumeration oracle in exactly the way that
 * `lib/auth/password.ts`'s decoy exists to close. The repository's job is to be
 * precise; the boundary's job is to decide how much precision to publish.
 */
export class DuplicateError extends Error {
  constructor(
    readonly entity: string,
    readonly field: string,
    readonly value: string,
  ) {
    super(`A ${entity} with that ${field} already exists.`);
    this.name = "DuplicateError";
  }
}

/**
 * Run `fn`, turning a named unique-index violation into a {@link DuplicateError}.
 *
 * Keyed by index name rather than by "whatever unique violation came out of
 * this statement", and the difference matters. Every table here has a text
 * primary key generated by {@link newId}; a collision on *that* is not a domain
 * event, it is 96 bits of randomness having failed or an id having been reused,
 * and reporting it as "that handle is taken" would bury the only interesting
 * bug in the file. An unrecognised constraint is rethrown untouched.
 *
 * **Measured:** PGlite 0.5.5 puts the index name on `error.constraint`
 * (`users_email_key` for a duplicate address). The `pg` error shape Neon's
 * driver reuses carries the same field. If a future driver drops it, the
 * fallback is a rethrow — loud, and in the direction that gets noticed.
 */
export async function translatingUniqueViolations<T>(
  constraints: Readonly<Record<string, { entity: string; field: string }>>,
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) throw error;
    const name = (error as { constraint?: unknown }).constraint;
    const mapped = typeof name === "string" ? constraints[name] : undefined;
    if (!mapped) throw error;
    throw new DuplicateError(mapped.entity, mapped.field, value);
  }
}

/* =============================================================== params == */

/**
 * A parameter list under construction, for the statements that are assembled
 * rather than written out — a partial `update` being the only one so far.
 *
 * `bind` returns the placeholder for the value it just pushed, so a `$n` cannot
 * name a parameter that was never added. Writing `$4` by hand in a clause that
 * is conditionally included is how a partial update ends up setting the wrong
 * column, and it is a bug the type checker cannot see.
 */
export class Params {
  readonly values: SqlValue[] = [];

  bind(value: SqlValue): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  bindAll(values: readonly SqlValue[]): string {
    return values.map((value) => this.bind(value)).join(", ");
  }
}
