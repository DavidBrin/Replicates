/**
 * Driver selection for the Postgres adapter: one `DATABASE_URL`, two
 * engines, one SQL dialect.
 *
 * - `postgres://…` / `postgresql://…` → **Neon** over WebSockets
 *   (`drizzle-orm/neon-serverless`). Not `neon-http`: that driver's
 *   `transaction()` only accepts a pre-built array of statements, and
 *   `DataStore.transact` hands the caller an interactive view it can read
 *   from mid-transaction. WebSockets are also the only Neon transport that
 *   survives a Vercel function's lifecycle without a TCP pool.
 * - `file:…`, `memory://`, or a bare path → **PGlite**, Postgres itself
 *   compiled to WebAssembly (`drizzle-orm/pglite`). Same parser, same
 *   planner, same types as Neon, with no service to install — which is what
 *   lets the shared `DataStore` contract suite run against real Postgres in
 *   CI (`research/stack.md` §2).
 *
 * Both driver modules are loaded through `await import(...)`, and only the
 * selected one is ever evaluated: `drizzle-orm/pglite` statically imports
 * `@electric-sql/pglite` (~3 MB of WASM) and `drizzle-orm/neon-serverless`
 * statically imports `@neondatabase/serverless`, so a static import here
 * would pull both into every build — including the default, memory-only
 * one that never sets `DATABASE_URL` at all.
 */

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { SCHEMA_SQL, splitStatements, TABLE_NAMES } from "./ddl";

/**
 * A Drizzle handle every repo in this adapter accepts. `PgTransaction`
 * extends `PgDatabase`, so the same type covers both the root connection
 * and a transaction handle — which is what lets a repo be constructed
 * against either without knowing which it got.
 */
export type Db = PgDatabase<PgQueryResultHKT>;

export type PostgresDriver = "pglite" | "neon";

export interface PostgresConnection {
  readonly driver: PostgresDriver;
  readonly db: Db;
  /** Releases the pool / shuts down the embedded engine. */
  close(): Promise<void>;
}

/**
 * Which engine a `DATABASE_URL` names. Exported for the sake of diagnostics
 * and tests; `openPostgres` calls it itself.
 */
export function detectDriver(url: string): PostgresDriver {
  const trimmed = url.trim();
  return /^postgres(ql)?:\/\//i.test(trimmed) ? "neon" : "pglite";
}

/**
 * Normalises the PGlite half of the `DATABASE_URL` space to something
 * PGlite's constructor understands. PGlite accepts `memory://` and a bare
 * filesystem path (and `file://…`, which it strips); `research/stack.md`
 * documents the shorter single-slash `file:./.data/local.pglite` form, and
 * plain relative paths are the obvious thing to try, so both are folded
 * down to a bare path here rather than surfacing as an opaque PGlite error.
 */
export function pgliteDataDir(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed === ":memory:" || trimmed.startsWith("memory://")) {
    return "memory://";
  }
  const withoutScheme = trimmed.replace(/^file:(\/\/)?/, "");
  return withoutScheme === "" ? "memory://" : withoutScheme;
}

async function openPglite(url: string): Promise<PostgresConnection> {
  const dataDir = pgliteDataDir(url);
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");

  if (dataDir !== "memory://") {
    // PGlite creates its own data directory but not the parents of it, so a
    // default like `.data/local.pglite` fails with ENOENT on a fresh clone
    // where `.data` is gitignored and therefore never exists — and it fails
    // on the first query rather than at open, which reads like a broken app
    // rather than a missing directory.
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(dataDir), { recursive: true });
  }

  const client = new PGlite(dataDir);
  // `drizzle()` returns a `PgliteDatabase`, whose query-result HKT is
  // narrower than the base `PgQueryResultHKT` the repos are written
  // against. The two are structurally compatible — the HKT only appears in
  // return positions — but TypeScript will not infer that through the
  // higher-kinded parameter, so the one cast lives here rather than in
  // every repo.
  const db = drizzle(client) as unknown as Db;
  return {
    driver: "pglite",
    db,
    close: () => client.close(),
  };
}

async function openNeon(url: string): Promise<PostgresConnection> {
  const neon = await import("@neondatabase/serverless");
  // Node ≤21 has no global WebSocket; interactive Pool transactions need one.
  // Dynamic import keeps the memory-only / PGlite path free of the `ws` dep
  // at evaluation time when Neon is never selected.
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
    const ws = await import("ws");
    neon.neonConfig.webSocketConstructor = ws.default;
  }
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const pool = new neon.Pool({ connectionString: url });
  const db = drizzle(pool) as unknown as Db;
  return {
    driver: "neon",
    db,
    close: () => pool.end(),
  };
}

/** Opens the engine `url` names, without touching its schema. */
export async function openPostgres(url: string): Promise<PostgresConnection> {
  return detectDriver(url) === "neon" ? openNeon(url) : openPglite(url);
}

/**
 * Applies `SCHEMA_SQL`. Every statement is `IF NOT EXISTS`, so this is a
 * no-op against an already-migrated database and safe to run on every open
 * — which is what makes the PGlite path zero-ceremony (no migration step
 * between `DATABASE_URL=file:…` and a working app) and the Neon path
 * re-runnable from `pnpm db:push`.
 */
export async function applySchema(db: Db): Promise<void> {
  for (const statement of splitStatements(SCHEMA_SQL)) {
    try {
      await db.execute(sql.raw(statement));
    } catch (error) {
      throw new Error(`Schema statement failed: ${statement.slice(0, 140)}…`, {
        cause: error,
      });
    }
  }
}

/**
 * Empties every table. Test-only: nothing in the application calls this.
 * It exists so `drizzle-store.test.ts` can reuse one PGlite instance across
 * the whole contract suite instead of booting a fresh WebAssembly Postgres
 * (~0.3 s each) for every one of its ~25 cases.
 */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${TABLE_NAMES.join(", ")}`));
}
