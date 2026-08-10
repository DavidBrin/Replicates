/**
 * `GET /api/explore` — the public Explore feed (SPEC §3.6): every
 * `visibility: "public"` market, grouped by category with trending
 * (highest-volume-first) ordering. No auth required — this is one of the
 * rare routes that never calls `can()` at all (`authz.ts`'s own doc
 * comment: "public/no-auth surfaces (Explore, an invite-link preview)
 * intentionally never call can() at all"), and it must NEVER return a
 * private market — guaranteed by `MarketRepo.listPublic()` filtering on
 * `visibility === "public"` at the storage layer, not by a route-level
 * filter that could accidentally be loosened later.
 *
 * Ghost-trader volume (seed-data/explore-markets.ts's module doc comment):
 * `Trade.userId` values on these markets are synthetic ids with no backing
 * `User` row. This route only ever aggregates their `cost` into a volume
 * total — it never attempts to resolve them to a user.
 */

import { add, compare, zero, type Credits } from "@/domain/money";
import type { Market } from "@/domain/entities";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { getContainer } from "@/lib/container";
import { handler, jsonOk } from "@/lib/http";

export interface ExploreMarketView {
  market: Market;
  prices: Record<string, number>;
  volume: Credits;
  tradeCount: number;
}

export const GET = handler(async (req) => {
  const { store } = await getContainer();
  const url = new URL(req.url);
  const categoryFilter = url.searchParams.get("category");

  const markets = await store.markets.listPublic();
  const filtered = categoryFilter ? markets.filter((m) => m.category === categoryFilter) : markets;

  const entries: ExploreMarketView[] = [];
  for (const market of filtered) {
    const trades = await store.trades.listByMarket(market.id);
    const volume = trades.reduce((sum, t) => add(sum, t.cost), zero());
    const engine = getEngine(market.pricing.kind);
    const prices = engine.currentPrices(toMarketState(market.pricing, market.status));
    entries.push({ market, prices, volume, tradeCount: trades.length });
  }

  entries.sort((a, b) => compare(b.volume, a.volume));

  const grouped = new Map<string, ExploreMarketView[]>();
  for (const entry of entries) {
    const category = entry.market.category ?? "other";
    const bucket = grouped.get(category);
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped.set(category, [entry]);
    }
  }

  const categories = [...grouped.entries()].map(([category, categoryEntries]) => ({
    category,
    markets: categoryEntries,
  }));

  return jsonOk({
    categories,
    trending: entries.slice(0, 10),
  });
});
