import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "@/adapters/db/driver";

/**
 * A real Postgres for the library suites, and a way to count what they ask it.
 *
 * `new PGlite()` with no argument is in-memory, so each suite gets a database
 * nobody else can see and none of them need cleaning up between tests. The
 * schema is the project's own `schema.sql` rather than a fixture — a harness
 * with its own idea of the tables tests the harness.
 *
 * Deliberately separate from the shared `harness.ts` another lane is writing;
 * a later pass folds the two together. Duplicating it now is cheaper than two
 * lanes editing one file at once.
 */

/* ---------------------------------------------------------- the database -- */

class HarnessDatabase implements SqlDatabase {
  constructor(private readonly db: PGlite) {}

  async query<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    const result = await this.db.query<T>(sql, [...params]);
    return result.rows;
  }

  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<number> {
    const result = await this.db.query(sql, [...params]);
    return result.affectedRows ?? 0;
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.db.query("begin");
    try {
      const out = await fn(this);
      await this.db.query("commit");
      return out;
    } catch (error) {
      await this.db.query("rollback").catch(() => {
        /* The original error is the interesting one. */
      });
      throw error;
    }
  }

  async migrate(): Promise<void> {
    // `fileURLToPath`, not `.pathname`: this repository lives under a directory
    // with a space in its name, which `.pathname` percent-encodes into a path
    // that resolves to nothing.
    const schemaPath = fileURLToPath(
      new URL("../../db/schema.sql", import.meta.url),
    );
    await this.db.exec(await readFile(schemaPath, "utf8"));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export async function createTestDatabase(): Promise<SqlDatabase> {
  const db = new HarnessDatabase(new PGlite());
  await db.migrate();
  return db;
}

/* ----------------------------------------------------------- the counter -- */

/**
 * Counts statements, so a test can assert *how* a result was fetched rather
 * than only what it contains.
 *
 * This exists because the N+1 version of every feed query in this slice returns
 * byte-identical output to the joined version. A test that asserts the rows are
 * right passes just as happily against forty-one round trips as against one,
 * which means the expensive mistake is precisely the one the suite cannot see.
 *
 * Only `query` and `execute` are counted, not `begin`/`commit` — the unit of
 * interest is statements the repository chose to send, and transaction
 * bookkeeping is the driver's.
 */
export interface QueryCounter {
  /** Statements issued since the last {@link reset}, in order. */
  readonly statements: readonly string[];
  readonly count: number;
  reset(): void;
}

export function countingDatabase(
  inner: SqlDatabase,
): SqlDatabase & QueryCounter {
  const statements: string[] = [];

  const record = <T>(sql: string, run: () => Promise<T>): Promise<T> => {
    statements.push(collapse(sql));
    return run();
  };

  const counting: SqlDatabase & QueryCounter = {
    query: (sql, params) => record(sql, () => inner.query(sql, params)),
    execute: (sql, params) => record(sql, () => inner.execute(sql, params)),
    transaction: (fn) =>
      inner.transaction((tx) =>
        fn({
          query: (sql, params) => record(sql, () => tx.query(sql, params)),
          execute: (sql, params) => record(sql, () => tx.execute(sql, params)),
        }),
      ),
    migrate: () => inner.migrate(),
    close: () => inner.close(),
    get statements() {
      return statements;
    },
    get count() {
      return statements.length;
    },
    reset() {
      statements.length = 0;
    },
  };

  return counting;
}

/** Whitespace-collapsed, so a failure prints one readable line per statement. */
function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------- fixtures -- */

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

/**
 * A distinct timestamp per seeded row, a second apart and counting forwards.
 *
 * Not `new Date()`. PGlite's `now()` resolves only to milliseconds where real
 * Postgres resolves to microseconds, so rows seeded back-to-back share a
 * timestamp locally and do not on Neon — which makes an exact-order assertion
 * flake in development and pass in production. Every ordering query in this
 * slice carries a unique tiebreaker for that reason, and the fixtures give it
 * nothing to tiebreak: an order that comes out wrong here is a query bug, not
 * a clock artefact.
 */
const FIXTURE_EPOCH = Date.UTC(2026, 0, 1);
const nextTimestamp = (): Date => new Date(FIXTURE_EPOCH + ++sequence * 1_000);

export async function seedUser(
  sql: SqlExecutor,
  overrides: { id?: string; displayName?: string; email?: string } = {},
): Promise<string> {
  const id = overrides.id ?? nextId("user");
  await sql.execute(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'x', $3)`,
    [
      id,
      overrides.email ?? `${id}@example.test`,
      overrides.displayName ?? `Person ${id}`,
    ],
  );
  return id;
}

export async function seedChannel(
  sql: SqlExecutor,
  ownerId: string,
  overrides: {
    id?: string;
    handle?: string;
    name?: string;
    avatarKey?: string | null;
  } = {},
): Promise<string> {
  const id = overrides.id ?? nextId("channel");
  await sql.execute(
    `insert into channels (id, owner_id, handle, name, avatar_key)
     values ($1, $2, $3, $4, $5)`,
    [
      id,
      ownerId,
      overrides.handle ?? id,
      overrides.name ?? `Channel ${id}`,
      overrides.avatarKey === undefined ? `${id}/avatar.jpg` : overrides.avatarKey,
    ],
  );
  return id;
}

/**
 * A published, public, ready video — the state every feed query filters for.
 * Anything else a test needs (draft, private, short) is an override, so the
 * default case reads as one line and the interesting case reads as its
 * difference from it.
 */
export async function seedVideo(
  sql: SqlExecutor,
  channelId: string,
  overrides: {
    id?: string;
    title?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    isShort?: boolean;
    viewCount?: number;
    visibility?: string;
    uploadStatus?: string;
    publishedAt?: Date | null;
  } = {},
): Promise<string> {
  const id = overrides.id ?? nextId("video");
  await sql.execute(
    `insert into videos (id, channel_id, title, duration_seconds, width, height,
                         is_short, view_count, visibility, upload_status,
                         thumbnail_key, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      channelId,
      overrides.title ?? `Video ${id}`,
      overrides.durationSeconds ?? 600,
      overrides.width ?? 1920,
      overrides.height ?? 1080,
      overrides.isShort ?? false,
      overrides.viewCount ?? 0,
      overrides.visibility ?? "public",
      overrides.uploadStatus ?? "ready",
      `${id}/thumb.jpg`,
      overrides.publishedAt === undefined
        ? nextTimestamp().toISOString()
        : (overrides.publishedAt?.toISOString() ?? null),
    ],
  );
  return id;
}

/** A user with a channel, which is what most of these suites actually need. */
export async function seedCreator(
  sql: SqlExecutor,
  overrides: { handle?: string; name?: string } = {},
): Promise<{ userId: string; channelId: string }> {
  const userId = await seedUser(sql);
  const channelId = await seedChannel(sql, userId, overrides);
  return { userId, channelId };
}
