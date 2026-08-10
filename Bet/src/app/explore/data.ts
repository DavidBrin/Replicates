/**
 * Server-only data access for the Explore surface (SPEC §3.6, Task 13).
 *
 * Deliberately independent of `src/app/api/explore/route.ts` (Task 7's file,
 * outside this task's scope) rather than fetching it over HTTP: Server
 * Components in this codebase read straight from the composition root's
 * `DataStore` (the same pattern `src/app/signin/page.tsx` already uses —
 * see its doc comment: "don't waterfall a client-side fetch"). `GET
 * /api/explore` itself never calls `can()` — public markets are meant to be
 * readable with no auth at all — so reading `store.markets.listPublic()`
 * directly here carries the identical authorization posture, just without a
 * network hop back into the same process.
 *
 * The one thing this module must get right that a naive "just call
 * findById" wouldn't: `getExploreMarketDetail` explicitly re-checks
 * `visibility === "public"` even though `listPublic()` already filters at
 * the list level — a market id typed straight into `/explore/[id]` must
 * never leak a private/group market by id-guessing (Task 13's "no private
 * market ever appears there" done-when).
 */

import "server-only";

import type { Market, MarketId, PricePoint } from "@/domain/entities";
import { add, compare, zero, type Credits } from "@/domain/money";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { getContainer } from "@/lib/container";

export interface ExploreMarketView {
  market: Market;
  prices: Record<string, number>;
  volume: Credits;
  tradeCount: number;
  /**
   * Unique ghost-trader ids that have traded this market. There is no
   * `Position` ledger for Explore markets (seed.ts's module doc comment:
   * "no real position-holders"), so this is the closest honest stand-in for
   * a "holders" count — a distinct-trader count over synthetic `Trade`
   * rows, never resolved to a real `User`.
   */
  holderCount: number;
}

async function buildView(market: Market): Promise<ExploreMarketView> {
  const { store } = await getContainer();
  const trades = await store.trades.listByMarket(market.id);
  const volume = trades.reduce((sum, t) => add(sum, t.cost), zero());
  const engine = getEngine(market.pricing.kind);
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));
  const holderCount = new Set(trades.map((t) => t.userId)).size;
  return { market, prices, volume, tradeCount: trades.length, holderCount };
}

/** Every public market, sorted highest-volume-first (mirrors `GET
 * /api/explore`'s trending ordering). Callers group/filter/search over this
 * in-memory — the dataset is ~24 markets, small enough that a second pass
 * client-side (category tab, chip filter, search query) is simpler and
 * cheaper than three separate store queries. */
export async function listExploreMarkets(): Promise<ExploreMarketView[]> {
  const { store } = await getContainer();
  const markets = await store.markets.listPublic();
  const views = await Promise.all(markets.map(buildView));
  views.sort((a, b) => compare(b.volume, a.volume));
  return views;
}

export interface ExploreMarketDetail {
  view: ExploreMarketView;
  /** Chronological ascending, full 90-day series — timeframe filtering
   * (1D/1W/1M/ALL) happens client-side in `PriceChartPanel`. */
  history: PricePoint[];
}

/** Returns `null` (never throws) for a missing id OR a non-public market —
 * both render as `notFound()` from the caller, so a private market's id
 * never distinguishes itself from "doesn't exist" (the same 404-not-403
 * discipline G4/D6 apply everywhere else in this app, even though this
 * route path never calls `can()`). */
export async function getExploreMarketDetail(id: string): Promise<ExploreMarketDetail | null> {
  const { store } = await getContainer();
  const market = await store.markets.findById(id as MarketId);
  if (!market || market.visibility !== "public") return null;

  const [view, history] = await Promise.all([
    buildView(market),
    store.priceHistory.listByMarket(market.id),
  ]);
  return { view, history };
}
