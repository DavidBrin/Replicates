/**
 * Shared test fixtures for `domain/services/__tests__/trading.test.ts` /
 * `resolution.test.ts`: a fresh in-memory `DataStore` with two users
 * (alice, bob) in one group and one market between them, built directly
 * (not through `seed.ts`) so each test controls its own pricing kind,
 * fees, and stake bounds precisely.
 *
 * Lives under `src/test-support/`, NOT `src/domain/**` — this file imports
 * `@/adapters/memory` (`createMemoryDataStore`), which G1's layering guard
 * (`src/domain/__tests__/layering.test.ts`) forbids for anything under
 * `src/domain`, `__tests__` subdirectories included (it walks the whole
 * tree). A domain-services test needing a real adapter is legitimate; the
 * fixture just can't live inside the directory the guard scans.
 *
 * Not itself a `*.test.ts` file, so vitest's `include` glob
 * (`src/**\/*.test.{ts,tsx}`) never picks it up as a suite.
 */

import { createMemoryDataStore } from "@/adapters/memory";
import { brand, type Group, type Market, type Outcome, type PricingConfig, type User } from "@/domain/entities";
import { credits, zero } from "@/domain/money";
import type { Clock } from "@/ports/clock";
import type { DataStore } from "@/ports/data-store";
import type { IdGen } from "@/ports/id";

export const FIXED_NOW = new Date("2026-08-09T12:00:00.000Z");

export function fixedClock(now: Date = FIXED_NOW): Clock {
  return { now: () => now };
}

/** A `Clock` whose `now()` can be advanced mid-test — needed for
 * resolution's 12h dispute-window tests. */
export interface MutableClock extends Clock {
  advance(ms: number): void;
}

export function mutableClock(initial: Date = FIXED_NOW): MutableClock {
  let current = initial.getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

/** A trivial, fully deterministic `IdGen`: `next("usr")` -> `"usr_1"`,
 * `"usr_2"`, ... */
export function sequentialIdGen(): IdGen {
  const counters = new Map<string, number>();
  return {
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${n}`;
    },
  };
}

export interface FixtureOptions {
  clock?: Clock;
  pricingKind?: "lmsr" | "fixedOdds" | "parimutuel";
  feeBps?: number;
  /** Milliseconds from `now` the market closes at — negative for "already
   * past close" (but `status` still starts `"open"`, exercising the
   * clock-driven auto-transition). */
  closesInMs?: number;
  minStake?: number;
  maxStake?: number;
  status?: Market["status"];
}

export interface Fixture {
  store: DataStore;
  clock: Clock;
  idGen: IdGen;
  alice: User;
  bob: User;
  group: Group;
  market: Market;
  yes: Outcome;
  no: Outcome;
}

export async function buildFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const store = createMemoryDataStore();
  const clock = options.clock ?? fixedClock();
  const idGen = sequentialIdGen();
  const now = clock.now();

  const alice: User = {
    id: brand(idGen.next("usr")),
    handle: "alice",
    displayName: "Alice",
    avatarColor: "#7c6cff",
    avatarInitials: "AL",
    balance: credits(100_000), // 1,000.00 credits
    createdAt: now,
  };
  const bob: User = {
    id: brand(idGen.next("usr")),
    handle: "bob",
    displayName: "Bob",
    avatarColor: "#4877ff",
    avatarInitials: "BO",
    balance: credits(100_000),
    createdAt: now,
  };
  await store.users.insert(alice);
  await store.users.insert(bob);

  const group: Group = {
    id: brand(idGen.next("grp")),
    slug: "test-group",
    name: "Test Group",
    emoji: "\u{1F3B2}",
    memberIds: [alice.id, bob.id],
    ownerId: alice.id,
    createdAt: now,
  };
  await store.groups.insert(group);

  const marketId = brand<"MarketId">(idGen.next("mkt"));
  const yes: Outcome = { id: brand(idGen.next("out")), marketId, label: "Yes", color: "#2bae4c" };
  const no: Outcome = { id: brand(idGen.next("out")), marketId, label: "No", color: "#f43437" };

  const kind = options.pricingKind ?? "lmsr";
  const feeBps = options.feeBps ?? 0;
  let pricing: PricingConfig;
  if (kind === "lmsr") {
    pricing = { kind: "lmsr", b: 100, feeBps, q: { [yes.id]: 0, [no.id]: 0 } };
  } else if (kind === "fixedOdds") {
    pricing = {
      kind: "fixedOdds",
      feeBps,
      openingPrices: { [yes.id]: 0.5, [no.id]: 0.5 },
      escrow: { [yes.id]: zero(), [no.id]: zero() },
    };
  } else {
    pricing = { kind: "parimutuel", feeBps, rakeBps: 0, pools: { [yes.id]: zero(), [no.id]: zero() } };
  }

  const market: Market = {
    id: marketId,
    groupId: group.id,
    creatorId: alice.id,
    question: "Will it happen?",
    resolutionCriteria: "Resolves Yes if it happens, No otherwise, per group consensus.",
    closesAt: new Date(now.getTime() + (options.closesInMs ?? 7 * 86_400_000)),
    status: options.status ?? "open",
    visibility: "group",
    pricing,
    minStake: credits(options.minStake ?? 1),
    maxStake: credits(options.maxStake ?? 10_000_00),
    stakesVisible: true,
    outcomes: [yes, no],
    createdAt: now,
  };
  await store.markets.insert(market);

  return { store, clock, idGen, alice, bob, group, market, yes, no };
}
