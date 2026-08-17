/**
 * The repository suites' database.
 *
 * Every test under `src/adapters/repositories` runs against a **real Postgres**
 * — PGlite 0.5.5, which reports `PostgreSQL 18.3` — with `schema.sql` applied
 * to it, rather than against a mocked `SqlDatabase`. A mock would assert that a
 * repository calls the methods the test expects it to call, which is a
 * restatement of the implementation dressed as a test. The things actually
 * worth knowing are whether the SQL parses, whether `lower(email)` really does
 * hit `users_email_key`, whether a `check` constraint fires, whether a partial
 * unique index is partial in the way we think, and whether a transaction rolls
 * back everything it should. None of those survive a mock.
 *
 * The database is booted through `createPGliteDatabase`, the same adapter the
 * application uses, rather than by constructing `PGlite` here — so the
 * transaction queue, the parameter marshalling and the schema loader are all
 * under test too. A harness that reimplements the adapter is a harness that can
 * pass while the adapter is broken.
 *
 * ## Using it
 *
 * ```ts
 * // @vitest-environment node
 * import { setupTestDatabase } from "./harness";
 *
 * const t = setupTestDatabase();
 *
 * it("does a thing", async () => {
 *   await t.db.query("select 1");
 * });
 * ```
 *
 * `setupTestDatabase`, not the `useTestDatabase` this pattern is usually
 * called, and the name is not a matter of taste:
 * `eslint-config-next` enforces `react-hooks/rules-of-hooks`, which
 * treats any `useX()` called at module scope as a misplaced React hook — so the
 * nicer name would have put a lint error in every one of the six suites that
 * import this, and each of them would have had to suppress it.
 *
 * The `// @vitest-environment node` pragma is not optional. PGlite's WASM
 * loader and `jose`'s webapi build both misbehave under jsdom, and the failure
 * is an unrelated-looking module error rather than anything that names the
 * environment.
 *
 * ## One instance per file, wiped between tests
 *
 * Booting costs roughly half a second, so the instance is per *file*
 * (`beforeAll`) and every table is truncated between tests (`beforeEach`).
 * Truncating is a few milliseconds against an empty database and it is the safe
 * default: a test that leaks rows into the next one fails somewhere else, often
 * only when the file order changes, whereas a fixture wiped by an unexpected
 * truncate fails immediately and in the test that built it.
 *
 * A suite that genuinely wants one fixture for the whole file passes
 * `{ truncateBetweenTests: false }` and owns the consequences.
 */

import { afterAll, beforeAll, beforeEach } from "vitest";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "@/adapters/db/driver";
import { createPGliteDatabase } from "@/adapters/db/pglite";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { createUsersRepository } from "@/adapters/repositories/users";
import { newId } from "@/adapters/repositories/shared";
import type { Channel, User } from "@/domain/types";

/**
 * A booted, migrated, empty database.
 *
 * `:memory:` is what `createPGliteDatabase` translates into "construct `PGlite`
 * with no data directory". Two files therefore cannot see each other's rows,
 * and nothing survives the process — which also means a failed run leaves no
 * state for the next one to inherit and be confused by.
 */
export async function createTestDatabase(): Promise<SqlDatabase> {
  const db = await createPGliteDatabase(":memory:");
  await db.migrate();
  return db;
}

export interface TestDatabase {
  /** Throws rather than returning `undefined` before `beforeAll` has run. */
  readonly db: SqlDatabase;
}

export interface TestDatabaseOptions {
  /** Default `true`. See the note above before turning it off. */
  readonly truncateBetweenTests?: boolean;
}

/**
 * Register the lifecycle hooks and hand back a live reference.
 *
 * Returns an object with a getter rather than the database itself, because the
 * database does not exist yet when the suite body runs — `beforeAll` has not
 * fired. A plain `let db` in the suite would be `undefined` at import time and
 * `noUncheckedIndexedAccess`-style discipline would push every test into a
 * non-null assertion.
 */
export function setupTestDatabase(
  options: TestDatabaseOptions = {},
): TestDatabase {
  let database: SqlDatabase | null = null;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  if (options.truncateBetweenTests !== false) {
    beforeEach(async () => {
      if (database) await truncateAll(database);
    });
  }

  afterAll(async () => {
    const closing = database;
    database = null;
    await closing?.close();
  });

  return {
    get db(): SqlDatabase {
      if (!database) {
        throw new Error(
          "The test database is not booted yet. `setupTestDatabase()` registers " +
            "a `beforeAll` hook, so `.db` is only available inside a test or a " +
            "`beforeEach`, never in the suite body.",
        );
      }
      return database;
    },
  };
}

