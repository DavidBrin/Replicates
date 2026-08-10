import { describe, expect, it } from "vitest";
import { credits, toDecimal } from "@/domain/money";
import { makerFee, rawFee, takerFee } from "../fees";

describe("rawFee — Kalshi's fee table (research/pricing-mechanisms.md §7.1)", () => {
  it("reproduces the documented per-contract ($1 notional, C=1) taker fee table", () => {
    expect(rawFee(1, 0.5, 700)).toBeCloseTo(0.0175, 6);
    expect(rawFee(1, 0.3, 700)).toBeCloseTo(0.0147, 6);
    expect(rawFee(1, 0.1, 700)).toBeCloseTo(0.0063, 6);
    expect(rawFee(1, 0.02, 700)).toBeCloseTo(0.00137, 5);
  });

  it("peaks at P=0.5 (max Bernoulli variance) and shrinks toward the extremes", () => {
    const atHalf = rawFee(1, 0.5, 700);
    expect(rawFee(1, 0.5, 700)).toBeGreaterThan(rawFee(1, 0.3, 700));
    expect(rawFee(1, 0.3, 700)).toBeGreaterThan(rawFee(1, 0.1, 700));
    expect(rawFee(1, 0.1, 700)).toBeGreaterThan(rawFee(1, 0.02, 700));
    expect(rawFee(1, 0, 700)).toBe(0);
    expect(rawFee(1, 1, 700)).toBe(0);
    expect(atHalf).toBeCloseTo(0.07 * 0.25, 9);
  });

  it("maker rate is exactly 1/4 the taker rate", () => {
    expect(rawFee(10, 0.4, 175)).toBeCloseTo(rawFee(10, 0.4, 700) / 4, 9);
  });
});

describe("takerFee / makerFee — Credits-rounded (whole cents, house-favor ceil)", () => {
  it("scales cleanly at C=100 contracts, matching the §7.1 table x100", () => {
    expect(takerFee(100, 0.5)).toBe(credits(175)); // 1.75cr = 175 cents, exact
    expect(toDecimal(takerFee(100, 0.5))).toBeCloseTo(1.75, 9);
    expect(toDecimal(takerFee(100, 0.3))).toBeCloseTo(1.47, 9);
    expect(toDecimal(takerFee(100, 0.1))).toBeCloseTo(0.63, 9);
  });

  it("rounds a genuine sub-cent remainder UP (house's favor), never down", () => {
    // 0.07 * 100 * 0.02 * 0.98 = 0.1372 credits = 13.72 cents -> ceil to 14.
    const fee = takerFee(100, 0.02);
    expect(toDecimal(fee)).toBeCloseTo(0.14, 9);
  });

  it("a single $1-notional contract's fee rounds up to a whole cent even though the raw fee is sub-cent", () => {
    // 0.0175 credits = 1.75 cents -> ceil to 2 cents. This is the
    // documented precision loss from Bet's whole-cent Credits type vs.
    // Kalshi's centicent precision — see fees.ts's module doc comment.
    expect(toDecimal(takerFee(1, 0.5))).toBeCloseTo(0.02, 9);
  });

  it("is zero only when price is exactly 0 or 1 (fully resolved)", () => {
    expect(toDecimal(takerFee(10, 0))).toBe(0);
    expect(toDecimal(takerFee(10, 1))).toBe(0);
  });

  it("makerFee is a quarter of takerFee at the same contracts/price", () => {
    const taker = toDecimal(takerFee(400, 0.5)); // large enough to avoid rounding noise
    const maker = toDecimal(makerFee(400, 0.5));
    expect(maker).toBeCloseTo(taker / 4, 2);
  });
});
