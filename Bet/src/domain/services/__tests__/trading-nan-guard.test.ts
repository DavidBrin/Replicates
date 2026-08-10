/**
 * The third layer of the critical money bug: `executeTrade`'s oversell
 * guards were written as `quote.shares > held + 1e-9`. `NaN > anything` is
 * `false`, so a non-finite share count sailed straight THROUGH the check —
 * the guard failed **open** on exactly the input it exists to stop. The
 * only thing that stopped a committed sell of shares nobody holds was an
 * incidental `RangeError` from `money.mul()` further down, which surfaces
 * as an HTTP 500 rather than a refusal.
 *
 * Proving that requires a pricing engine that returns a non-finite quote,
 * which the real LMSR engine (correctly, after the fix) no longer will — so
 * the registry is stubbed here. The assertion is deliberately sharp: the
 * trade must be rejected by the *oversell guard* (`validation`, "Cannot
 * sell"), not by a downstream arithmetic accident.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/domain/entities";
import { credits, zero } from "@/domain/money";
import type { MarketState, Payout, Quote } from "@/domain/pricing/types";
import { buildFixture } from "@/test-support/trading-fixtures";

/** The quote the stub engine hands back — a NaN share count with an
 * otherwise perfectly well-formed cost, i.e. exactly the shape the old
 * `Math.floor(NaN) || 0` swallow used to produce. */
const NAN_SHARE_QUOTE: Quote = {
  shares: NaN,
  cost: credits(0),
  avgPrice: NaN,
  priceImpact: 0,
  fee: zero(),
};

const stubEngine = {
  currentPrices: (state: MarketState) =>
    state.kind === "lmsr" ? Object.fromEntries(Object.keys(state.q).map((o) => [o, 0.5])) : {},
  quote: (): Quote => NAN_SHARE_QUOTE,
  execute: (state: MarketState) => ({ newState: state, quote: NAN_SHARE_QUOTE }),
  settle: (): Payout[] => [],
};

vi.mock("@/domain/pricing/registry", () => ({
  getEngine: () => stubEngine,
}));

const { executeTrade } = await import("@/domain/services/trading");
const { exceedsHeld } = await import("@/domain/services/trading");

describe("exceedsHeld — the oversell predicate fails CLOSED on a non-finite value", () => {
  it("treats NaN as exceeding any holding", () => {
    expect(exceedsHeld(NaN, 100)).toBe(true);
    expect(exceedsHeld(NaN, 0)).toBe(true);
  });

  it("treats Infinity as exceeding any holding", () => {
    expect(exceedsHeld(Number.POSITIVE_INFINITY, 100)).toBe(true);
  });

  it("still allows a sale within the holding, float slack included", () => {
    expect(exceedsHeld(10, 10)).toBe(false);
    expect(exceedsHeld(10 + 1e-12, 10)).toBe(false);
    expect(exceedsHeld(10.5, 10)).toBe(true);
  });
});

describe("executeTrade — a non-finite quoted share count is refused, not committed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with the oversell `validation` error rather than an arithmetic 500", async () => {
    const f = await buildFixture();
    await f.store.positions.insert({
      id: brand("pos_seed"),
      marketId: f.market.id,
      outcomeId: f.yes.id,
      userId: f.alice.id,
      shares: 12,
      costBasis: credits(600),
    });

    const before = (await f.store.users.findById(f.alice.id))!;

    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "sell", budget: credits(2500) },
        },
      ),
    ).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("Cannot sell") });

    // And nothing was committed: balance and position are untouched.
    const after = (await f.store.users.findById(f.alice.id))!;
    expect(after.balance).toBe(before.balance);
    const position = (await f.store.positions.find(f.market.id, f.yes.id, f.alice.id))!;
    expect(position.shares).toBe(12);
    expect(position.costBasis).toBe(600);
  });
});
