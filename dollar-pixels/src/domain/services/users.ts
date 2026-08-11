/**
 * Sign-in, such as it is.
 *
 * You type a name and you are that person. There is nothing to protect: every
 * page is public, and the only thing identity decides is which pages are
 * listed as yours and whose ledger you are looking at. Anything stronger would
 * be security theatre around a demo (DECISIONS D4 explains why nothing here is
 * access-controlled).
 */

import type { User } from "@/domain/entities";
import { handleFrom } from "@/domain/slug";
import type { Clock, IdGen, Store } from "@/ports";
import { fail } from "./errors";

export const DISPLAY_NAME_MAX = 32;

export interface UserDeps {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
}

/**
 * Find or create the user behind a display name.
 *
 * Returning to the same name returns to the same account, which is the
 * behaviour someone typing their name twice expects. It also means anyone can
 * "become" anyone by typing their name — stated plainly in the UI rather than
 * papered over.
 */
export async function signIn(deps: UserDeps, displayName: string): Promise<User> {
  const name = displayName.replace(/\s+/g, " ").trim();
  if (name.length < 1) fail("invalid", "Type a name to sign in with.");
  if (name.length > DISPLAY_NAME_MAX) {
    fail("invalid", `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`);
  }

  return deps.store.transact(async (tx) => {
    // Probe candidate handles one at a time rather than reading every user to
    // build a taken-set. Collisions are rare, the loop almost always exits on
    // its first iteration, and this needs no full scan on the Postgres adapter.
    const taken = new Set<string>();
    for (let attempt = 0; attempt < 64; attempt++) {
      const handle = handleFrom(name, taken);
      const existing = await tx.getUserByHandle(handle);
      if (!existing) return tx.createUser(newUser(deps, handle, name));
      // Same display name means it is the same person coming back.
      if (existing.displayName === name) return existing;
      // Same slug, different name — "Ana Ruiz" and "ana ruiz" both want
      // `ana-ruiz`. The second gets a suffix, not the first one's account.
      taken.add(handle);
    }
    fail("conflict", "Too many people are using that name. Try another.");
  });
}

function newUser(deps: UserDeps, handle: string, displayName: string): User {
  return {
    id: deps.idGen.next("usr"),
    handle,
    displayName,
    createdAt: deps.clock.now().toISOString(),
  };
}
