import "server-only";

import { getDb } from "@/adapters/db";
import { config } from "@/config/env";

/**
 * First-use boot: apply the schema on the embedded database.
 *
 * The zero-config promise (SPEC §2) is that `pnpm install && pnpm run dev`
 * against an empty environment gives a working app. PGlite has no separate
 * provisioning step, so the first server entry point that touches data
 * applies `schema.sql` — every statement in it is idempotent.
 *
 * On Neon the schema is applied by `scripts/db-push.ts` from the build
 * command, and this step is skipped: a serverless function that migrates on
 * first request migrates once per cold start, from however many instances
 * happen to be warming, and each of those is a round trip per statement in a
 * request's critical path.
 *
 * There is nothing to seed. The campaign levels are TypeScript literals
 * under `src/content/levels`; the weekly-challenge pool reads them from code
 * and unions them with the `maps` table at request time (D38).
 *
 * Memoised on `globalThis` for the same reason the database handle is: Next
 * evaluates several module graphs per app, and a module-scoped promise would
 * be one promise *per graph* — several concurrent migrations against one
 * PGlite, which is how its WAL gets corrupted.
 */
const READY = Symbol.for("island-empire.ready");

interface Registry {
  [READY]?: Promise<void>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

async function boot(): Promise<void> {
  const db = getDb();
  if (config().db.driver === "pglite") {
    await db.migrate();
  }
}

/**
 * Ensure the database is usable, once per process.
 *
 * Failures are not cached: a boot that fails because Postgres was briefly
 * unreachable is retried by the next request rather than poisoning the
 * process until it restarts.
 */
export function ensureReady(): Promise<void> {
  const existing = registry()[READY];
  if (existing) return existing;

  const promise = boot().catch((error: unknown) => {
    delete registry()[READY];
    throw error;
  });
  registry()[READY] = promise;
  return promise;
}

/** Drop the memoised boot. Tests only. */
export function resetReadyForTests(): void {
  delete registry()[READY];
}
