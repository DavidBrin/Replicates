/**
 * The trade use-case (docs/plan.md Task 7). Pure except for the injected
 * `DataStore`/`Clock`/`IdGen` (no ambient `Date.now()`/id generation, no
 * import of `src/adapters/**` or `src/app/**` — G1).
 *
 * `executeTrade`'s order of operations (David's ambiguity resolution), all
 * inside exactly one `store.transact`:
 *
 *   authorize -> load market -> assertTradable(market, clock.now()) ->
 *   getEngine(kind).execute(...) against committed state (G3: the client's
 *   own quote/cost is never trusted) -> enforce maxCost slippage as a
 *   `conflict` -> validate the realized cost against minStake/maxStake and
 *   the trader's balance -> debit balance -> upsert position (recomputing
 *   weighted average cost basis) -> append trade -> persist the new market
 *   state -> append a price point -> append a `kind: "system"` chat
 *   message (D11) -> notify other participants. Returns the realized
 *   `Quote`.
 *
 * (The validation-against-amount step is deliberately run against the
 * REALIZED, fee-inclusive quote rather than the raw request: a `shares`-
 * denominated order has no known cost until the engine prices it, and even
 * a `budget`-denominated order's realized cost can exceed the requested
 * budget once the market's fee is added on top for a buy. Checking the
 * fully-realized number is strictly more correct than pre-checking the
 * client's input and is what actually protects `minStake`/`maxStake`/
 * balance/slippage — see `priceOrder` below.)
 */

import type { Actor } from "@/domain/authz";
import {
  brand,
  type Market,
  type MarketId,
  type OutcomeId,
  type Position,
  type UserId,
} from "@/domain/entities";
import { formatPriceCents } from "@/domain/formatters";
import { add, clamp, compare, mul, sub, zero, type Credits } from "@/domain/money";
import { assertTradable, MarketNotTradableError } from "@/domain/market-state";
import { fromMarketState, toMarketState } from "@/domain/pricing-config";
import { takerFee } from "@/domain/pricing/fees";
import { getEngine } from "@/domain/pricing/registry";
import type { Order as EngineOrder, Quote } from "@/domain/pricing/types";
import type { Clock } from "@/ports/clock";
import type { DataStore } from "@/ports/data-store";
import type { IdGen } from "@/ports/id";
import { fail } from "./errors";
import { assertOutcomeExists, loadMarketForActor, postSystemMessage, runEngine } from "./market-access";

export type TradeSide = "buy" | "sell";

/** The route layer's parsed order. Uses the entity-branded `OutcomeId`
 * (not `pricing/types.ts`'s plain-string alias) because this value flows
 * straight into `DataStore` calls (`positions.find`, `trades.insert`, ...)
 * that require the branded type — `toEngineOrder` widens it back down to a
 * plain string at the one seam (`pricing/types.ts`'s `Order`) that wants
 * that. `budget`/`maxCost` are already integer-cent `Credits` (routes
 * convert from the wizard's decimal-credits input via `money.fromDecimal`
 * before calling in). */
export type TradeOrderInput = {
  outcomeId: OutcomeId;
  side: TradeSide;
  shares?: number;
  budget?: Credits;
  maxCost?: Credits;
};

export interface TradeDeps {
  store: DataStore;
  clock: Clock;
  idGen: IdGen;
}

function toEngineOrder(order: TradeOrderInput): EngineOrder {
  return {
    outcomeId: order.outcomeId,
    side: order.side,
    shares: order.shares,
    budget: order.budget,
    // `maxCost` deliberately NOT forwarded to the engine: slippage is
    // enforced by the caller against the FEE-INCLUSIVE total, raised as a
    // `conflict` (409), not the engine's own bare-cost `validation` guard.
  };
}

/** Folds the market's per-trade fee (SPEC §6.3: `feeBps` of 0 disables it)
 * on top of the engine's raw quote — added to `cost` for a buy, deducted
 * from proceeds (clamped at 0) for a sell. */
