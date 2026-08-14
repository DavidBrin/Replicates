import "server-only";

import { config } from "@/config/env";

import type { SqlDatabase } from "./driver";
import { NeonDatabase } from "./neon";
import { PgliteDatabase } from "./pglite";
import { SCHEMA_SQL } from "./schema";

export type { SqlDatabase, SqlExecutor, SqlRow, SqlValue } from "./driver";
export { NeonDatabase } from "./neon";
export { PgliteDatabase } from "./pglite";
export { SCHEMA_SQL } from "./schema";

/**
 * The database composition point: one connection string, two adapters.
 *
 * Both speak Postgres, so this is a deployment choice rather than a semantic
 * one — nothing above this module can tell which is in use, and that is the
 * property that makes the local test suite meaningful.
 */

/**
 * The handle is memoised on `globalThis`, not in a module-level `let`.
 *
 * Next builds several module graphs per app — server components, route
 * handlers, server actions — and evaluates them separately, so a module-scoped
 * singleton is a singleton *per graph*, not per process. With PGlite that
 * means several WASM Postgres instances against one data directory, which is
 * how you corrupt its WAL; with Neon it means several pools. The sibling
 * project `dollar-pixels` hit exactly this, and Better Auth's memory adapter
 * is broken in the App Router for the same reason
 * (`research/06-stack-deployment.md` §5).
 *
 * `Symbol.for` puts the key in the cross-realm registry so every graph agrees
 * on it.
 */
const REGISTRY = Symbol.for("linear-clone.db");

interface Registry {
  [REGISTRY]?: SqlDatabase;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

/** The database for this process. */
export function getDb(): SqlDatabase {
  const existing = registry()[REGISTRY];
  if (existing) return existing;

  const { db } = config();
  const database =
    db.driver === "neon"
      ? // `db.url` is non-null here: `config()` refuses to build a config with
        // `driver: "neon"` and no URL, so this cannot be a silent fallback.
        new NeonDatabase(db.url!, SCHEMA_SQL)
      : new PgliteDatabase(db.dataDir, SCHEMA_SQL);

  registry()[REGISTRY] = database;
  return database;
}

/**
 * Replace the process's database, returning a disposer.
 *
 * Used by tests that want an isolated in-memory instance per file. Deliberately
 * not exported from anywhere the application can reach.
 */
export function setDbForTests(database: SqlDatabase): () => Promise<void> {
  const previous = registry()[REGISTRY];
  registry()[REGISTRY] = database;
  return async () => {
    await database.close();
    if (previous) registry()[REGISTRY] = previous;
    else delete registry()[REGISTRY];
  };
}

/** Drop the memoised handle without closing it. */
export function resetDbForTests(): void {
  delete registry()[REGISTRY];
}
