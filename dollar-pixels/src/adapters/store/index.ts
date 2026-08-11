/**
 * The store composition point: one environment variable, two adapters.
 *
 * `memory` is the default so that an empty environment runs the whole app.
 * `postgres` is what a deployment that must remember anything needs
 * (DECISIONS D13).
 */

import type { Store } from "@/ports";
import { getMemoryStore, storeRegistry } from "./memory";
import { PostgresStore } from "./postgres";

export {
  MemoryStore,
  createMemoryStore,
  getMemoryStore,
  resetStoreForTests,
} from "./memory";
export { PostgresStore } from "./postgres";

export type StoreDriver = "memory" | "postgres";

export function storeDriver(): StoreDriver {
  return process.env.STORE_DRIVER === "postgres" ? "postgres" : "memory";
}

/**
 * The store for this process.
 *
 * Both adapters are memoised on the same `globalThis` registry: the memory one
 * because a fresh `Map` per module evaluation would lose every purchase on the
 * next Fast Refresh, and the Postgres one because a fresh `Pool` per module
 * evaluation opens connections nobody closes
 * (`research/persistence-and-vercel.md` §4).
 */
export function getStore(): Store {
  if (storeDriver() === "memory") return getMemoryStore();

  const registry = storeRegistry();
  if (!registry.postgres) {
    const connectionString = process.env.DATABASE_URL;
    // Loud rather than silent: falling back to memory here would leave a
    // deployment serving traffic and quietly forgetting sales.
    if (!connectionString) {
      throw new Error("STORE_DRIVER=postgres requires DATABASE_URL");
    }
    registry.postgres = new PostgresStore(connectionString);
  }
  return registry.postgres;
}