function applyFee(feeBps: number, side: TradeSide, raw: Quote): Quote {
  const fee = feeBps > 0 ? takerFee(raw.shares, raw.avgPrice) : zero();
  const cost = side === "buy" ? add(raw.cost, fee) : clamp(sub(raw.cost, fee), zero(), raw.cost);
  return { ...raw, cost, fee };
}

/**
 * Prices a hypothetical order against a market's CURRENT persisted state,
 * fee included — the exact math `POST /quote` displays and `executeTrade`
 * re-derives immediately before executing (G3). Pure given `market`
 * (no I/O); throws via `fail()` (uniform-a-object AppError) rather than
 * letting a `PricingError` escape unconverted.
 */
export function priceOrder(market: Market, order: TradeOrderInput): Quote {
  assertOutcomeExists(market, order.outcomeId);
  const engine = getEngine(market.pricing.kind);
  const state = toMarketState(market.pricing, market.status);
  const raw = runEngine(() => engine.quote(state, toEngineOrder(order)));
  return applyFee(market.pricing.feeBps, order.side, raw);
}

function assertTradableOrFail(market: Market, now: Date): void {
  try {
    assertTradable(market, now);
  } catch (err) {
    if (err instanceof MarketNotTradableError) {
      fail("market_closed", err.message);
    }
    throw err;
  }
}

export interface ExecuteTradeParams {
  actor: Actor;
  marketId: MarketId;
  order: TradeOrderInput;
}

export interface ExecuteTradeResult {
  quote: Quote;
  market: Market;
  position: Position;
}

