import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { GLANCING_BLOW_DEPTH } from "./constants";
import { fx, sqrt } from "./fixed";
import {
  SMASH_BALL_TARGET,
  activeHitboxes,
  alreadyHit,
  bestHitbox,
  capsulesOverlap,
  circle,
  circlesOverlap,
  clearHitRecord,
  hitboxWorldPos,
  hurtboxCapsule,
  markHit,
  pointSegmentDistSq,
  resolveClank,
  segmentSegmentDistSq,
  segmentsIntersect,
  sweptCapsuleOverlaps,
  sweptCapsulePenetration,
  sweptHitboxOverlaps,
  sweptHitboxPenetration,
} from "./hitbox";
import type { Capsule } from "./hitbox";
import type { FighterAttributes, Hitbox, MoveDef } from "./types";

function hitbox(over: Partial<Hitbox> = {}): Hitbox {
  return {
    id: 0,
    startFrame: 1,
    endFrame: 3,
    x: 0,
    y: 0,
    radius: fx(4),
    damage: fx(10),
    angle: fx(45),
    baseKnockback: fx(30),
    knockbackGrowth: fx(100),
    ...over,
  };
}

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.76),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: true,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

describe("circle overlap", () => {
  it("touches when the gap equals the sum of the radii", () => {
    expect(circlesOverlap(0, 0, fx(3), fx(5), 0, fx(2))).toBe(true);
    expect(circlesOverlap(0, 0, fx(3), fx(5.1), 0, fx(2))).toBe(false);
  });

  it("is symmetric", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (dx, dy, r) => {
          const a = circlesOverlap(0, 0, fx(r), fx(dx), fx(dy), fx(r));
          const b = circlesOverlap(fx(dx), fx(dy), fx(r), 0, 0, fx(r));
          return a === b;
        },
      ),
    );
  });
});

describe("segment geometry", () => {
  it("measures the distance from a point to a segment, clamped to its ends", () => {
    // Straight out from the middle of the segment.
    expect(pointSegmentDistSq(0, fx(3), fx(-5), 0, fx(5), 0)).toBe(fx(9));
    // Past the end: the distance is to the endpoint, not the infinite line.
    expect(pointSegmentDistSq(fx(8), 0, fx(-5), 0, fx(5), 0)).toBe(fx(9));
  });

  it("detects crossing segments", () => {
    expect(segmentsIntersect(fx(-5), 0, fx(5), 0, 0, fx(-5), 0, fx(5))).toBe(true);
    expect(segmentsIntersect(fx(-5), 0, fx(-1), 0, 0, fx(-5), 0, fx(5))).toBe(false);
  });

  it("reports zero distance for crossing segments", () => {
    const a: Capsule = { x1: fx(-5), y1: 0, x2: fx(5), y2: 0, r: 0 };
    const b: Capsule = { x1: 0, y1: fx(-5), x2: 0, y2: fx(5), r: 0 };
    expect(segmentSegmentDistSq(a, b)).toBe(0);
  });

  it("finds the minimum between parallel segments", () => {
    const a: Capsule = { x1: fx(-5), y1: 0, x2: fx(5), y2: 0, r: 0 };
    const b: Capsule = { x1: fx(-5), y1: fx(4), x2: fx(5), y2: fx(4), r: 0 };
    expect(segmentSegmentDistSq(a, b)).toBe(fx(16));
  });
});

describe("capsule overlap", () => {
  it("overlaps when the spines are within the summed radii", () => {
    const a: Capsule = { x1: 0, y1: 0, x2: 0, y2: fx(10), r: fx(2) };
    const b: Capsule = { x1: fx(3), y1: 0, x2: fx(3), y2: fx(10), r: fx(2) };
    expect(capsulesOverlap(a, b)).toBe(true);
    const far: Capsule = { x1: fx(5), y1: 0, x2: fx(5), y2: fx(10), r: fx(2) };
    expect(capsulesOverlap(a, far)).toBe(false);
  });
});

