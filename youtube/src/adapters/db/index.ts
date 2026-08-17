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
 * the **process** — not of the module.
 *
 * Memoised on a promise rather than a value, so that two requests arriving
 * before the first has finished booting share one instance instead of racing
 * to create two.
 *
 * ## Why the memo lives on `globalThis`
 *
 * It was a module-level `let`, which is the obvious way to write this and is
 * wrong under Next. Next compiles server components and route handlers into
 * **separate module graphs**, so `adapters/db/index.ts` is instantiated more
 * than once in a single server process and a module-level binding gives each
 * graph its own copy.
 *
 * With a file-backed database that is merely wasteful — two connections to the
 * same Postgres. With `DB_DATA_DIR=":memory:"`, which is what the e2e suite
 * runs, it is fatal and silent: the sign-in **route** wrote its `sessions` row
 * into one in-memory database, and the page **layout** that renders the
 * masthead read from another. Signing in returned 200 with a valid cookie,
 * every API call authenticated with it, and every rendered page said "Sign
 * in". Three hours of that failure looks exactly like a cookie problem, which
 * is where it sends you.
 *
 * `globalThis` is the standard escape hatch for this in Next and is why every
 * database-client guide for the framework tells you to hang the client off it.
 * The symbol is unique to this module so nothing else can collide with it.
 */
const DATABASE_MEMO = Symbol.for("youtube-clone.database");

interface GlobalWithDatabase {
  [DATABASE_MEMO]?: Promise<SqlDatabase>;
}

export function database(): Promise<SqlDatabase> {
  const store = globalThis as GlobalWithDatabase;
  store[DATABASE_MEMO] ??= create();
  return store[DATABASE_MEMO];
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
  const store = globalThis as GlobalWithDatabase;
  const pending = store[DATABASE_MEMO];
  if (!pending) return;
  delete store[DATABASE_MEMO];
  await (await pending).close();
}
