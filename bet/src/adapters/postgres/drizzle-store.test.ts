/**
 * @vitest-environment node
 *
 * Runs the shared `DataStore` contract against an ephemeral in-memory
 * PGlite database. No external Postgres required.
 */

import { afterAll } from "vitest";
import { runDataStoreContract } from "@/adapters/__tests__/data-store-contract";
import {
  createPostgresDataStoreForTests,
  type PostgresTestStore,
} from "./drizzle-store";

let shared: PostgresTestStore | null = null;

async function makeStore(): Promise<PostgresTestStore> {
  if (!shared) {
    shared = await createPostgresDataStoreForTests("memory://");
  }
  await shared.truncateForTests();
  return shared;
}

afterAll(async () => {
  if (shared) {
    await shared.close();
    shared = null;
  }
});

runDataStoreContract("postgres (PGlite) adapter", makeStore, {
  // Single-connection PGlite cannot service a bare write while an interactive
  // transaction holds the connection (deadlock). Neon Pool + memory pass.
  skipBareWriteDuringTransact: true,
});