describe("swept hitboxes", () => {
  /**
   * The whole reason sweeping exists: a hitbox that crosses a fighter inside one
   * frame must connect. Sampled at either end of its travel it misses entirely.
   */
  it("catches a target the endpoints both miss", () => {
    const target = circle(0, 0, fx(3));
    expect(circlesOverlap(fx(-50), 0, fx(2), 0, 0, fx(3))).toBe(false);
    expect(circlesOverlap(fx(50), 0, fx(2), 0, 0, fx(3))).toBe(false);
    expect(sweptHitboxOverlaps(fx(-50), 0, fx(50), 0, fx(2), target)).toBe(true);
  });

  it("still misses a target the sweep passes nowhere near", () => {
    const target = circle(0, fx(40), fx(3));
    expect(sweptHitboxOverlaps(fx(-50), 0, fx(50), 0, fx(2), target)).toBe(false);
  });

  it("degenerates to a plain overlap when the hitbox did not move", () => {
    const target = circle(0, 0, fx(3));
    expect(sweptHitboxOverlaps(fx(4), 0, fx(4), 0, fx(2), target)).toBe(true);
    expect(sweptHitboxOverlaps(fx(6), 0, fx(6), 0, fx(2), target)).toBe(false);
  });
});

describe("hurtboxes and hitbox placement", () => {
  it("stands the hurtbox capsule on the fighter's feet", () => {
    const c = hurtboxCapsule({ x: fx(10), y: fx(5) }, ATTRS);
    expect(c.x1).toBe(fx(10));
    expect(c.y1).toBe(fx(5) + ATTRS.width);
    expect(c.y2).toBe(fx(5) + ATTRS.height - ATTRS.width);
    expect(c.r).toBe(ATTRS.width);
  });

  it("mirrors a hitbox offset by the fighter's facing", () => {
    const hb = { x: fx(8), y: fx(6) };
    expect(hitboxWorldPos(0, 0, 1, hb)).toEqual({ x: fx(8), y: fx(6) });
    expect(hitboxWorldPos(0, 0, -1, hb)).toEqual({ x: fx(-8), y: fx(6) });
  });
});

describe("active frames", () => {
  it("returns only the hitboxes live on the given frame", () => {
    const move: MoveDef = {
      slot: "fsmash",
      name: "test",
      totalFrames: 40,
      hitboxes: [
        hitbox({ id: 0, startFrame: 10, endFrame: 12 }),
        hitbox({ id: 1, startFrame: 13, endFrame: 15 }),
      ],
    };
    expect(activeHitboxes(move, 9)).toHaveLength(0);
    expect(activeHitboxes(move, 11).map((h) => h.id)).toEqual([0]);
    expect(activeHitboxes(move, 14).map((h) => h.id)).toEqual([1]);
    expect(activeHitboxes(move, 16)).toHaveLength(0);
  });
});

describe("priority", () => {
  it("gives the lowest id the hit, which is how a tipper works", () => {
    const candidates = [
      { hitbox: hitbox({ id: 2, damage: fx(20) }) },
      { hitbox: hitbox({ id: 0, damage: fx(5) }) },
      { hitbox: hitbox({ id: 1, damage: fx(30) }) },
    ];
    // Note the winner is the *weakest* here: id decides, damage never does.
    expect(bestHitbox(candidates)?.hitbox.id).toBe(0);
  });

  it("returns null for no candidates", () => {
    expect(bestHitbox([])).toBeNull();
  });
});

describe("clanking", () => {
  it("rebounds when the two are within 9 damage of each other", () => {
    expect(resolveClank(hitbox({ damage: fx(10) }), hitbox({ damage: fx(18) }))).toBe("rebound");
    expect(resolveClank(hitbox({ damage: fx(10) }), hitbox({ damage: fx(10) }))).toBe("rebound");
  });

  it("lets the stronger move through when the gap is wider than 9", () => {
    expect(resolveClank(hitbox({ damage: fx(10) }), hitbox({ damage: fx(25) }))).toBe("bWins");
    expect(resolveClank(hitbox({ damage: fx(25) }), hitbox({ damage: fx(10) }))).toBe("aWins");
  });

  it("passes transcendent hitboxes straight through", () => {
    expect(resolveClank(hitbox({ transcendent: true }), hitbox())).toBe("none");
    expect(resolveClank(hitbox(), hitbox({ transcendent: true }))).toBe("none");
  });

  it("does not clank grabs", () => {
    expect(resolveClank(hitbox({ grabbing: true }), hitbox())).toBe("none");
  });

  it("is symmetric in its verdict", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), (da, db) => {
        const ab = resolveClank(hitbox({ damage: fx(da) }), hitbox({ damage: fx(db) }));
        const ba = resolveClank(hitbox({ damage: fx(db) }), hitbox({ damage: fx(da) }));
        if (ab === "rebound") return ba === "rebound";
        if (ab === "aWins") return ba === "bWins";
        return ba === "aWins";
      }),
    );
  });
});

