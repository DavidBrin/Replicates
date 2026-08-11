import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BLOCK_PRICE_CENTS,
  PRIVATE_PAGE_ALLOWANCE,
  PRIVATE_PAGE_PRICE_CENTS,
  allowanceFor,
  pagePrice,
  premiumPagePrice,
  rectPrice,
  selectionPrice,
  splitBlockRevenue,
} from "@/domain/pricing";
import { PAGE_SIZES, PIXELS_PER_BLOCK, gridForSize, totalBlocks } from "@/domain/geometry";
import { formatUsd, formatUsdCompact, splitBps } from "@/domain/money";

describe("a dollar buys nine pixels", () => {
  it("prices one block at one dollar", () => {
    expect(BLOCK_PRICE_CENTS).toBe(100);
    expect(selectionPrice(1)).toBe(100);
  });

  it("keeps the nine-pixels-per-dollar ratio at every selection size", () => {
    fc.assert(
      fc.property(fc.nat(4_000), (blocks) => {
        const cents = selectionPrice(blocks);
        expect(cents / 100).toBe(blocks);
        expect((blocks * PIXELS_PER_BLOCK) / 9).toBe(cents / 100);
      }),
    );
  });

  it("prices a rectangle by its area", () => {
    expect(rectPrice({ bx: 0, by: 0, bw: 10, bh: 10 })).toBe(10_000);
  });

  it("refuses a nonsense block count rather than pricing it", () => {
    expect(() => selectionPrice(-1)).toThrow(RangeError);
    expect(() => selectionPrice(1.5)).toThrow(RangeError);
  });
});

describe("page prices", () => {
  it("charges a flat ten dollars for an unlisted page at any size", () => {
    expect(PRIVATE_PAGE_PRICE_CENTS).toBe(1_000);
    for (const size of Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]) {
      expect(pagePrice("private", size)).toBe(1_000);
    }
  });

  it("charges half the face value for a premium page", () => {
    for (const size of Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]) {
      const blocks = totalBlocks(gridForSize(size));
      const faceValue = selectionPrice(blocks);
      expect(premiumPagePrice(size)).toBe(faceValue / 2);
      expect(premiumPagePrice(size)).toBe(blocks * 50);
    }
  });

  it("lands on the documented figures", () => {
    expect(formatUsdCompact(premiumPagePrice("small"))).toBe("$7,200");
    expect(formatUsdCompact(premiumPagePrice("medium"))).toBe("$28,800");
    expect(formatUsdCompact(premiumPagePrice("full"))).toBe("$80,000");
  });

  it("stays an integer number of cents at every size", () => {
    // `blocks * 0.5` would be the natural way to write "half price" and is
    // exactly how a creator's balance would start drifting (DECISIONS D3).
    for (const size of Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]) {
      expect(Number.isSafeInteger(premiumPagePrice(size))).toBe(true);
    }
  });

  it("pays for itself at half sold and doubles at full", () => {
    const size = "medium" as const;
    const blocks = totalBlocks(gridForSize(size));
    const cost = premiumPagePrice(size);
    expect(selectionPrice(Math.floor(blocks / 2))).toBe(cost);
    expect(selectionPrice(blocks)).toBe(cost * 2);
  });
});

describe("the free allowance", () => {
  it("gives an unlisted page's creator sixty-nine blocks and nobody else any", () => {
    expect(PRIVATE_PAGE_ALLOWANCE).toBe(69);
    expect(allowanceFor("private")).toBe(69);
    expect(allowanceFor("premium")).toBe(0);
    expect(allowanceFor("flagship")).toBe(0);
  });
});

describe("where a block payment goes", () => {
  it("gives everything to the platform on the flagship and unlisted pages", () => {
    expect(splitBlockRevenue(100, "flagship", false, 0)).toEqual({
      creatorCents: 0,
      platformCents: 100,
    });
    expect(splitBlockRevenue(100, "private", true, 0)).toEqual({
      creatorCents: 0,
      platformCents: 100,
    });
  });

  it("gives everything to a premium creator when the fee is zero", () => {
    // The product's promise, taken literally (DECISIONS D5).
    expect(splitBlockRevenue(5_000, "premium", true, 0)).toEqual({
      creatorCents: 5_000,
      platformCents: 0,
    });
  });

  it("takes the configured fee off the creator's share", () => {
    expect(splitBlockRevenue(10_000, "premium", true, 250)).toEqual({
      creatorCents: 9_750,
      platformCents: 250,
    });
  });

  it("falls back to the platform on a premium page with no creator", () => {
    expect(splitBlockRevenue(100, "premium", false, 0)).toEqual({
      creatorCents: 0,
      platformCents: 100,
    });
  });

  it("never creates or loses a cent, at any amount or fee", () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.nat(10_000), (amount, bps) => {
        const split = splitBlockRevenue(amount, "premium", true, bps);
        expect(split.creatorCents + split.platformCents).toBe(amount);
        expect(Number.isSafeInteger(split.creatorCents)).toBe(true);
        expect(Number.isSafeInteger(split.platformCents)).toBe(true);
        expect(split.creatorCents).toBeGreaterThanOrEqual(0);
        expect(split.platformCents).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("puts the odd cent on the platform rather than inventing one", () => {
    // 1 cent at 50% cannot be halved. Rounding both sides independently would
    // produce either 0 or 2 cents in total.
    const split = splitBlockRevenue(1, "premium", true, 5_000);
    expect(split.creatorCents + split.platformCents).toBe(1);
  });

  it("rejects a fee outside basis points instead of clamping it", () => {
    expect(() => splitBps(100, -1)).toThrow(RangeError);
    expect(() => splitBps(100, 10_001)).toThrow(RangeError);
    expect(() => splitBps(100, 1.5)).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("groups thousands and always shows cents", () => {
    expect(formatUsd(100)).toBe("$1.00");
    expect(formatUsd(16_000_000)).toBe("$160,000.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(-250)).toBe("-$2.50");
  });

  it("drops trailing cents only when there are none", () => {
    expect(formatUsdCompact(100)).toBe("$1");
    expect(formatUsdCompact(150)).toBe("$1.50");
  });
});
