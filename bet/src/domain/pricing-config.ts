/**
 * Reconciles Task 3's stored `PricingConfig` (src/domain/entities.ts) with
 * Task 2's `MarketState` (src/domain/pricing/types.ts).
 *
 * Background (see entities.ts's `PricingConfig` doc comment for the full
 * story): Tasks 2 and 3 ran concurrently, so `pricing/types.ts` declares its
 * own `MarketState` union instead of importing Task 3's not-yet-existing
 * `PricingConfig`. The two are structurally close — `{kind, ...engine
 * fields}` — but not identical: `PricingConfig` additionally stores
 * `feeBps` (a market's fee configuration; SPEC §6.3), and `MarketState`
 * additionally carries `status` (the pricing-relevant projection of a
 * market's lifecycle, used by `BasePricingEngine`'s open-market guard) plus
 * a narrower 4-value status union than the entity's full 6-value
 * `MarketStatus`.
 *
 * Task 4 (this file) owns reconciling them, per its brief: `Market.pricing`
 * (entities.ts's `PricingConfig`) is the single stored shape — nothing about
 * Task 2's or Task 3's own modules changes. `toMarketState` /
 * `fromMarketState` are the only new code; they convert at the seam where a
 * stored `Market` meets a `PricingEngine` (Task 7's `trading.ts` calls
 * `toMarketState` before `engine.quote`/`execute`, then `fromMarketState` on
 * the engine's returned state before persisting it back onto the market).
 *
 * Pure, no I/O — safe to live in `src/domain` (G1).
 */

import type { MarketStatus, PricingConfig } from "./entities";
import type { MarketState, MarketStatus as PricingMarketStatus } from "./pricing/types";

/**
 * Projects the entity's 6-state lifecycle (`open → closed → resolving →
 * (disputed →) resolved`, plus `cancelled` from any pre-resolved state) onto
 * the 4-state union `MarketState` carries. The pricing engines only ever
 * branch on "is this market open" vs "is it not"
 * (`BasePricingEngine` rejects orders on any non-open market) — `disputed`
 * and `cancelled` have no pricing-relevant behavior of their own, so each
 * folds onto the nearest non-open pricing status:
 *   - `disputed` -> `resolving` (still mid-resolution, no payout has run yet)
 *   - `cancelled` -> `closed` (trading is over; no settlement math runs)
 */
export function toPricingStatus(status: MarketStatus): PricingMarketStatus {
  switch (status) {
    case "open":
      return "open";
    case "closed":
      return "closed";
    case "resolving":
      return "resolving";
    case "disputed":
      return "resolving";
    case "resolved":
      return "resolved";
    case "cancelled":
      return "closed";
  }
}

/**
 * Converts the stored `PricingConfig` (plus the owning market's own
 * `status`) into the `MarketState` a `PricingEngine` reads/writes. Pure and
 * total. Drops `feeBps` — fees are computed by the caller from the stored
 * config directly (`fees.ts`'s `takerFee`/`makerFee`, per
 * `pricing/types.ts`'s `Quote.fee` doc comment); the engine itself has no
 * per-trade fee to compute, so `MarketState` was never meant to carry it.
 */
export function toMarketState(pricing: PricingConfig, status: MarketStatus): MarketState {
  const pricingStatus = toPricingStatus(status);
  switch (pricing.kind) {
    case "lmsr":
      return { kind: "lmsr", status: pricingStatus, b: pricing.b, q: pricing.q };
    case "fixedOdds":
      return {
        kind: "fixedOdds",
        status: pricingStatus,
        openingPrices: pricing.openingPrices,
        escrow: pricing.escrow,
      };
    case "parimutuel":
      return {
        kind: "parimutuel",
        status: pricingStatus,
        rakeBps: pricing.rakeBps,
        pools: pricing.pools,
      };
  }
}

/**
 * Converts an engine-produced `MarketState` back into the stored
 * `PricingConfig`, re-attaching `feeBps` from the caller (the engine's
 * `MarketState` never carries it, so it can't round-trip on its own —
 * callers must thread the market's existing `feeBps` through). `status` is
 * intentionally dropped: the market entity's own `status` field stays the
 * single source of truth for lifecycle state, and `toMarketState` derives
 * the engine-facing status from it fresh on the next read rather than the
 * reverse.
 */
export function fromMarketState(state: MarketState, feeBps: number): PricingConfig {
  switch (state.kind) {
    case "lmsr":
      return { kind: "lmsr", feeBps, b: state.b, q: state.q };
    case "fixedOdds":
      return {
        kind: "fixedOdds",
        feeBps,
        openingPrices: state.openingPrices,
        escrow: state.escrow,
      };
    case "parimutuel":
      return {
        kind: "parimutuel",
        feeBps,
        rakeBps: state.rakeBps,
        pools: state.pools,
      };
  }
}