describe("hitThisMove bookkeeping", () => {
  it("records a target once and refuses a second hit", () => {
    const f = { hitThisMove: [] as number[] };
    expect(alreadyHit(f, 1)).toBe(false);
    markHit(f, 1);
    expect(alreadyHit(f, 1)).toBe(true);
    markHit(f, 1);
    expect(f.hitThisMove).toEqual([1]);
  });

  it("keeps the Smash Ball in a slot no port can occupy", () => {
    const f = { hitThisMove: [] as number[] };
    markHit(f, SMASH_BALL_TARGET);
    expect(alreadyHit(f, 0)).toBe(false);
    expect(alreadyHit(f, 3)).toBe(false);
    expect(alreadyHit(f, SMASH_BALL_TARGET)).toBe(true);
  });

  it("clears when a new move starts", () => {
    const f = { hitThisMove: [0, 1, 2] };
    clearHitRecord(f);
    expect(f.hitThisMove).toEqual([]);
  });
});

describe("capsule hitboxes (Plan 3, Task 17)", () => {
  const body: Capsule = { x1: fx(20), y1: fx(4), x2: fx(20), y2: fx(8), r: fx(4) };

  it("reaches a target its far end touches, though its near end does not", () => {
    // Near end at x 0, far end at x 15: only the far end is within 4 + 2 of the body.
    const depth = sweptCapsulePenetration(0, fx(6), 0, fx(6), fx(15), 0, fx(2), body);
    expect(depth).toBeCloseTo(fx(1), -2);
    expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(2), body)).toBeLessThan(0);
    expect(sweptCapsuleOverlaps(0, fx(6), 0, fx(6), fx(15), 0, fx(2), body)).toBe(true);
    expect(sweptCapsuleOverlaps(0, fx(6), 0, fx(6), 0, 0, fx(2), body)).toBe(false);
  });

  // A long capsule sweeping sideways passes over a small target in its middle:
  // no edge of the swept area comes near it, but the area covers it.
  it("reaches a target the swept area passes over, though no edge touches it", () => {
    const small: Capsule = circle(fx(10), fx(5), fx(0.5));
    const depth = sweptCapsulePenetration(0, 0, fx(20), 0, 0, fx(10), fx(1), small);
    expect(depth).toBe(fx(1.5));
    expect(sweptCapsuleOverlaps(0, 0, fx(20), 0, 0, fx(10), fx(1), small)).toBe(true);
    // ...and a target beside the swept area is missed.
    const beside = circle(fx(30), fx(5), fx(0.5));
    expect(sweptCapsulePenetration(0, 0, fx(20), 0, 0, fx(10), fx(1), beside)).toBeLessThan(0);
    expect(sweptCapsuleOverlaps(0, 0, fx(20), 0, 0, fx(10), fx(1), beside)).toBe(false);
  });

  it("is the swept sphere when it has no length", () => {
    fc.assert(
      fc.property(fc.integer({ min: -40, max: 40 }), fc.integer({ min: -40, max: 40 }), (px, x) => {
        expect(sweptCapsulePenetration(fx(px), fx(6), fx(x), fx(6), 0, 0, fx(2), body)).toBe(
          sweptHitboxPenetration(fx(px), fx(6), fx(x), fx(6), fx(2), body),
        );
      }),
    );
  });

  // The reduction, over every input and not one line of them: a box, where it was
  // and where it is, and any target capsule. Raw Q12, so the odd fractions come too.
  // `near` keeps most cases in reach of each other, `stage` spans a whole stage
  // (about 200 units either way) so most are far misses.
  describe("with no length it is the sphere's test, to the last Q12 unit", () => {
    const sweep = (range: number) => {
      const c = fc.integer({ min: fx(-range), max: fx(range) });
      return fc.record({
        prevX: c,
        prevY: c,
        x: c,
        y: c,
        radius: fc.integer({ min: 0, max: fx(12) }),
        target: fc.record({ x1: c, y1: c, x2: c, y2: c, r: fc.integer({ min: 0, max: fx(8) }) }),
      });
    };
    for (const [name, range] of [
      ["near", 20],
      ["stage", 300],
    ] as const) {
      it(`over a ${name} range: penetration`, () => {
        fc.assert(
          fc.property(sweep(range), (c) => {
            expect(sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, 0, 0, c.radius, c.target)).toBe(
              sweptHitboxPenetration(c.prevX, c.prevY, c.x, c.y, c.radius, c.target),
            );
          }),
          { numRuns: 2000 },
        );
      });

      it(`over a ${name} range: overlap`, () => {
        fc.assert(
          fc.property(sweep(range), (c) => {
            expect(sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, 0, 0, c.radius, c.target)).toBe(
              sweptHitboxOverlaps(c.prevX, c.prevY, c.x, c.y, c.radius, c.target),
            );
          }),
          { numRuns: 2000 },
        );
      });
    }

    // The clank and shield tests ask `capsulesOverlap` of two boxes now, and a sphere is
    // a capsule whose ends meet: it must say what `circlesOverlap` said, including for
    // centres that coincide and for radii that only just reach (a tight range makes both common).
    for (const [name, range] of [
      ["tight", 1],
      ["near", 20],
      ["stage", 300],
    ] as const) {
      it(`reads two circles as capsules the way circlesOverlap does, over a ${name} range`, () => {
        const c = fc.integer({ min: fx(-range), max: fx(range) });
        const r = fc.integer({ min: 0, max: fx(range === 1 ? 1 : 8) });
        fc.assert(
          fc.property(c, c, r, c, c, r, (ax, ay, ar, bx, by, br) => {
            expect(capsulesOverlap(circle(ax, ay, ar), circle(bx, by, br))).toBe(circlesOverlap(ax, ay, ar, bx, by, br));
          }),
          { numRuns: 2000 },
        );
      });
    }

    // Depth 0 is not overlap: the integer square root floors, so a box one Q12 unit
    // out of reach reads 0 deep. The Smash Ball keeps the sphere's overlap test
    // (not `depth < 0`), so it does not move.
    it("keeps overlap, not depth, for the verdict: one unit out of reach is a miss that reads 0 deep", () => {
      const reach = fx(5);
      const target = circle(reach + 1, 0, 0);
      expect(sweptHitboxOverlaps(0, 0, 0, 0, reach, target)).toBe(false);
      expect(sweptHitboxPenetration(0, 0, 0, 0, reach, target)).toBe(0);
      expect(sweptCapsuleOverlaps(0, 0, 0, 0, 0, 0, reach, target)).toBe(false);
      expect(sweptCapsulePenetration(0, 0, 0, 0, 0, 0, reach, target)).toBe(0);
    });
  });

  // An independent oracle: the deepest the capsule gets into the target over many
  // evenly spaced positions of its sweep. A capsule that moves without turning
  // covers exactly the union of those positions, and the depth is 1-Lipschitz in
  // where it sits, so no position is more than half a step of travel from a sample;
  // what remains is Q12 rounding (the integer square root is coarse near zero, up
  // to 64 raw units).
  describe("against a sampled sweep", () => {
    const STEPS = 128;
    const ROUNDING = 160;
    const sampledDepth = (c: Sweep): number => {
      let deepest = -Infinity;
      for (let k = 0; k <= STEPS; k++) {
        const x = c.prevX + Math.trunc(((c.x - c.prevX) * k) / STEPS);
        const y = c.prevY + Math.trunc(((c.y - c.prevY) * k) / STEPS);
        const here: Capsule = { x1: x, y1: y, x2: x + c.dx, y2: y + c.dy, r: c.radius };
        deepest = Math.max(deepest, c.radius + c.target.r - sqrt(segmentSegmentDistSq(here, c.target)));
      }
      return deepest;
    };
    interface Sweep {
      prevX: number;
      prevY: number;
      x: number;
      y: number;
      dx: number;
      dy: number;
      radius: number;
      target: Capsule;
    }
    const sweeps = (range: number) => {
      const c = fc.integer({ min: fx(-range), max: fx(range) });
      const len = fc.integer({ min: fx(-16), max: fx(16) });
      return fc.record({
        prevX: c,
        prevY: c,
        x: c,
        y: c,
        dx: len,
        dy: len,
        radius: fc.integer({ min: fx(0.5), max: fx(8) }),
        target: fc.record({ x1: c, y1: c, x2: c, y2: c, r: fc.integer({ min: fx(0.5), max: fx(6) }) }),
      });
    };

    it("is the deepest point of the sweep, inside the parallelogram or on its edge", () => {
      fc.assert(
        fc.property(sweeps(24), (c) => {
          const depth = sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target);
          const sampled = sampledDepth(c);
          const travel = Math.hypot(c.x - c.prevX, c.y - c.prevY);
          expect(depth).toBeGreaterThanOrEqual(sampled - ROUNDING);
          expect(depth).toBeLessThanOrEqual(sampled + travel / (2 * STEPS) + ROUNDING);
        }),
        { numRuns: 600 },
      );
    });

    it("never reads shallower than either end's own sweep, nor than the capsule's two positions", () => {
      fc.assert(
        fc.property(sweeps(24), (c) => {
          const depth = sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target);
          expect(depth).toBeGreaterThanOrEqual(sweptHitboxPenetration(c.prevX, c.prevY, c.x, c.y, c.radius, c.target));
          expect(depth).toBeGreaterThanOrEqual(sweptHitboxPenetration(c.prevX + c.dx, c.prevY + c.dy, c.x + c.dx, c.y + c.dy, c.radius, c.target));
          expect(depth).toBeGreaterThanOrEqual(sweptHitboxPenetration(c.x, c.y, c.x + c.dx, c.y + c.dy, c.radius, c.target));
          expect(depth).toBeGreaterThanOrEqual(sweptHitboxPenetration(c.prevX, c.prevY, c.prevX + c.dx, c.prevY + c.dy, c.radius, c.target));
        }),
        { numRuns: 600 },
      );
    });

    // The swept sphere's relation (`sweptHitboxPenetration`): touching is never
    // negative, and a box 0.1 deep is touching.
    it("agrees with overlap: an overlapping box is not negative, and a glancing-blow-deep one overlaps", () => {
      fc.assert(
        fc.property(sweeps(24), (c) => {
          const depth = sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target);
          const overlaps = sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target);
          if (overlaps) expect(depth).toBeGreaterThanOrEqual(0);
          if (depth >= GLANCING_BLOW_DEPTH) expect(overlaps).toBe(true);
          if (!overlaps) expect(depth).toBeLessThan(GLANCING_BLOW_DEPTH);
        }),
        { numRuns: 1000 },
      );
    });

    // A fighter facing left is the same box mirrored: its far end flips with its near end.
    it("reads the same mirrored left to right", () => {
      fc.assert(
        fc.property(sweeps(24), (c) => {
          const flip = (t: Capsule): Capsule => ({ x1: -t.x1, y1: t.y1, x2: -t.x2, y2: t.y2, r: t.r });
          expect(sweptCapsulePenetration(-c.prevX, c.prevY, -c.x, c.y, -c.dx, c.dy, c.radius, flip(c.target))).toBe(
            sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target),
          );
          expect(sweptCapsuleOverlaps(-c.prevX, c.prevY, -c.x, c.y, -c.dx, c.dy, c.radius, flip(c.target))).toBe(
            sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.radius, c.target),
          );
        }),
        { numRuns: 600 },
      );
    });

    it("is the capsule where it sits when the box has not moved, and the segment its sweep covers when it moves along its length", () => {
      const target: Capsule = { x1: fx(8), y1: fx(-3), x2: fx(8), y2: fx(3), r: fx(1) };
      // Not moving: (0, 0) to (5, 0), radius 1, is 3 from the spine and reaches 1 + 1.
      expect(sweptCapsulePenetration(0, 0, 0, 0, fx(5), 0, fx(1), target)).toBe(fx(-1));
      // Moving along its own length, the area covered is the one segment from the
      // first near end to the last far end: here (0, 0) to (8, 0), onto the spine.
      expect(sweptCapsulePenetration(0, 0, fx(3), 0, fx(5), 0, fx(1), target)).toBe(fx(2));
      expect(sweptCapsuleOverlaps(0, 0, fx(3), 0, fx(5), 0, fx(1), target)).toBe(true);
      // (0, 0) to (5.5, 0): 2.5 from the spine, half a unit short of 1 + 1.
      expect(sweptCapsulePenetration(0, 0, fx(0.5), 0, fx(5), 0, fx(1), target)).toBe(fx(-0.5));
      expect(sweptCapsuleOverlaps(0, 0, fx(0.5), 0, fx(5), 0, fx(1), target)).toBe(false);
    });
  });

  // Q12 distances are squares of Q12 differences, and a JS number holds an integer
  // exactly only below 2^53. The largest intermediate anywhere in the chain is the
  // sum of two squared differences scaled back up (`div` and `sqrt` multiply by
  // ONE): 2 D^2 for coordinates D apart, exact while D < 2^26 raw, 16384 units. A
  // stage is about 200 units across (819200 raw): four hundred times inside it.
  describe("integer geometry at stage scale and far beyond it", () => {
    it("is exact for a stage's width: a far end 395 units from the near end", () => {
      // Near end at -200, far end at +195 and then +190; a body at +200 (spine 4 to 8
      // up, radius 4) and a box of radius 2: 5 and then 10 from the far end.
      const stageBody: Capsule = { x1: fx(200), y1: fx(4), x2: fx(200), y2: fx(8), r: fx(4) };
      expect(sweptCapsulePenetration(fx(-200), fx(6), fx(-200), fx(6), fx(395), 0, fx(2), stageBody)).toBe(fx(1));
      expect(sweptCapsulePenetration(fx(-200), fx(6), fx(-200), fx(6), fx(390), 0, fx(2), stageBody)).toBe(fx(-4));
      expect(sweptCapsuleOverlaps(fx(-200), fx(6), fx(-200), fx(6), fx(395), 0, fx(2), stageBody)).toBe(true);
      expect(sweptCapsuleOverlaps(fx(-200), fx(6), fx(-200), fx(6), fx(390), 0, fx(2), stageBody)).toBe(false);
    });

    it("is exact 16000 units out, where a squared distance reaches 4 x 10^15", () => {
      const far = fx(16000);
      const out = circle(far + fx(6), 0, fx(2));
      // The distance is a whole number of units, so the integer square root is exact.
      expect(sweptCapsulePenetration(0, 0, 0, 0, far, 0, fx(3), out)).toBe(fx(-1));
      expect(sweptCapsulePenetration(0, 0, 0, 0, far, 0, fx(5), out)).toBe(fx(1));
    });

    it("is exact on a 3-4-5 triangle 8000 units a side, where both axes' squares are summed", () => {
      const side = fx(8000);
      const out = circle(side + fx(3), side + fx(4), fx(2));
      expect(sweptCapsulePenetration(0, 0, 0, 0, side, side, fx(4), out)).toBe(fx(1));
    });

    // Every step works on differences, so nothing depends on where the box is.
    it("reads the same wherever the stage sits", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: fx(-8000), max: fx(8000) }),
          fc.integer({ min: fx(-8000), max: fx(8000) }),
          (ox, oy) => {
            const shift = (t: Capsule): Capsule => ({ x1: t.x1 + ox, y1: t.y1 + oy, x2: t.x2 + ox, y2: t.y2 + oy, r: t.r });
            const here = sweptCapsulePenetration(fx(-3), fx(2), fx(9), fx(5), fx(7), fx(-4), fx(3), body);
            expect(sweptCapsulePenetration(fx(-3) + ox, fx(2) + oy, fx(9) + ox, fx(5) + oy, fx(7), fx(-4), fx(3), shift(body))).toBe(here);
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
