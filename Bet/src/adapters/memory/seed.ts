/**
 * Placeholder seed. docs/plan.md Task 5 owns this file (`src/adapters/
 * memory/seed.ts`, `src/adapters/memory/seed-data/*.ts`) and is expected to
 * replace this body wholesale with the full deterministic dataset (12
 * users, 3 groups, ~10 markets with real trade/chat history, friendships,
 * invites, ~24 Explore markets — see docs/plan.md Task 5).
 *
 * It exists now, ahead of Task 5, only because Task 4's composition root
 * (`src/lib/container.ts`) needs *something* to seed in order for its own
 * definition of done to be demonstrable end to end: signing in via
 * `POST /api/session` requires at least one real `User` row to sign in as.
 * Task 5 replacing this file's contents is a drop-in swap as long as it
 * keeps the exported `seedDataStore(store, clock, idGen)` signature —
 * `container.ts` calls exactly that and needs no changes when Task 5 lands.
 */

import { brand, type User } from "@/domain/entities";
import type { Clock } from "@/ports/clock";
import type { IdGen } from "@/ports/id";
import { credits } from "@/domain/money";
import type { DataStore } from "@/ports/data-store";

const PLACEHOLDER_DEMO_USERS = [
  { handle: "dev", displayName: "Dev", avatarColor: "#7c6cff", avatarInitials: "DV" },
  { handle: "maya", displayName: "Maya Chen", avatarColor: "#2bae4c", avatarInitials: "MC" },
  { handle: "jordan", displayName: "Jordan Ruiz", avatarColor: "#efc500", avatarInitials: "JR" },
  { handle: "priya", displayName: "Priya Patel", avatarColor: "#a394ff", avatarInitials: "PP" },
] as const;

/** Idempotent: safe to call more than once against the same store (skips
 * any handle that already exists) so a hot-reloaded dev server or a test
 * that calls it twice never duplicates users. */
export async function seedDataStore(store: DataStore, clock: Clock, idGen: IdGen): Promise<void> {
  await store.transact(async (tx) => {
    for (const seed of PLACEHOLDER_DEMO_USERS) {
      const existing = await tx.users.findByHandle(seed.handle);
      if (existing) continue;
      const user: User = {
        id: brand(idGen.next("usr")),
        handle: seed.handle,
        displayName: seed.displayName,
        avatarColor: seed.avatarColor,
        avatarInitials: seed.avatarInitials,
        balance: credits(100_000),
        createdAt: clock.now(),
      };
      await tx.users.insert(user);
    }
  });
}
