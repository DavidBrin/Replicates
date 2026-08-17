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
  return db;
}

/** Tests only. */
export async function closeDatabaseForTests(): Promise<void> {
  if (!instance) return;
  const db = await instance;
  instance = null;
  await db.close();
}
