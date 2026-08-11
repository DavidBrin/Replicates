/**
 * The store composition point: one environment variable, three adapters.
 *
 * `sqlite` is the default, so an empty environment gets a demo whose sales
 * survive a restart without anyone having to install or configure anything.
 * `memory` is what the test suite pins, because a unit suite that touched the
 * filesystem would carry state between runs. `postgres` is what a deployment
 * that must remember anything needs, because a file on disk is the one thing
 * Vercel guarantees not to keep (DECISIONS D13).
 */

import type { Store } from "@/ports";
import { getMemoryStore, storeRegistry } from "./memory";
import { PostgresStore } from "./postgres";
import { SqliteStore, sqlitePath } from "./sqlite";

export {
  MemoryStore,
  createMemoryStore,
  getMemoryStore,
  resetStoreForTests,
} from "./memory";
export { PostgresStore } from "./postgres";
export { SqliteStore, sqlitePath, DEFAULT_SQLITE_PATH } from "./sqlite";

export type StoreDriver = "memory" | "sqlite" | "postgres";

const STORE_DRIVERS: readonly StoreDriver[] = ["memory", "sqlite", "postgres"];

/**
 * Read the driver, normalising case and whitespace, and refuse anything else.
 *
 * The previous form fell through to the default for any value it did not
 * recognise, so `STORE_DRIVER=Postgres` — or `postgresql`, or a trailing space
 * — booted quietly on a different adapter than the operator asked for. The
 * `DATABASE_URL` guard below never fired, because the misspelling never reached
 * the postgres branch, and a deployment served traffic while forgetting every
 * purchase on each cold start. That is precisely the silent failure this module
 * claims to refuse.
 *
 * Same bug class as the `PAYMENT_PROVIDER` one (DECISIONS D26): one variable,
 * read two ways, disagreeing about what it said.
 */
export function storeDriver(): StoreDriver {
  const raw = process.env.STORE_DRIVER;
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "sqlite";
  const match = STORE_DRIVERS.find((driver) => driver === value);
  if (!match) {
    throw new Error(
      `Unknown STORE_DRIVER "${raw}". Expected one of ${STORE_DRIVERS.join(", ")}.`,
    );
  }
  return match;
}

/**
 * `StoreRegistry` in `memory.ts` predates this driver. Widening it here keeps
 * every adapter memoised on the one `globalThis` entry — and keeps
 * `resetStoreForTests`, which deletes that entry wholesale, dropping all three.
 */
type Registry = ReturnType<typeof storeRegistry> & { sqlite?: Store };

/**
 * The store for this process.
 *
 * All three adapters are memoised on the same `globalThis` registry: the memory
 * one because a fresh `Map` per module evaluation would lose every purchase on
 * the next Fast Refresh, the SQLite one because a fresh `DatabaseSync` per
 * module evaluation opens a file handle nobody closes, and the Postgres one
 * because a fresh `Pool` does the same with connections
 * (`research/persistence-and-vercel.md` §4).
 */
export function getStore(): Store {
  const driver = storeDriver();
  if (driver === "memory") return getMemoryStore();

  const registry = storeRegistry() as Registry;
  if (driver === "sqlite") {
    // The file and its parent directory are created on first use, not here:
    // constructing a store must stay free of side effects, because Next
    // constructs one per module graph.
    return (registry.sqlite ??= new SqliteStore(sqlitePath()));
  }

  if (!registry.postgres) {
    const connectionString = process.env.DATABASE_URL;
    // Loud rather than silent: falling back to another driver here would leave
    // a deployment serving traffic and quietly forgetting sales into a
    // filesystem Vercel throws away.
    if (!connectionString) {
      throw new Error("STORE_DRIVER=postgres requires DATABASE_URL");
    }
    registry.postgres = new PostgresStore(connectionString);
  }
  return registry.postgres;
}
