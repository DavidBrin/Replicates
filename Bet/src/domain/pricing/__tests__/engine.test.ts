import { describe, expect, it } from "vitest";
import { PricingError, distributeLargestRemainder, toCreditsAtBoundary } from "../engine";

/**
 * `toCreditsAtBoundary` is the ONE seam every engine's decimal-credits math
 * crosses on its way to the integer-cent `Credits` type. It used to end in
 * `credits(rounded || 0)`, whose `|| 0` was written to normalize `-0` — but
 * `NaN || 0` is also `0`, so a non-finite computation upstream (e.g. LMSR's
 * out-of-domain `Math.log`) was laundered into a perfectly valid-looking
 * **zero-cost quote** instead of an error. Money must never be conjured
 * from a `NaN`: a non-finite amount is a bug and has to throw.
 */
describe("toCreditsAtBoundary — non-finite amounts must throw, never become 0", () => {
  it("throws on NaN rather than returning 0 credits", () => {
    expect(() => toCreditsAtBoundary(NaN, "down")).toThrow(PricingError);
    expect(() => toCreditsAtBoundary(NaN, "up")).toThrow(PricingError);
  });

  it("throws on ±Infinity", () => {
    expect(() => toCreditsAtBoundary(Number.POSITIVE_INFINITY, "up")).toThrow(PricingError);
    expect(() => toCreditsAtBoundary(Number.NEGATIVE_INFINITY, "down")).toThrow(PricingError);
  });

  it("still normalizes -0 to +0 (the behaviour `|| 0` was actually there for)", () => {
    expect(Object.is(toCreditsAtBoundary(-0, "up"), 0)).toBe(true);
    expect(Object.is(toCreditsAtBoundary(-0, "down"), 0)).toBe(true);
    expect(Object.is(toCreditsAtBoundary(-1e-9, "up"), 0)).toBe(true);
  });

  it("still rounds in the house's favour either way", () => {
    expect(toCreditsAtBoundary(1.751, "up")).toBe(176);
    expect(toCreditsAtBoundary(1.759, "down")).toBe(175);
    // Float noise that should land exactly on a cent boundary does not
    // manufacture an extra cent.
    expect(toCreditsAtBoundary(1.7499999999999998, "up")).toBe(175);
  });
});

describe("distributeLargestRemainder", () => {
  it("splits exactly, losing or conjuring no cent", () => {
    const parts = distributeLargestRemainder(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("returns zeros when every weight is zero", () => {
    expect(distributeLargestRemainder(100, [0, 0])).toEqual([0, 0]);
  });
});
