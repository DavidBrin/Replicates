/**
 * Block geometry — the only module that knows a block is nine pixels.
 *
 * Everything else in the codebase addresses the grid in *blocks*. The
 * conversion to pixels happens here and nowhere else, which is what makes
 * "a block of nine pixels is never split" true by construction rather than
 * by vigilance: there is no type anywhere that can describe a partial block,
 * so there is no code path that can sell one (DECISIONS D2).
 */

/** A block is 3 x 3 pixels. Nine pixels, one dollar. */
export const BLOCK_PX = 3;

/** Pixels in one block. Derived, never hardcoded elsewhere. */
export const PIXELS_PER_BLOCK = BLOCK_PX * BLOCK_PX;

/**
 * The largest selection one claim may cover.
 *
 * Bounds the tile payload and stops a single request swallowing an entire
 * grid. 4,000 blocks is a 60x60-ish claim: 180x180 pixels, comfortably the
 * biggest thing anyone would want to place.
 */
export const MAX_SELECTION_BLOCKS = 4_000;

/** Page sizes. Square, and multiples of BLOCK_PX in pixels by construction. */
export const PAGE_SIZES = {
  small: 120,
  medium: 240,
  full: 400,
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

export const PAGE_SIZE_IDS = Object.keys(PAGE_SIZES) as readonly PageSize[];

export function isPageSize(value: unknown): value is PageSize {
  return typeof value === "string" && value in PAGE_SIZES;
}

/** Grid dimensions, in blocks. Always square in this product, but the type is not. */
export interface GridDims {
  readonly wBlocks: number;
  readonly hBlocks: number;
}

/** An axis-aligned rectangle of blocks. `bw`/`bh` are counts, never coordinates. */
export interface BlockRect {
  readonly bx: number;
  readonly by: number;
  readonly bw: number;
  readonly bh: number;
}

export function gridForSize(size: PageSize): GridDims {
  const n = PAGE_SIZES[size];
  return { wBlocks: n, hBlocks: n };
}

export function totalBlocks(dims: GridDims): number {
  return dims.wBlocks * dims.hBlocks;
}

export function totalPixels(dims: GridDims): number {
  return totalBlocks(dims) * PIXELS_PER_BLOCK;
}

/** Grid width in pixels. Always a multiple of BLOCK_PX. */
export function gridPixelWidth(dims: GridDims): number {
  return dims.wBlocks * BLOCK_PX;
}

export function gridPixelHeight(dims: GridDims): number {
  return dims.hBlocks * BLOCK_PX;
}

export function blocksIn(rect: BlockRect): number {
  return rect.bw * rect.bh;
}

export function pixelsIn(rect: BlockRect): number {
  return blocksIn(rect) * PIXELS_PER_BLOCK;
}

/** Top-left pixel of a block. The only block -> pixel conversion in the app. */
export function blockToPixel(bx: number, by: number): { x: number; y: number } {
  return { x: bx * BLOCK_PX, y: by * BLOCK_PX };
}

/** Pixel -> block. Floors, so any pixel inside a block maps to that block. */
export function pixelToBlock(x: number, y: number): { bx: number; by: number } {
  return { bx: Math.floor(x / BLOCK_PX), by: Math.floor(y / BLOCK_PX) };
}

/** A rectangle's pixel footprint — exactly what a tile image must measure. */
export function rectPixelSize(rect: BlockRect): { width: number; height: number } {
  return { width: rect.bw * BLOCK_PX, height: rect.bh * BLOCK_PX };
}

/**
 * Build a normalised rect from two block corners, in any order.
 *
 * Drag-select hands us an anchor and a moving corner; either may be the
 * smaller. Both corners are inclusive, so a click on one block yields a 1x1.
 */
export function rectFromCorners(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): BlockRect {
  const x0 = Math.min(ax, bx);
  const y0 = Math.min(ay, by);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  return { bx: x0, by: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
}

/** Clamp a rect to the grid, returning null if nothing survives. */
export function clampRect(rect: BlockRect, dims: GridDims): BlockRect | null {
  const x0 = Math.max(0, rect.bx);
  const y0 = Math.max(0, rect.by);
  const x1 = Math.min(dims.wBlocks, rect.bx + rect.bw);
  const y1 = Math.min(dims.hBlocks, rect.by + rect.bh);
  if (x1 <= x0 || y1 <= y0) return null;
  return { bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0 };
}

export function isRectInside(rect: BlockRect, dims: GridDims): boolean {
  return (
    Number.isInteger(rect.bx) &&
    Number.isInteger(rect.by) &&
    Number.isInteger(rect.bw) &&
    Number.isInteger(rect.bh) &&
    rect.bw > 0 &&
    rect.bh > 0 &&
    rect.bx >= 0 &&
    rect.by >= 0 &&
    rect.bx + rect.bw <= dims.wBlocks &&
    rect.by + rect.bh <= dims.hBlocks
  );
}

export function rectsOverlap(a: BlockRect, b: BlockRect): boolean {
  return (
    a.bx < b.bx + b.bw &&
    b.bx < a.bx + a.bw &&
    a.by < b.by + b.bh &&
    b.by < a.by + a.bh
  );
}

/**
 * Is `inner` entirely inside `outer`?
 *
 * Used at settlement to check a claim's rectangle against the hold it is
 * settling. Without it an order could reserve one block and claim four
 * thousand — the payload is written at checkout but the claim is written at
 * settlement, and nothing else compares the two.
 */
export function rectWithin(inner: BlockRect, outer: BlockRect): boolean {
  return (
    inner.bx >= outer.bx &&
    inner.by >= outer.by &&
    inner.bx + inner.bw <= outer.bx + outer.bw &&
    inner.by + inner.bh <= outer.by + outer.bh
  );
}

export function rectContains(rect: BlockRect, bx: number, by: number): boolean {
  return (
    bx >= rect.bx && bx < rect.bx + rect.bw && by >= rect.by && by < rect.by + rect.bh
  );
}

/**
 * Pack a block coordinate into one integer key.
 *
 * The renderer builds a Map from these to claims, once per snapshot. Packing
 * beats a `${bx},${by}` string key: no allocation per lookup, and pointer-move
 * hit-testing runs on every mouse event.
 */
export function packBlock(bx: number, by: number, dims: GridDims): number {
  return by * dims.wBlocks + bx;
}

export function unpackBlock(key: number, dims: GridDims): { bx: number; by: number } {
  return { bx: key % dims.wBlocks, by: Math.floor(key / dims.wBlocks) };
}

/** Every block coordinate in a rect, in row-major order. */
export function* eachBlock(rect: BlockRect): Generator<{ bx: number; by: number }> {
  for (let dy = 0; dy < rect.bh; dy++) {
    for (let dx = 0; dx < rect.bw; dx++) {
      yield { bx: rect.bx + dx, by: rect.by + dy };
    }
  }
}

/** Integer zoom levels only, so a block edge always lands on a whole pixel. */
export const ZOOM_LEVELS = [1, 2, 4] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];
