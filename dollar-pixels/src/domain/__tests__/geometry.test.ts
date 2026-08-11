import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BLOCK_PX,
  PIXELS_PER_BLOCK,
  PAGE_SIZES,
  blockToPixel,
  blocksIn,
  clampRect,
  eachBlock,
  gridForSize,
  gridPixelHeight,
  gridPixelWidth,
  isRectInside,
  packBlock,
  pixelToBlock,
  pixelsIn,
  rectContains,
  rectFromCorners,
  rectPixelSize,
  rectWithin,
  rectsOverlap,
  totalBlocks,
  totalPixels,
  unpackBlock,
  ZOOM_LEVELS,
} from "@/domain/geometry";

describe("the block is nine pixels", () => {
  it("is three by three", () => {
    expect(BLOCK_PX).toBe(3);
    expect(PIXELS_PER_BLOCK).toBe(9);
  });

  it("gives every page size a pixel dimension divisible by three", () => {
    // The whole reason the grid is 1200 and not 1000: a canvas that is not a
    // multiple of the block size splits blocks on two edges (DECISIONS D1).
    for (const size of Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]) {
      const dims = gridForSize(size);
      expect(gridPixelWidth(dims) % BLOCK_PX).toBe(0);
      expect(gridPixelHeight(dims) % BLOCK_PX).toBe(0);
    }
  });

  it("puts the flagship at 400x400 blocks and 1200x1200 pixels", () => {
    const dims = gridForSize("full");
    expect(dims).toEqual({ wBlocks: 400, hBlocks: 400 });
    expect(totalBlocks(dims)).toBe(160_000);
    expect(totalPixels(dims)).toBe(1_440_000);
    expect(gridPixelWidth(dims)).toBe(1200);
  });
});

describe("block and pixel conversion", () => {
  it("round-trips the top-left pixel of any block", () => {
    fc.assert(
      fc.property(fc.nat(399), fc.nat(399), (bx, by) => {
        const px = blockToPixel(bx, by);
        expect(pixelToBlock(px.x, px.y)).toEqual({ bx, by });
      }),
    );
  });

  it("maps every pixel inside a block back to that block", () => {
    fc.assert(
      fc.property(fc.nat(399), fc.nat(399), fc.nat(2), fc.nat(2), (bx, by, dx, dy) => {
        const px = blockToPixel(bx, by);
        expect(pixelToBlock(px.x + dx, px.y + dy)).toEqual({ bx, by });
      }),
    );
  });

  it("sizes a rect's tile at exactly three pixels per block", () => {
    expect(rectPixelSize({ bx: 0, by: 0, bw: 10, bh: 4 })).toEqual({
      width: 30,
      height: 12,
    });
  });
});

describe("rect construction", () => {
  it("normalises corners given in any order", () => {
    const expected = { bx: 2, by: 3, bw: 4, bh: 3 };
    expect(rectFromCorners(2, 3, 5, 5)).toEqual(expected);
    expect(rectFromCorners(5, 5, 2, 3)).toEqual(expected);
    expect(rectFromCorners(5, 3, 2, 5)).toEqual(expected);
    expect(rectFromCorners(2, 5, 5, 3)).toEqual(expected);
  });

  it("treats a single block as a 1x1, not an empty rect", () => {
    expect(rectFromCorners(7, 7, 7, 7)).toEqual({ bx: 7, by: 7, bw: 1, bh: 1 });
  });

  it("counts blocks and pixels", () => {
    const rect = { bx: 0, by: 0, bw: 10, bh: 10 };
    expect(blocksIn(rect)).toBe(100);
    expect(pixelsIn(rect)).toBe(900);
  });
});

