import { describe, expect, it } from "vitest";

import type { GridSnapshot, SnapshotClaim, SnapshotHold } from "@/domain/snapshot";
import { buildClaimIndex } from "@/components/grid/claim-index";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const SOON = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

function claim(over: Partial<SnapshotClaim> = {}): SnapshotClaim {
  return {
    id: "c1",
    rect: { bx: 2, by: 1, bw: 2, bh: 3 },
    caption: "hi",
    colour: "#123456",
    tile: null,
    ownerName: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function snapshotOf(
  claims: readonly SnapshotClaim[] = [],
  holds: readonly SnapshotHold[] = [],
  wBlocks = 10,
  hBlocks = 10,
): GridSnapshot {
  return {
    slug: "the-wall",
    title: "The Wall",
    kind: "flagship",
    size: "full",
    wBlocks,
    hBlocks,
    totalBlocks: wBlocks * hBlocks,
    soldBlocks: claims.reduce((n, c) => n + c.rect.bw * c.rect.bh, 0),
    claims,
    holds,
    takenAt: "2026-08-10T12:00:00.000Z",
  };
}

describe("buildClaimIndex", () => {
  it("finds a claim at every block of its rectangle and nowhere else", () => {
    const index = buildClaimIndex(snapshotOf([claim()]));

    expect(index.claimAt(2, 1)?.id).toBe("c1");
    expect(index.claimAt(3, 3)?.id).toBe("c1");
    expect(index.claimAt(4, 1)).toBeNull(); // one past the right edge
    expect(index.claimAt(2, 4)).toBeNull(); // one past the bottom edge
    expect(index.claimAt(0, 0)).toBeNull();
  });

  it("never aliases an out-of-grid coordinate onto a neighbouring row", () => {
    // packBlock is a row-major multiply: bx === wBlocks would collide with the
    // first block of the next row, which owns a claim here.
    const index = buildClaimIndex(snapshotOf([claim({ rect: { bx: 0, by: 3, bw: 1, bh: 1 } })]));

    expect(index.claimAt(0, 3)?.id).toBe("c1");
    expect(index.claimAt(10, 2)).toBeNull();
    expect(index.claimAt(-1, 3)).toBeNull();
    expect(index.claimAt(0, 10)).toBeNull();
    expect(index.isAvailable(10, 2, NOW)).toBe(false);
    expect(index.isAvailable(1.5, 3, NOW)).toBe(false);
  });

  it("treats an owned block as unavailable and an empty one as available", () => {
    const index = buildClaimIndex(snapshotOf([claim()]));

    expect(index.isAvailable(2, 1, NOW)).toBe(false);
    expect(index.isAvailable(9, 9, NOW)).toBe(true);
  });

  it("treats a live hold as unavailable", () => {
    const index = buildClaimIndex(
      snapshotOf([], [{ rect: { bx: 5, by: 5, bw: 2, bh: 1 }, expiresAt: SOON }]),
    );

    expect(index.isAvailable(5, 5, NOW)).toBe(false);
    expect(index.isAvailable(6, 5, NOW)).toBe(false);
    expect(index.isAvailable(7, 5, NOW)).toBe(true);
    expect(index.holdAt(5, 5)?.expiresAt).toBe(SOON);
  });

  it("treats an expired hold as available — a hold expires by being read (D9)", () => {
    const hold: SnapshotHold = { rect: { bx: 5, by: 5, bw: 1, bh: 1 }, expiresAt: PAST };
    const index = buildClaimIndex(snapshotOf([], [hold]));

    expect(index.isAvailable(5, 5, NOW)).toBe(true);
    // The row is still there — nothing swept it — it simply does not count.
    expect(index.holdAt(5, 5)).toEqual(hold);
    expect(index.activeHolds(NOW)).toEqual([]);
    // …and the same index read at a moment before the expiry says otherwise.
    expect(index.isAvailable(5, 5, Date.parse(PAST) - 1)).toBe(false);
  });

  it("reports only unexpired holds for the overlay tint", () => {
    const live: SnapshotHold = { rect: { bx: 1, by: 1, bw: 1, bh: 1 }, expiresAt: SOON };
    const index = buildClaimIndex(
      snapshotOf([], [live, { rect: { bx: 2, by: 2, bw: 1, bh: 1 }, expiresAt: PAST }]),
    );

    expect(index.activeHolds(NOW)).toEqual([live.rect]);
  });

  it("lets a claim win over a stale hold on the same block", () => {
    const index = buildClaimIndex(
      snapshotOf(
        [claim({ rect: { bx: 0, by: 0, bw: 1, bh: 1 } })],
        [{ rect: { bx: 0, by: 0, bw: 1, bh: 1 }, expiresAt: PAST }],
      ),
    );

    expect(index.isAvailable(0, 0, NOW)).toBe(false);
    expect(index.claimAt(0, 0)?.id).toBe("c1");
  });

  it("treats an unparseable expiry as expired rather than locking the block forever", () => {
    const index = buildClaimIndex(
      snapshotOf([], [{ rect: { bx: 0, by: 0, bw: 1, bh: 1 }, expiresAt: "not a date" }]),
    );

    expect(index.isAvailable(0, 0, NOW)).toBe(true);
    expect(index.activeHolds(NOW)).toEqual([]);
  });

  it("costs nothing on an empty 400 x 400 page", () => {
    const index = buildClaimIndex(snapshotOf([], [], 400, 400));

    expect(index.dims).toEqual({ wBlocks: 400, hBlocks: 400 });
    expect(index.claimAt(399, 399)).toBeNull();
    expect(index.isAvailable(399, 399, NOW)).toBe(true);
    expect(index.isAvailable(400, 0, NOW)).toBe(false);
  });

  it("ignores the part of a claim that falls outside the grid", () => {
    // Blocks 10 and 11 of row 0 do not exist; packed, they are row 1's blocks 0
    // and 1, so storing them would hand the next row someone else's claim.
    const index = buildClaimIndex(
      snapshotOf([claim({ rect: { bx: 9, by: 0, bw: 3, bh: 1 } })]),
    );

    expect(index.claimAt(9, 0)?.id).toBe("c1");
    expect(index.claimAt(0, 1)).toBeNull();
    expect(index.isAvailable(1, 1, NOW)).toBe(true);
  });
});
