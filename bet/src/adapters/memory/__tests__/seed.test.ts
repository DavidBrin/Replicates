/**
 * Task 5's DoD tests: determinism, price-sum-to-1, balance conservation,
 * LMSR bounded loss, and "every market has a message + a price point."
 *
 * Uses its own deterministic `Clock`/`IdGen` fixtures rather than the real
 * `SystemClock`/`NanoIdGen` from `src/lib/container.ts` — `container.ts`'s
 * `NanoIdGen` calls real `nanoid()`, which is intentionally random (ids
 * aren't meant to be predictable in production), so determinism can only
 * be asserted by fixing both time and id generation ourselves, exactly as
 * `seed.ts`'s own doc comment describes ("given the same `now` and the
 * same... `IdGen`").
 */
import { describe, expect, it } from "vitest";
import { createMemoryDataStore } from "@/adapters/memory";
import { seedDataStore } from "@/adapters/memory/seed";
import type { Market } from "@/domain/entities";
import type { DataStore } from "@/ports/data-store";
import type { Clock } from "@/ports/clock";
import type { IdGen } from "@/ports/id";
import { add, sub, zero, credits, type Credits } from "@/domain/money";
import { getEngine } from "@/domain/pricing/registry";
import { toMarketState } from "@/domain/pricing-config";
import { lmsrCost, lmsrMaxLoss } from "@/domain/pricing/lmsr";
import { DEFAULT_USER_HANDLE } from "@/adapters/memory/seed-data/users";

const FIXED_NOW = new Date("2026-08-09T18:00:00.000Z");

function fixedClock(): Clock {
  return { now: () => FIXED_NOW };
}

/** A trivial, fully deterministic `IdGen`: `next("usr")` -> `"usr_1"`,
 * `"usr_2"`, ... A fresh instance always starts its counters from zero, so
 * two independently-constructed instances driven through the identical
 * sequence of `next(prefix)` calls produce identical ids. */