/**
 * Empty every table, in one statement.
 *
 * The table list is read from `pg_tables` rather than written out, because
 * `schema.sql` is shared by seven slices and is still growing — a hard-coded
 * list would fall behind silently, and the tables it forgot are exactly the new
 * ones whose tests are being written. `cascade` handles the foreign keys and
 * `restart identity` resets `watch_events.id`, which is a `bigserial` and would
 * otherwise make sequence-dependent assertions depend on test order.
 */
export async function truncateAll(db: SqlDatabase): Promise<void> {
  const rows = await db.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await db.execute(`truncate table ${tables} restart identity cascade`);
}

/* ============================================================= fixtures == */

/**
 * A user, written directly.
 *
 * `password_hash` is a placeholder rather than a real scrypt hash: hashing
 * costs ~200 ms by design, and a suite about playlists or comments that needs
 * four users to hang foreign keys off should not pay most of a second for
 * credentials it will never check. Anything that *is* about credentials should
 * go through `createUsersRepository(db).create`, which hashes properly.
 *
 * The stored value is deliberately not a valid encoded hash, so that a test
 * which accidentally tries to sign in as one of these users fails rather than
 * finding some unintended equivalence.
 */
export async function createTestUser(
  db: SqlDatabase,
  overrides: {
    readonly email?: string;
    readonly displayName?: string;
    readonly exec?: SqlExecutor;
  } = {},
): Promise<User> {
  const id = newId("usr");
  const email = overrides.email ?? `${id}@test.local`;
  const displayName = overrides.displayName ?? email.split("@")[0] ?? id;
  const exec = overrides.exec ?? db;
  const rows = await exec.query<Record<string, unknown>>(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'not-a-hash', $3)
     returning id, email, display_name, created_at`,
    [id, email, displayName],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to insert the test user.");
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    displayName: String(row["display_name"]),
    createdAt: new Date(row["created_at"] as string),
  };
}

/**
 * A user and the channel they own.
 *
 * The common shape for every slice downstream of this one: a video, a comment,
 * a playlist item and a subscription all need a channel, and a channel needs an
 * owner. Built through the channels repository rather than by insert, so a
 * fixture that stops matching the schema fails in the fixture rather than three
 * assertions later.
 */
export async function createTestChannel(
  db: SqlDatabase,
  overrides: {
    readonly ownerId?: string;
    readonly handle?: string;
    readonly name?: string;
  } = {},
): Promise<Channel> {
  const ownerId = overrides.ownerId ?? (await createTestUser(db)).id;
  const handle = overrides.handle ?? newId("ch").toLowerCase().replace(/_/g, "");
  return createChannelsRepository(db).create({
    ownerId,
    handle,
    name: overrides.name ?? handle,
  });
}

/**
 * A registered account: user, channel and both system playlists, through the
 * real sign-up path.
 *
 * This one *does* hash, because it is the real path. Use it when the test is
 * about what sign-up produces; use {@link createTestUser} when it is about
 * something else entirely.
 */
export async function registerTestAccount(
  db: SqlDatabase,
  input: {
    readonly email: string;
    readonly password?: string;
    readonly displayName?: string;
    readonly handle?: string;
  },
): Promise<{ user: User; channel: Channel }> {
  return createUsersRepository(db).register({
    email: input.email,
    password: input.password ?? "correct-horse-battery-staple",
    displayName: input.displayName ?? input.email.split("@")[0] ?? input.email,
    ...(input.handle === undefined ? {} : { handle: input.handle }),
  });
}

/**
 * An executor that counts the statements sent through it.
 *
 * The point of the counts on `Channel` is that they arrive without an N+1, and
 * "without an N+1" is a claim about the number of round trips — which no
 * assertion about the *returned data* can check. Passing this in as the
 * optional trailing executor makes the claim testable directly.
 */
export function countingExecutor(exec: SqlExecutor): SqlExecutor & {
  readonly statements: readonly string[];
} {
  const statements: string[] = [];
  return {
    statements,
    query: <T extends SqlRow = SqlRow>(
      sql: string,
      params?: readonly SqlValue[],
    ): Promise<T[]> => {
      statements.push(sql);
      return exec.query<T>(sql, params);
    },
    execute: (sql: string, params?: readonly SqlValue[]): Promise<number> => {
      statements.push(sql);
      return exec.execute(sql, params);
    },
  };
}