describe("bounds", () => {
  const dims = { wBlocks: 400, hBlocks: 400 };

  it("accepts a rect flush against the far edge", () => {
    expect(isRectInside({ bx: 399, by: 399, bw: 1, bh: 1 }, dims)).toBe(true);
    expect(isRectInside({ bx: 390, by: 390, bw: 10, bh: 10 }, dims)).toBe(true);
  });

  it("rejects one block past it", () => {
    expect(isRectInside({ bx: 400, by: 0, bw: 1, bh: 1 }, dims)).toBe(false);
    expect(isRectInside({ bx: 391, by: 0, bw: 10, bh: 1 }, dims)).toBe(false);
  });

  it("rejects negatives, zero extents and non-integers", () => {
    expect(isRectInside({ bx: -1, by: 0, bw: 1, bh: 1 }, dims)).toBe(false);
    expect(isRectInside({ bx: 0, by: 0, bw: 0, bh: 1 }, dims)).toBe(false);
    expect(isRectInside({ bx: 0.5, by: 0, bw: 1, bh: 1 }, dims)).toBe(false);
    expect(isRectInside({ bx: 0, by: 0, bw: 1.5, bh: 1 }, dims)).toBe(false);
  });

  it("clamps an overhanging rect and returns null when nothing survives", () => {
    expect(clampRect({ bx: 395, by: 0, bw: 20, bh: 2 }, dims)).toEqual({
      bx: 395,
      by: 0,
      bw: 5,
      bh: 2,
    });
    expect(clampRect({ bx: 400, by: 400, bw: 5, bh: 5 }, dims)).toBeNull();
  });
});

describe("overlap and containment", () => {
  it("does not count edge-adjacent rects as overlapping", () => {
    const a = { bx: 0, by: 0, bw: 4, bh: 4 };
    expect(rectsOverlap(a, { bx: 4, by: 0, bw: 4, bh: 4 })).toBe(false);
    expect(rectsOverlap(a, { bx: 3, by: 0, bw: 4, bh: 4 })).toBe(true);
  });

  it("accepts a rect inside another, including flush against its edges", () => {
    // Settlement checks a claim's rect against the hold it is settling.
    // Without this an order could reserve one block and claim four thousand.
    const outer = { bx: 10, by: 10, bw: 10, bh: 10 };
    expect(rectWithin({ bx: 10, by: 10, bw: 10, bh: 10 }, outer)).toBe(true);
    expect(rectWithin({ bx: 12, by: 12, bw: 2, bh: 2 }, outer)).toBe(true);
    expect(rectWithin({ bx: 19, by: 19, bw: 1, bh: 1 }, outer)).toBe(true);
  });

  it("rejects a rect that pokes out on any side", () => {
    const outer = { bx: 10, by: 10, bw: 10, bh: 10 };
    expect(rectWithin({ bx: 9, by: 10, bw: 2, bh: 2 }, outer)).toBe(false);
    expect(rectWithin({ bx: 10, by: 9, bw: 2, bh: 2 }, outer)).toBe(false);
    expect(rectWithin({ bx: 19, by: 10, bw: 2, bh: 2 }, outer)).toBe(false);
    expect(rectWithin({ bx: 10, by: 19, bw: 2, bh: 2 }, outer)).toBe(false);
    expect(rectWithin(outer, { bx: 12, by: 12, bw: 2, bh: 2 })).toBe(false);
  });

  it("contains its own blocks and not the one past its edge", () => {
    const rect = { bx: 2, by: 2, bw: 3, bh: 3 };
    expect(rectContains(rect, 2, 2)).toBe(true);
    expect(rectContains(rect, 4, 4)).toBe(true);
    expect(rectContains(rect, 5, 4)).toBe(false);
  });

  it("enumerates exactly its blocks, row-major", () => {
    const seen = [...eachBlock({ bx: 1, by: 1, bw: 2, bh: 2 })];
    expect(seen).toEqual([
      { bx: 1, by: 1 },
      { bx: 2, by: 1 },
      { bx: 1, by: 2 },
      { bx: 2, by: 2 },
    ]);
  });
});

describe("packing", () => {
  it("round-trips every coordinate on the flagship grid", () => {
    const dims = { wBlocks: 400, hBlocks: 400 };
    fc.assert(
      fc.property(fc.nat(399), fc.nat(399), (bx, by) => {
        expect(unpackBlock(packBlock(bx, by, dims), dims)).toEqual({ bx, by });
      }),
    );
  });

  it("is injective across the grid", () => {
    const dims = { wBlocks: 8, hBlocks: 8 };
    const keys = new Set<number>();
    for (const { bx, by } of eachBlock({ bx: 0, by: 0, bw: 8, bh: 8 })) {
      keys.add(packBlock(bx, by, dims));
    }
    expect(keys.size).toBe(64);
  });
});

describe("zoom", () => {
  it("offers integer factors only, so a block edge never lands mid-pixel", () => {
    for (const z of ZOOM_LEVELS) {
      expect(Number.isInteger(z)).toBe(true);
      expect(Number.isInteger(BLOCK_PX * z)).toBe(true);
    }
  });
});