export async function executeTrade(
  deps: TradeDeps,
  params: ExecuteTradeParams,
): Promise<ExecuteTradeResult> {
  const { store, clock, idGen } = deps;
  const { actor, marketId, order } = params;

  return store.transact(async (tx) => {
    const market = await loadMarketForActor(tx, marketId, actor);
    // `loadMarketForActor` already denies every anonymous actor (`not_found`
    // — D6, a market is existence-sensitive, so an unauthenticated trade
    // attempt reads as "not found," never a 403 "sign in required" that
    // would confirm the market exists). This narrows `actor` for the rest
    // of the function.
    if (!("userId" in actor)) fail("not_found", "Market not found.");
    const actorId = actor.userId;

    assertTradableOrFail(market, clock.now());
    assertOutcomeExists(market, order.outcomeId);

    const user = await tx.users.findById(actorId);
    if (!user) fail("forbidden", "Your session is no longer valid — please sign in again.");

    const existingPosition = await tx.positions.find(marketId, order.outcomeId, actorId);

    if (order.side === "sell") {
      const held = existingPosition?.shares ?? 0;
      if (held <= 0) {
        fail("validation", "You do not hold a position in this outcome to sell.");
      }
      if (order.shares !== undefined && order.shares > held + 1e-9) {
        fail("validation", `Cannot sell ${order.shares} shares — you hold ${held}.`);
      }
    }

    const engine = getEngine(market.pricing.kind);
    const state = toMarketState(market.pricing, market.status);
    const { newState, quote: rawQuote } = runEngine(() =>
      engine.execute(state, toEngineOrder(order)),
    );
    const quote = applyFee(market.pricing.feeBps, order.side, rawQuote);

    // Authoritative post-quote checks — never trust the pre-execute
    // estimate above, since fees/rounding only land once the engine has
    // actually priced the order (G3).
    if (order.side === "sell") {
      const held = existingPosition?.shares ?? 0;
      if (quote.shares > held + 1e-9) {
        fail("validation", `Cannot sell ${quote.shares} shares — you hold ${held}.`);
      }
    }

    if (order.maxCost !== undefined) {
      if (order.side === "buy" && compare(quote.cost, order.maxCost) > 0) {
        fail(
          "conflict",
          `Slippage exceeded: realized cost ${quote.cost} exceeds your maxCost ${order.maxCost}.`,
        );
      }
      if (order.side === "sell" && compare(quote.cost, order.maxCost) < 0) {
        fail(
          "conflict",
          `Slippage exceeded: realized proceeds ${quote.cost} fell short of your minimum ${order.maxCost}.`,
        );
      }
    }

    if (order.side === "buy") {
      if (compare(quote.cost, market.minStake) < 0) {
        fail("validation", `Minimum stake is ${market.minStake} credits.`, {
          amount: "below minStake",
        });
      }
      if (compare(quote.cost, market.maxStake) > 0) {
        fail("validation", `Maximum stake is ${market.maxStake} credits.`, {
          amount: "above maxStake",
        });
      }
      if (compare(quote.cost, user.balance) > 0) {
        fail("insufficient_balance", "You don't have enough credits for this trade.");
      }
    }

    // -------------------------------------------------------------
    // Commit: balance, position, trade, market state, price point,
    // system message, notifications — all inside this one transact.
    // -------------------------------------------------------------

    const newBalance =
      order.side === "buy" ? sub(user.balance, quote.cost) : add(user.balance, quote.cost);
    await tx.users.update(actorId, { balance: newBalance });

    let position: Position;
    if (order.side === "buy") {
      position = existingPosition
        ? await tx.positions.update(existingPosition.id, {
            shares: existingPosition.shares + quote.shares,
            costBasis: add(existingPosition.costBasis, quote.cost),
          })
        : await tx.positions.insert({
            id: brand(idGen.next("pos")),
            marketId,
            outcomeId: order.outcomeId,
            userId: actorId,
            shares: quote.shares,
            costBasis: quote.cost,
          });
    } else {
      const prior = existingPosition!;
      const remainingShares = Math.max(0, prior.shares - quote.shares);
      const soldFraction = prior.shares > 0 ? Math.min(1, quote.shares / prior.shares) : 0;
      const costBasisRemoved = mul(prior.costBasis, soldFraction, "nearest");
      const remainingCostBasis =
        remainingShares > 0 ? sub(prior.costBasis, costBasisRemoved) : zero();
      position = await tx.positions.update(prior.id, {
        shares: remainingShares,
        costBasis: remainingCostBasis,
      });
    }

    await tx.trades.insert({
      id: brand(idGen.next("trd")),
      marketId,
      outcomeId: order.outcomeId,
      userId: actorId,
      side: order.side,
      shares: quote.shares,
      cost: quote.cost,
      avgPrice: quote.avgPrice,
      fee: quote.fee,
      at: clock.now(),
    });

    const updatedMarket = await tx.markets.update(marketId, {
      pricing: fromMarketState(newState, market.pricing.feeBps),
    });

    await tx.priceHistory.append({
      marketId,
      at: clock.now(),
      prices: engine.currentPrices(newState),
    });

    const outcomeLabel = market.outcomes.find((o) => o.id === order.outcomeId)!.label;
    const verb = order.side === "buy" ? "bought" : "sold";
    const shareCount = Math.max(1, Math.round(quote.shares));
    await postSystemMessage(
      tx,
      idGen,
      marketId,
      clock.now(),
      `${user.displayName} ${verb} ${shareCount} ${outcomeLabel} @ ${formatPriceCents(quote.avgPrice)}`,
    );

    // Notify every OTHER participant (creator + every position holder),
    // never the trader themself.
    const positions = await tx.positions.listByMarket(marketId);
    const participantIds = new Set<UserId>([market.creatorId, ...positions.map((p) => p.userId)]);
    participantIds.delete(actorId);
    for (const uid of participantIds) {
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: uid,
        type: "chat_message",
        payload: {
          marketId,
          question: market.question,
          summary: `${user.displayName} ${verb} ${shareCount} ${outcomeLabel} @ ${formatPriceCents(quote.avgPrice)}`,
        },
        createdAt: clock.now(),
      });
    }

    return { quote, market: updatedMarket, position };
  });
}
