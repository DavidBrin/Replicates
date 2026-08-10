import { describe, expect, it } from "vitest";
import { credits } from "@/domain/money";
import type { OutcomeId, PricingConfig } from "@/domain/entities";
import { fromMarketState, toMarketState, toPricingStatus } from "@/domain/pricing-config";

/**
 * `Record<OutcomeId, V>` (entities.ts) uses the branded `OutcomeId`, which
 * TypeScript's mapped-type resolution keeps deferred (it's not a bare
 * `string`/literal union), so a *fresh* object literal assigned straight
 * into a `Record<OutcomeId, V>`-typed position fails excess-property
 * checking even though the same value assigned through an
 * already-typed intermediate does not. Building the record through this
 * helper first (a non-literal, already-typed value) sidesteps that —
 * nothing to do with the module under test, purely a test-authoring
 * workaround for how branded `Record` keys interact with literal
 * freshness checks.
 */
function outcomeRecord<V>(entries: Record<string, V>): Record<OutcomeId, V> {
  return entries;
}

describe("pricing-config.ts — PricingConfig <-> MarketState reconciliation", () => {
  describe("toPricingStatus", () => {
    it("maps open/closed/resolving/resolved 1:1", () => {
      expect(toPricingStatus("open")).toBe("open");
      expect(toPricingStatus("closed")).toBe("closed");
      expect(toPricingStatus("resolving")).toBe("resolving");
      expect(toPricingStatus("resolved")).toBe("resolved");
    });
    it("folds disputed onto resolving (still mid-resolution, not settled)", () => {
      expect(toPricingStatus("disputed")).toBe("resolving");
    });
    it("folds cancelled onto closed (trading is over, no payout math runs)", () => {
      expect(toPricingStatus("cancelled")).toBe("closed");
    });
  });

  describe("toMarketState / fromMarketState round trip", () => {
    it("lmsr round-trips exactly, feeBps re-attached from the caller", () => {
      const q = outcomeRecord({ out_yes: 10, out_no: -4 });
      const pricing: PricingConfig = { kind: "lmsr", b: 100, feeBps: 250, q };
      const state = toMarketState(pricing, "open");
      expect(state).toEqual({ kind: "lmsr", status: "open", b: 100, q });

      const roundTripped = fromMarketState(state, pricing.feeBps);
      expect(roundTripped).toEqual(pricing);
    });

    it("fixedOdds round-trips exactly", () => {
      const openingPrices = outcomeRecord({ out_yes: 0.6, out_no: 0.4 });
      const escrow = outcomeRecord({ out_yes: credits(1200), out_no: credits(800) });
      const pricing: PricingConfig = { kind: "fixedOdds", feeBps: 0, openingPrices, escrow };
      const state = toMarketState(pricing, "resolving");
      expect(state).toEqual({
        kind: "fixedOdds",
        status: "resolving",
        openingPrices,
        escrow,
      });

      const roundTripped = fromMarketState(state, pricing.feeBps);
      expect(roundTripped).toEqual(pricing);
    });

    it("parimutuel round-trips exactly", () => {
      const pools = outcomeRecord({ out_yes: credits(5000), out_no: credits(3000) });
      const pricing: PricingConfig = { kind: "parimutuel", feeBps: 0, rakeBps: 500, pools };
      const state = toMarketState(pricing, "resolved");
      expect(state).toEqual({
        kind: "parimutuel",
        status: "resolved",
        rakeBps: pricing.rakeBps,
        pools,
      });

      const roundTripped = fromMarketState(state, pricing.feeBps);
      expect(roundTripped).toEqual(pricing);
    });

    it("dropped status is re-derived from the market's own status, not the prior MarketState", () => {
      const pricing: PricingConfig = { kind: "lmsr", b: 50, feeBps: 0, q: outcomeRecord({}) };
      const openState = toMarketState(pricing, "open");
      const closedState = toMarketState(pricing, "cancelled");
      expect(openState.status).toBe("open");
      expect(closedState.status).toBe("closed");
    });
  });
});
