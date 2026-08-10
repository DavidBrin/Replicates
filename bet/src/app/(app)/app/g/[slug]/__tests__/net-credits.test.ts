/**
 * Fix round 1's DoD test for the group leaderboard bug: net credits used
 * to be pure cash flow (buy: -cost, sell: +cost, plus resolved payouts),
 * so every open position was valued at zero and looked like a full loss
 * of its stake. `computeGroupNetCredits` now also marks open positions at
 * the market's current price.
 *
 * Two levels:
 *  1. A synthetic single-market case that isolates the exact defect: a
 *     user who spent credits buying into a still-open market must not be
 *     shown down by the full amount they staked once the position's
 *     current value is counted.
 *  2. The real seeded "Sunday League" group (most of whose markets are
 *     still open) — the leaderboard must straddle zero, not read as
 *     universally negative the way the bug screenshot showed (-30, -31,
 *     -39, -43, -58, -61, -85 top to bottom).
 */
import { describe, expect, it } from "vitest";
import { createMemoryDataStore } from "@/adapters/memory";
import { seedDataStore } from "@/adapters/memory/seed";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { credits, isNegative, zero } from "@/domain/money";
import { brand } from "@/domain/entities";
import type { Market, OutcomeId, Position, Trade } from "@/domain/entities";
import type { DataStore } from "@/ports/data-store";
import type { Clock } from "@/ports/clock";
import type { IdGen } from "@/ports/id";
import { computeGroupNetCredits, type MarketLeaderboardInput } from "../net-credits";

const FIXED_NOW = new Date("2026-08-09T18:00:00.000Z");

function fixedClock(): Clock {
  return { now: () => FIXED_NOW };
}

/** Same trivial deterministic `IdGen` as `adapters/memory/__tests__/seed.test.ts`. */
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

/** Mirrors what `page.tsx`'s `buildMarketCardData` feeds
 * `computeGroupNetCredits` for a real market: current prices via the one
 * true `toMarketState` + `getEngine(kind).currentPrices` reconciliation,
 * and (only for a resolved market) the settlement payouts. */
async function toLeaderboardInput(
  store: DataStore,
  market: Market,
): Promise<MarketLeaderboardInput> {
  const engine = getEngine(market.pricing.kind);
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));
  const [trades, positions] = await Promise.all([
    store.trades.listByMarket(market.id),
    store.positions.listByMarket(market.id),
  ]);
  const payouts =
    market.status === "resolved" && market.resolution
      ? engine.settle(
          toMarketState(market.pricing, "resolved"),
          market.resolution.winningOutcomeId,
          positions,
        )
      : [];
  return { status: market.status, trades, payouts, positions, prices };
}

describe("computeGroupNetCredits", () => {
  it("does not show a holder of an open position as down by the full amount staked", () => {
    const userId = brand<"UserId">("usr_1");
    const other = brand<"UserId">("usr_2");
    const marketId = brand<"MarketId">("mkt_1");
    const outcomeId = brand<"OutcomeId">("yes");

    // Spent 500 credits buying into a still-open market; the resulting
    // position is currently worth 700 (1000 shares at a 0.7 price) — up,
    // not down, once marked.
    const trades: Trade[] = [
      {
        id: brand("trd_1"),
        marketId,
        outcomeId,
        userId,
        side: "buy",
        shares: 1000,
        cost: credits(50_000), // 500.00 credits
        avgPrice: 0.5,
        fee: zero(),
        at: FIXED_NOW,
      },
    ];
    const positions: Position[] = [
      {
        id: brand("pos_1"),
        marketId,
        outcomeId,
        userId,
        shares: 1000,
        costBasis: credits(50_000),
      },
    ];

    const prices: Record<OutcomeId, number> = { [outcomeId]: 0.7, [brand<"OutcomeId">("no")]: 0.3 };
    const net = computeGroupNetCredits([userId, other], [
      { status: "open", trades, payouts: [], positions, prices },
    ]);

    const cashFlowOnly = -50_000; // what the old (pre-fix) implementation reported
    const result = net.get(userId)!;

    expect(result).toBeGreaterThan(cashFlowOnly);
    // Marked value (1000 * 0.7 = 700.00 credits) more than covers the 500
    // spent, so this holder should show a gain, not a loss.
    expect(isNegative(result)).toBe(false);
    expect(result).toBe(20_000); // -50_000 (spend) + 70_000 (mark) = 20_000
  });

  it("straddles zero across the real seeded Sunday League group instead of reading as universally negative", async () => {
    const store = await buildSeededStore();
    const group = await store.groups.findBySlug("sunday-league");
    expect(group).toBeDefined();

    const markets = await store.markets.listByGroup(group!.id);
    expect(markets.length).toBeGreaterThan(0);

    const inputs = await Promise.all(markets.map((m) => toLeaderboardInput(store, m)));
    const net = computeGroupNetCredits(group!.memberIds, inputs);

    const values = [...net.values()];
    expect(values.length).toBeGreaterThan(0);

    const hasNonNegative = values.some((v) => !isNegative(v));
    const hasNegativeOrZero = values.some((v) => isNegative(v) || v === 0);
    // A believable leaderboard straddles zero — not everyone can be a
    // loser when most positions are still open and un-marked money didn't
    // vanish, it's sitting in a live position.
    expect(hasNonNegative).toBe(true);
    expect(hasNegativeOrZero).toBe(true);
  });
});
