import "server-only";

import { config } from "@/config/env";

import type { SqlDatabase } from "./driver";

export type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "./driver";
export { PG_ERROR, isPgError } from "./driver";

/**
 * The one database handle, resolved on first use and memoised for the life of
 * the process.
 *
 * Memoised on a module-level promise rather than a value, so that two requests
 * arriving before the first has finished booting share one instance instead of
 * racing to create two — PGlite in particular would otherwise open the same
 * data directory twice.
 */
let instance: Promise<SqlDatabase> | null = null;

export function database(): Promise<SqlDatabase> {
  instance ??= create();
  return instance;
}

async function create(): Promise<SqlDatabase> {
  const { dbDriver, env } = config();

  const db =
    dbDriver === "neon"
      ? await (await import("./neon")).createNeonDatabase(env.DATABASE_URL!)
      : await (await import("./pglite")).createPGliteDatabase(env.DB_DATA_DIR);

  await db.migrate();

  /**
   * The consumer `SEED_DEMO_DATA` never had.
   *
   * It is set by `playwright.config.ts` and was parsed by `config/env.ts` and
   * read by nothing, so the e2e database — `:memory:`, therefore empty on
   * every boot — stayed empty while the config described a shared library for
   * specs to act on. Seeding here rather than in a script is what makes it
   * work at all: the suite's database lives in the server process, so there is
   * no moment between `next start` and the first request when an external
   * script could reach it.
   *
   * Guarded twice. The flag is off unless something sets it, and `seedDemoData`
   * itself returns early when its first video is already present, so a
   * persistent `DB_DATA_DIR` does not accumulate a second corpus per restart.
   */
  if (env.SEED_DEMO_DATA) {
    const { seedDemoData } = await import("./seed-e2e");
    await seedDemoData(db);
  }

  return db;
}

/** Tests only. */
export async function closeDatabaseForTests(): Promise<void> {
  if (!instance) return;
  const db = await instance;
  instance = null;
  await db.close();
}
