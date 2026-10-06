import "server-only";

import { getDb } from "@/adapters/db";
import type { SqlDatabase } from "@/adapters/db/driver";
import { config } from "@/config/env";

import { withErrors } from "./http";

/**
 * Applying `schema.sql` on first boot, for PGlite only (SPEC §6.2).
 *
 * §6.2 says the schema is applied "by `pnpm run db:push` … and by the PGlite
 * adapter on first boot", and the first half is real — `vercel.json`'s build
 * command runs it against Neon before a deployment goes live. The second half
 * had no implementation: `getDb()` constructs the adapter with `SCHEMA_SQL`
 * but never calls `migrate()`, so a fresh clone's `pnpm run dev` answered
 * every request with `relation "players" does not exist`. §6.1's promise that
 * `npm install && npm run dev` gives you an online game between two browser
 * windows depends on closing that gap.
 *
 * It is closed here rather than in the adapter because
 * `src/adapters/db/{driver,index,neon,pglite}.ts` are S0's files (F24), and
 * because the decision of *when* to migrate is a request-path concern:
 *
 * - **PGlite**: migrate once per process. It is embedded, single-writer and
 *   local, so there is exactly one instance and the cost is one pass over an
 *   idempotent script.
 * - **Neon**: never. A function that migrates on first request migrates once
 *   per cold start, from however many instances happen to be warming at the
 *   time — which is the race `scripts/db-push.ts` exists to avoid by running
 *   in the build, where Hobby's single concurrent build makes it race-free.
 *
 * Memoised **per database instance**, not per process: the route suites swap
 * in a fresh `:memory:` database per file, and a process-wide flag would skip
 * migrating every one after the first.
 */

const BOOT_KEY = Symbol.for("risk.schemaApplied");

interface Registry {
  [BOOT_KEY]?: WeakMap<SqlDatabase, Promise<void>>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

/** Apply the schema if this process has not already applied it to this db. */
export async function ensureSchema(): Promise<void> {
  if (config().db.driver !== "pglite") return;

  const db = getDb();
  const applied = (registry()[BOOT_KEY] ??= new WeakMap<SqlDatabase, Promise<void>>());
  const existing = applied.get(db);
  if (existing) return existing;

  const running = db.migrate().catch((error: unknown) => {
    // A failed migration must not be remembered as done: the next request
    // tries again rather than serving a database with no tables in it.
    applied.delete(db);
    throw error;
  });
  applied.set(db, running);
  return running;
}

/**
 * The outermost frame of every route that touches the database: apply the
 * schema if it is not there, then run the handler under {@link withErrors}.
 *
 * One wrapper rather than one line at the top of fourteen handlers, so a new
 * route cannot forget it and answer `relation "players" does not exist`.
 */
export async function withDb(run: () => Promise<Response>): Promise<Response> {
  return withErrors(async () => {
    await ensureSchema();
    return run();
  });
}
