import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { fx } from "./fixed";
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
  sweptHitboxOverlaps,
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
