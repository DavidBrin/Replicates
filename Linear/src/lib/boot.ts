import "server-only";

import { getDb } from "@/adapters/db";
import { config } from "@/config/env";
import { hashPassword } from "@/lib/auth/password";
import { seedDemoWorkspace } from "@/lib/seed";

/**
 * First-use boot: migrate, and optionally seed.
 *
 * This module exists to close a seam that no single slice owned. The seed
 * writes a `password_hash` and the sign-in route reads one — but they were
 * built independently, and they did not agree on the format. `seed.ts` shipped
 * its own scrypt with a `scrypt$N$r$p$salt$hash` layout and a deterministic
 * per-email salt; `auth/password.ts` writes `scrypt:N:r:p:keyLength:salt:hash`
 * with a random one and refuses anything it cannot parse. Both are reasonable
 * in isolation. Together they produce four demo accounts that exist, look
 * correct in the members table, and cannot be logged into.
 *
 * The seed anticipated this and made the hasher injectable. {@link ensureReady}
 * is the one place that injects it, so there is exactly one answer to "what
 * hashes a password in this application".
 *
 * ## Why boot at all
 *
 * The zero-config promise in `SPEC.md` §2 is that `npm install && npm run dev`
 * against an empty environment gives you a working app. That requires the
 * schema to exist before the first query, and PGlite has no separate
 * provisioning step to hang it off. So the first thing that needs the database
 * applies the schema.
 *
 * ## Why this is not how the deployment migrates
 *
 * On Neon the schema is applied by `scripts/db-push.ts` from the Vercel build
 * command, and this module's migration step is a no-op against an
 * already-migrated database. That split is deliberate: a serverless function
 * that migrates on first request migrates once per cold start, from however
 * many instances happen to be warming at the time. Here it is guarded by a
 * process-wide promise and by the driver check below, so a deployment reaches
 * it at most once per instance and finds nothing to do.
 */

/**
 * Memoised on `globalThis` for the same reason the database handle is: Next
 * evaluates several module graphs per app, and a module-scoped promise would
 * be one promise *per graph* — several concurrent migrations against one
 * database, which on PGlite is how you corrupt its WAL.
 */
const READY = Symbol.for("linear-clone.ready");

interface Registry {
  [READY]?: Promise<void>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

async function boot(): Promise<void> {
  const db = getDb();
  const { db: dbConfig, workspace } = config();

  // Applying the schema is idempotent, but on Neon it is also a round trip per
  // statement — ~76 of them, on a cold start, in a request's critical path.
  // The deployed path has already run `db:push` from the build, so skip it.
  if (dbConfig.driver === "pglite") {
    await db.migrate();
  }

  if (workspace.seedDemoData) {
    // The injection this module exists for.
    await seedDemoWorkspace(db, { hashPassword: (plain) => hashPassword(plain) });
  }
}

/**
 * Ensure the database is usable, once per process.
 *
 * Every server entry point that touches data should await this before its
 * first query. Failures are not cached: a boot that fails because Postgres was
 * briefly unreachable should be retried by the next request rather than
 * poisoning the process until it is restarted.
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