function sequentialIdGen(): IdGen {
  const counters = new Map<string, number>();
  return {
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${n}`;
    },
  };
}

async function buildSeededStore(): Promise<DataStore> {
  const store = createMemoryDataStore();
  await seedDataStore(store, fixedClock(), sequentialIdGen());
  return store;
}

/** Every seeded market: the 3 groups' private markets (the seed always
 * makes `dev` a member of all 3 — `groups.ts`) plus every public Explore
 * market. Neither `GroupRepo` nor `MarketRepo` exposes a "list every
 * market" method directly (by design — see `data-store.ts`), so this is
 * the same traversal a real caller would have to do. */
async function allMarkets(store: DataStore): Promise<Market[]> {
  const dev = await store.users.findByHandle(DEFAULT_USER_HANDLE);
  if (!dev) throw new Error("seed did not create the default user");
  const groups = await store.groups.listByMember(dev.id);
  const privateMarkets = (await Promise.all(groups.map((g) => store.markets.listByGroup(g.id)))).flat();
  const publicMarkets = await store.markets.listPublic();
  return [...privateMarkets, ...publicMarkets];
}

/** A comprehensive, order-stable snapshot of everything the seed writes —
 * used only by the determinism test. Two independently-built stores are
 * compared on this rather than on raw internal `Tables`, since `DataStore`
 * intentionally exposes no "dump everything" method. */
async function snapshotStore(store: DataStore) {
  const users = await store.users.list();
  const markets = await allMarkets(store);

  const perUser = await Promise.all(
    users.map(async (u) => ({
      user: u,
      friends: await store.friends.listFriends(u.id),
      incoming: await store.friends.listIncomingRequests(u.id),
      outgoing: await store.friends.listOutgoingRequests(u.id),
      invitesReceived: await store.invites.listByInvitee(u.id),
      invitesSent: await store.invites.listByInviter(u.id),
      notifications: await store.notifications.listByUser(u.id),
    })),
  );

  const perMarket = await Promise.all(
    markets.map(async (m) => ({
      market: m,
      trades: await store.trades.listByMarket(m.id),
      positions: await store.positions.listByMarket(m.id),
      messages: await store.messages.listMessages(m.id, { limit: 1000 }),
      pricePoints: await store.priceHistory.listByMarket(m.id),
    })),
  );

  return { users, perUser, perMarket };
}

describe("seedDataStore", () => {
  it("(a) is deterministic: two independent builds are deep-equal", async () => {
    const storeA = await buildSeededStore();
    const storeB = await buildSeededStore();

    const snapshotA = await snapshotStore(storeA);
    const snapshotB = await snapshotStore(storeB);

    expect(snapshotA).toEqual(snapshotB);
    // Not a vacuous pass: real content actually exists to compare.
    expect(snapshotA.users.length).toBeGreaterThan(0);
    expect(snapshotA.perMarket.length).toBeGreaterThan(0);
  });

  it("(b) every seeded market's prices sum to 1 within 1e-9", async () => {
    const store = await buildSeededStore();
    const markets = await allMarkets(store);
    expect(markets.length).toBeGreaterThan(0);

    for (const market of markets) {
      const engine = getEngine(market.pricing.kind);
      const state = toMarketState(market.pricing, market.status);
      const prices = engine.currentPrices(state);
      const sum = Object.values(prices).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });

  it("(c) every user's balance equals 1000 credits - trade costs + settled payouts", async () => {
    const store = await buildSeededStore();
    const users = await store.users.list();
    expect(users.length).toBe(12);

    // Precompute settlement payouts for every resolved private market once.
    const dev = (await store.users.findByHandle(DEFAULT_USER_HANDLE))!;
    const groups = await store.groups.listByMember(dev.id);
    const privateMarkets = (await Promise.all(groups.map((g) => store.markets.listByGroup(g.id)))).flat();

    const payoutsByUser = new Map<string, Credits>();
    for (const market of privateMarkets) {
      if (market.status !== "resolved" || !market.resolution) continue;
      const engine = getEngine(market.pricing.kind);
      const state = toMarketState(market.pricing, market.status);
      const positions = await store.positions.listByMarket(market.id);
      const payouts = engine.settle(state, market.resolution.winningOutcomeId, positions);
      for (const payout of payouts) {
        const prior = payoutsByUser.get(payout.userId) ?? zero();
        payoutsByUser.set(payout.userId, add(prior, payout.amount));
      }
    }

    for (const user of users) {
      const userTrades = await store.trades.listByUser(user.id);
      let spent: Credits = zero();
      for (const t of userTrades) {
        // The seed only ever issues buy orders (see seed.ts's module doc
        // comment), but handle both directions correctly regardless.
        spent = t.side === "buy" ? add(spent, add(t.cost, t.fee)) : sub(spent, sub(t.cost, t.fee));
      }
      const payouts = payoutsByUser.get(user.id) ?? zero();
      const expectedBalance = sub(add(credits(100_000), payouts), spent);
      expect(user.balance).toBe(expectedBalance);
    }
  });

  it("(d) no seeded LMSR market violates the bounded-loss invariant b*ln(n)", async () => {
    const store = await buildSeededStore();
    const markets = await allMarkets(store);
    const lmsrMarkets = markets.filter((m) => m.pricing.kind === "lmsr");
    expect(lmsrMarkets.length).toBeGreaterThan(0);

    for (const market of markets) {
      if (market.pricing.kind !== "lmsr") continue;
      const { b, q } = market.pricing;
      const outcomeIds = market.outcomes.map((o) => o.id);
      const n = outcomeIds.length;

      // Revenue collected so far = C(q_now) - C(q_at_open=0) — this is a
      // pure function of the FINAL q (LMSR's cost function is
      // path-independent), so it's valid whether q was reached via real
      // executed trades (private markets) or set directly to reproduce a
      // target price (Explore markets) — see random-walk.ts's doc comment.
      const qArray = outcomeIds.map((id) => q[id] ?? 0);
      const zerosArray = outcomeIds.map(() => 0);
      const revenue = lmsrCost(qArray, b) - lmsrCost(zerosArray, b);

      // Worst-case operator loss over any possible winning outcome:
      // max(q_i) - revenue. Must never exceed b*ln(n).
      const worstCaseLoss = Math.max(...qArray) - revenue;
      const maxLoss = lmsrMaxLoss(b, n);
      expect(worstCaseLoss).toBeLessThanOrEqual(maxLoss + 1e-6);
    }
  });

  it("(e) every market has at least one message and at least one price point", async () => {
    const store = await buildSeededStore();
    const markets = await allMarkets(store);
    expect(markets.length).toBeGreaterThan(0);

    for (const market of markets) {
      const messages = await store.messages.listMessages(market.id, { limit: 1 });
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const pricePoints = await store.priceHistory.listByMarket(market.id);
      expect(pricePoints.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("seeds exactly the documented inventory shape", async () => {
    const store = await buildSeededStore();
    const users = await store.users.list();
    expect(users.length).toBe(12);
    expect(users.map((u) => u.handle)).toContain(DEFAULT_USER_HANDLE);
    expect(new Set(users.map((u) => u.avatarColor)).size).toBe(12);

    const markets = await allMarkets(store);
    expect(markets.length).toBe(34); // 10 private + 24 explore

    const byKind = { lmsr: 0, fixedOdds: 0, parimutuel: 0 } as Record<string, number>;
    const privateMarkets = markets.filter((m) => m.visibility === "group");
    expect(privateMarkets.length).toBe(10);
    for (const m of privateMarkets) byKind[m.pricing.kind] = (byKind[m.pricing.kind] ?? 0) + 1;
    expect(byKind).toEqual({ lmsr: 6, fixedOdds: 2, parimutuel: 0 + 2 });

    const statuses = new Set(privateMarkets.map((m) => m.status));
    expect(statuses).toEqual(new Set(["open", "closed", "resolving", "resolved"]));

    const feeMarkets = privateMarkets.filter((m) => m.pricing.feeBps > 0);
    expect(feeMarkets.length).toBe(1);
    const noFeeMarkets = markets.filter((m) => m.pricing.feeBps === 0);
    expect(noFeeMarkets.length).toBe(33);

    const publicMarkets = markets.filter((m) => m.visibility === "public");
    expect(publicMarkets.length).toBe(24);
  });
});
