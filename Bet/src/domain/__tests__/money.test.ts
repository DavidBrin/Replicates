import { describe, expect, it } from "vitest";
import {
  add,
  clamp,
  compare,
  credits,
  fromDecimal,
  isNegative,
  mul,
  sub,
  toDecimal,
  zero,
} from "../money";

describe("credits()", () => {
  it("accepts integer cent values, including zero and negative", () => {
    expect(credits(0)).toBe(0);
    expect(credits(1240)).toBe(1240);
    expect(credits(-500)).toBe(-500);
  });

  it("accepts large integer values", () => {
    expect(credits(1_000_000_000)).toBe(1_000_000_000);
  });

  it("throws on non-integer input", () => {
    expect(() => credits(12.5)).toThrow(RangeError);
  });

  it("throws on non-finite input", () => {
    expect(() => credits(Infinity)).toThrow(RangeError);
    expect(() => credits(-Infinity)).toThrow(RangeError);
    expect(() => credits(NaN)).toThrow(RangeError);
  });
});

describe("zero()", () => {
  it("is 0", () => {
    expect(zero()).toBe(0);
  });
});

describe("fromDecimal()", () => {
  it("converts a decimal credit amount to integer cents", () => {
    expect(fromDecimal(12.4)).toBe(1240);
    expect(fromDecimal(0)).toBe(0);
    expect(fromDecimal(-5)).toBe(-500);
  });

  it("rounds half away from zero", () => {
    expect(fromDecimal(0.005)).toBe(1); // 0.5 cents -> 1 cent
    expect(fromDecimal(-0.005)).toBe(-1);
  });

  it("throws on non-finite input", () => {
    expect(() => fromDecimal(NaN)).toThrow(RangeError);
    expect(() => fromDecimal(Infinity)).toThrow(RangeError);
  });
});

describe("toDecimal()", () => {
  it("is the inverse of fromDecimal for exact cent values", () => {
    expect(toDecimal(credits(1240))).toBe(12.4);
    expect(toDecimal(credits(0))).toBe(0);
    expect(toDecimal(credits(-500))).toBe(-5);
  });
});

describe("add() / sub()", () => {
  it("adds and subtracts", () => {
    expect(add(credits(100), credits(50))).toBe(150);
    expect(sub(credits(100), credits(50))).toBe(50);
  });

  it("handles negative results", () => {
    expect(sub(credits(50), credits(100))).toBe(-50);
  });

  it("handles zero operands", () => {
    expect(add(zero(), credits(100))).toBe(100);
    expect(sub(credits(100), zero())).toBe(100);
  });

  it("handles large values", () => {
    expect(add(credits(999_999_999), credits(1))).toBe(1_000_000_000);
  });
});

describe("mul()", () => {
  it("rounds toward positive infinity with 'up'", () => {
    expect(mul(credits(100), 0.5, "up")).toBe(50); // exact, no rounding needed
    expect(mul(credits(101), 0.5, "up")).toBe(51); // 50.5 -> 51
    expect(mul(credits(-101), 0.5, "up")).toBe(-50); // -50.5 -> -50 (toward +inf)
  });

  it("rounds toward negative infinity with 'down'", () => {
    expect(mul(credits(101), 0.5, "down")).toBe(50); // 50.5 -> 50
    expect(mul(credits(-101), 0.5, "down")).toBe(-51); // -50.5 -> -51 (toward -inf)
  });

  it("rounds half away from zero with 'nearest'", () => {
    expect(mul(credits(101), 0.5, "nearest")).toBe(51); // 50.5 -> 51
    expect(mul(credits(-101), 0.5, "nearest")).toBe(-51); // -50.5 -> -51
    expect(mul(credits(100), 0.501, "nearest")).toBe(50); // 50.1 -> 50
  });

  it("handles a zero factor and a zero amount", () => {
    expect(mul(credits(1000), 0, "nearest")).toBe(0);
    expect(mul(zero(), 0.5, "nearest")).toBe(0);
  });

  it("handles large values", () => {
    expect(mul(credits(1_000_000_00), 1.5, "nearest")).toBe(150_000_000);
  });

  it("throws on a non-finite factor", () => {
    expect(() => mul(credits(100), Infinity, "nearest")).toThrow(RangeError);
    expect(() => mul(credits(100), NaN, "up")).toThrow(RangeError);
  });
});

describe("compare()", () => {
  it("orders values", () => {
    expect(compare(credits(50), credits(100))).toBe(-1);
    expect(compare(credits(100), credits(50))).toBe(1);
    expect(compare(credits(50), credits(50))).toBe(0);
  });

  it("handles negative values", () => {
    expect(compare(credits(-100), credits(-50))).toBe(-1);
  });
});

describe("clamp()", () => {
  it("passes through values inside the range", () => {
    expect(clamp(credits(50), credits(0), credits(100))).toBe(50);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clamp(credits(-10), credits(0), credits(100))).toBe(0);
    expect(clamp(credits(200), credits(0), credits(100))).toBe(100);
  });

  it("throws when min > max", () => {
    expect(() => clamp(credits(50), credits(100), credits(0))).toThrow(RangeError);
  });
});

describe("isNegative()", () => {
  it("classifies negative, zero, and positive", () => {
    expect(isNegative(credits(-1))).toBe(true);
    expect(isNegative(credits(0))).toBe(false);
    expect(isNegative(credits(1))).toBe(false);
  });
});
