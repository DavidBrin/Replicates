/**
 * Block -> claim lookup for the renderer.
 *
 * The snapshot carries rectangles, not cells (DECISIONS D15), so the client
 * expands them once per snapshot into a map sized to the number of *owned*
 * blocks. An untouched 400x400 page therefore costs one empty Map, not 160,000
 * entries — the whole point of shipping rectangles.
 *
 * Keys are packed integers from `packBlock`: pointer-move hit-testing hits this
 * on every mouse event, and a `${bx},${by}` key would allocate a string per look.
 */

import {
  eachBlock,
  packBlock,
  type GridDims,
  type BlockRect,
} from "@/domain/geometry";
import type { GridSnapshot, SnapshotClaim, SnapshotHold } from "@/domain/snapshot";

export interface ClaimIndex {
  readonly dims: GridDims;
  /** The claim owning a block, or null. Out-of-grid coordinates read as null. */
  claimAt(bx: number, by: number): SnapshotClaim | null;
  /** The hold over a block, expired or not — callers deciding availability use `isAvailable`. */
  holdAt(bx: number, by: number): SnapshotHold | null;
  /** Free to buy at `now` (epoch ms): inside the grid, unclaimed, and unheld. */
  isAvailable(bx: number, by: number, now: number): boolean;
  /** Holds still live at `now`, for the overlay's unavailable tint. */
  activeHolds(now: number): readonly BlockRect[];
}

interface HeldBlock {
  readonly hold: SnapshotHold;
  /** Parsed once at build time; an unparseable instant is treated as expired. */
  readonly expiresAtMs: number;
}

export function buildClaimIndex(snapshot: GridSnapshot): ClaimIndex {
  const dims: GridDims = { wBlocks: snapshot.wBlocks, hBlocks: snapshot.hBlocks };

  const claims = new Map<number, SnapshotClaim>();
  for (const claim of snapshot.claims) {
    for (const { bx, by } of eachBlock(claim.rect)) {
      if (!inside(bx, by, dims)) continue;
      claims.set(packBlock(bx, by, dims), claim);
    }
  }

  const holds = new Map<number, HeldBlock>();
  for (const hold of snapshot.holds) {
    const expiresAtMs = Date.parse(hold.expiresAt);
    const entry: HeldBlock = {
      hold,
      expiresAtMs: Number.isNaN(expiresAtMs) ? Number.NEGATIVE_INFINITY : expiresAtMs,
    };
    for (const { bx, by } of eachBlock(hold.rect)) {
      if (!inside(bx, by, dims)) continue;
      holds.set(packBlock(bx, by, dims), entry);
    }
  }

  // The bounds checks below are not defensive noise: `packBlock` is a row-major
  // multiply, so bx = wBlocks would silently alias the first block of the next
  // row and report a neighbour's claim.
  return {
    dims,
    claimAt(bx, by) {
      if (!inside(bx, by, dims)) return null;
      return claims.get(packBlock(bx, by, dims)) ?? null;
    },
    holdAt(bx, by) {
      if (!inside(bx, by, dims)) return null;
      return holds.get(packBlock(bx, by, dims))?.hold ?? null;
    },
    isAvailable(bx, by, now) {
      if (!inside(bx, by, dims)) return false;
      const key = packBlock(bx, by, dims);
      if (claims.has(key)) return false;
      const held = holds.get(key);
      // A hold expires by being read, never by being swept (DECISIONS D9), so
      // the client applies the same rule the server will apply at checkout.
      return held === undefined || held.expiresAtMs <= now;
    },
    activeHolds(now) {
      const live: BlockRect[] = [];
      for (const hold of snapshot.holds) {
        const expiresAtMs = Date.parse(hold.expiresAt);
        if (!Number.isNaN(expiresAtMs) && expiresAtMs > now) live.push(hold.rect);
      }
      return live;
    },
  };
}

function inside(bx: number, by: number, dims: GridDims): boolean {
  return (
    Number.isInteger(bx) &&
    Number.isInteger(by) &&
    bx >= 0 &&
    by >= 0 &&
    bx < dims.wBlocks &&
    by < dims.hBlocks
  );
}
