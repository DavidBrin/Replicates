/**
 * Shared types for the pricing core (Task 2). Pure TS, no I/O, no
 * dependency on `src/adapters/**` or `src/app/**` (G1).
 *
 * `Position` and outcome/user ids are declared here as plain structural
 * types rather than imported from `src/domain/entities.ts` — that file is
 * owned by the concurrent Task 3. Task 3's real `Position` entity is a
 * structural superset of the shape below, so it satisfies these types
 * without either side importing the other.
 */

import type { Credits } from "@/domain/money";

/** A market's outcomes are identified by opaque strings (not branded here —
 * branding belongs to Task 3's entities; pricing math only needs equality
 * and use as a `Record` key). */
export type OutcomeId = string;

/** The lifecycle status pricing cares about: only `"open"` markets accept
 * new orders. Task 3 owns the richer market status machine
 * (`src/domain/market-state.ts`, open → closed → resolving → resolved);
 * this field is the minimal projection of that machine a `MarketState`
 * needs to carry so `BasePricingEngine`'s guard can refuse to trade against
 * a closed/settling market even if a caller invokes the engine directly
 * (defense in depth — `src/domain/services/trading.ts`, Task 7, is also
 * expected to check tradability before ever reaching the engine). */
export type MarketStatus = "open" | "closed" | "resolving" | "resolved";

/**
 * Opaque per-market pricing state, shape depends on the strategy. This is
 * the state a `PricingEngine` reads and (via `execute`) produces a new copy
 * of — it is NOT the whole `Market` entity (Task 3), just the slice the
 * pricing math needs.
 *
 * - `lmsr`: `q` is the cumulative *shares issued* per outcome (can be 0 at
 *   market open); `b` is the liquidity/subsidy parameter, in the same money
 *   unit as `Credits.toDecimal` (i.e. "credits", not cents).
 * - `fixedOdds`: `openingPrices` are fixed at market creation and never
 *   move (they must sum to ~1); `escrow` is the running total of `Credits`
 *   escrowed per outcome from all stakers combined (not per-user — per-user
 *   accounting lives in the `Position[]` ledger passed to `settle`).
 * - `parimutuel`: `pools` is the running total of `Credits` staked per
 *   outcome; `rakeBps` is the platform's cut in basis points (500 = 5%),
 *   applied once at settlement, never per-trade.
 */
export type MarketState =
  | { kind: "lmsr"; status: MarketStatus; b: number; q: Record<OutcomeId, number> }
  | {
      kind: "fixedOdds";
      status: MarketStatus;
      openingPrices: Record<OutcomeId, number>;
      escrow: Record<OutcomeId, Credits>;
    }
  | {
      kind: "parimutuel";
      status: MarketStatus;
      rakeBps: number;
      pools: Record<OutcomeId, Credits>;
    };

export type OrderSide = "buy" | "sell";

/**
 * A hypothetical or to-be-executed order. Exactly one of `shares` /
 * `budget` must be set (the base guard rejects both-set and neither-set).
 *
 * - `shares`: trade exactly this many shares (buy: mint/acquire; sell:
 *   liquidate from an existing position — the engine does not itself check
 *   the trader owns enough shares to sell; that is a ledger-level concern
 *   for the caller, since the engine has no user-scoped position data).
 * - `budget`: trade as many shares as fit this money amount. For a buy,
 *   this is "spend up to `budget`, never more" (the largest quantity whose
 *   cost does not exceed `budget`). For a sell, this is "sell up to enough
 *   shares to receive at most `budget` in proceeds" (the largest quantity
 *   whose proceeds do not exceed `budget`) — the same "never exceed the
 *   number you asked for" contract, applied symmetrically to both
 *   directions of money flow.
 * - `maxCost`: slippage guard, enforced by `BasePricingEngine`. For a buy,
 *   an upper bound — reject if the realized `cost` would exceed it. For a
 *   sell, a LOWER bound on the realized proceeds (also reported via
 *   `Quote.cost`, see below) — reject if realized proceeds would fall
 *   short of it. Both readings are "the worst realized value the trader
 *   already agreed to tolerate," matching how the UI derives it from a
 *   previously displayed quote plus a fixed tolerance (SPEC/Task 10).
 */
export type Order = {
  outcomeId: OutcomeId;
  side: OrderSide;
  shares?: number;
  budget?: Credits;
  maxCost?: Credits;
};

/**
 * The result of pricing (or executing) an order.
 *
 * `cost` is always a **positive** `Credits` value: for a buy, the amount
 * the trader pays; for a sell, the amount the trader receives ("proceeds").
 * The direction lives in `Order.side`, never in the sign of `cost` — a
 * signed-cost convention is exactly where round-trip sign bugs hide (per
 * David's ambiguity resolution). Money boundary rounding always favors the
 * house/pot, never the trader: buys round the cost UP, sells round the
 * proceeds DOWN.
 *
 * `fee` is always `zero()` as returned by the engines in this module — fee
 * computation (`fees.ts`) is deliberately NOT folded into `cost` here. The
 * three `MarketState` variants above carry no per-trade fee configuration
 * (only `parimutuel.rakeBps`, which is a settlement-time rake, not a
 * per-trade fee), so the engine has nothing to compute a fee FROM. The
 * caller (Task 7's `trading.ts`, which does know the market's `feeBps`) is
 * responsible for calling `takerFee`/`makerFee` from `fees.ts` and adding
 * the result on top of `cost` for a buy / deducting it from `cost` for a
 * sell before charging/paying the trader. See `fees.ts` for the full
 * rationale.
 */
export type Quote = {
  shares: number;
  cost: Credits;
  avgPrice: number;
  priceImpact: number;
  fee: Credits;
};

export type Payout = {
  userId: string;
  amount: Credits;
};

/**
 * A user's holding in one outcome of one market. Structurally compatible
 * with (a subset of) Task 3's real `Position` entity — see the module
 * doc-comment above.
 */
export type Position = {
  userId: string;
  outcomeId: OutcomeId;
  shares: number;
  costBasis: Credits;
};
