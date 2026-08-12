import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { countCapsules, createMockContext } from "./mockContext";
import {
  BASE_RIG,
  BONE_NAMES,
  DRAWN_BONES,
  deg,
  drawBones,
  drawCapsule,
  forwardTwoBone,
  resolve,
  solveTwoBone,
  type BoneName,
} from "./skeleton";

describe("the rig", () => {
  it("lists every parent before its children, which is what makes one pass enough", () => {
    const seen = new Set<BoneName>();
    for (const name of BONE_NAMES) {
      const parent = BASE_RIG[name].parent;
      if (parent) expect(seen.has(parent)).toBe(true);
      seen.add(name);
    }
    expect(seen.size).toBe(16);
  });

  it("has exactly one structural bone — the root strut, which is never drawn", () => {
    expect(DRAWN_BONES).toHaveLength(15);
    expect(DRAWN_BONES).not.toContain("root");
  });
});

describe("resolve", () => {
  const transform = { x: 100, y: 500, scale: 10, facing: 1 };

  it("plants the root's base at the transform's position", () => {
    const s = resolve(BASE_RIG, {}, transform);
    expect(s.root.x0).toBeCloseTo(100, 6);
    expect(s.root.y0).toBeCloseTo(500, 6);
  });

  it("builds upward on screen, because rig space is y-up and the screen is not", () => {
    const s = resolve(BASE_RIG, {}, transform);
    expect(s.head.y1).toBeLessThan(s.root.y0);
    expect(s.torso.y1).toBeLessThan(s.hip.y1);
  });

  it("hangs the legs from the pelvis, not from the waist", () => {
    const s = resolve(BASE_RIG, {}, transform);
    // The thighs attach at the hip bone's base, which is the root's tip.
    expect(s.thighL.x0).toBeCloseTo(s.root.x1, 6);
    expect(s.thighL.y0).toBeCloseTo(s.root.y0 - BASE_RIG.root.length * 10, 6);
  });

  it("puts the feet back on the ground the root started from", () => {
    const s = resolve(BASE_RIG, {}, transform);
    // Not exact — the rest pose has slightly bent knees — but within a unit.
    expect(Math.abs(s.footR.y1 - 500)).toBeLessThan(10);
  });

  it("mirrors the whole rig horizontally when facing flips", () => {
    const right = resolve(BASE_RIG, {}, transform);
    const left = resolve(BASE_RIG, {}, { ...transform, facing: -1 });
    for (const name of BONE_NAMES) {
      expect(left[name].x1 - 100).toBeCloseTo(-(right[name].x1 - 100), 6);
      expect(left[name].y1).toBeCloseTo(right[name].y1, 6);
    }
  });

  it("scales capsule thickness with the average of the two squash axes", () => {
    const s = resolve(BASE_RIG, {}, { ...transform, scaleX: 1.5, scaleY: 0.5 });
    expect(s.torso.thickness).toBeCloseTo(BASE_RIG.torso.thickness * 10, 6);
  });

  it("applies a pose angle relative to the parent", () => {
    const s = resolve(BASE_RIG, { torso: deg(90) }, transform);
    // A torso rotated 90° clockwise points at the fighter's front.
    expect(s.torso.x1 - s.torso.x0).toBeCloseTo(BASE_RIG.torso.length * 10, 4);
    expect(s.torso.y1 - s.torso.y0).toBeCloseTo(0, 4);
  });

  it("rotates the body about the pelvis rather than about the feet", () => {
    const pivot = 4.2;
    const upright = resolve(BASE_RIG, {}, transform);
    const spun = resolve(BASE_RIG, {}, { ...transform, rotation: Math.PI, pivot });
    // A half turn about the pelvis maps the pelvis onto itself.
    expect(spun.hip.x0).toBeCloseTo(upright.hip.x0, 4);
    expect(spun.hip.y0).toBeCloseTo(upright.hip.y0, 4);
    // ...and puts the head where the feet were, roughly.
    expect(spun.head.y1).toBeGreaterThan(upright.root.y0);
  });
});

describe("two-bone IK", () => {
  it("lands the end effector exactly on a reachable target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3.4, max: 3.4, noNaN: true }),
        fc.double({ min: -3.4, max: 3.4, noNaN: true }),
        fc.constantFrom(1, -1),
        (dx, dy, bend) => {
          const upper = 2.1;
          const lower = 2.0;
          const dist = Math.hypot(dx, dy);
          fc.pre(dist > Math.abs(upper - lower) + 0.05 && dist < upper + lower - 0.05);
          const sol = solveTwoBone(dx, dy, upper, lower, bend);
          expect(sol.reached).toBe(true);
          const end = forwardTwoBone(sol.upper, sol.lower, upper, lower);
          expect(end.x).toBeCloseTo(dx, 6);
          expect(end.y).toBeCloseTo(dy, 6);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("bends the two solutions in opposite directions", () => {
    const a = solveTwoBone(1.2, 2.4, 2.1, 2.0, 1);
    const b = solveTwoBone(1.2, 2.4, 2.1, 2.0, -1);
    expect(Math.sign(a.lower)).toBe(-Math.sign(b.lower));
  });

  it("straightens toward an unreachable target rather than producing NaN", () => {
    const sol = solveTwoBone(0, 40, 2.1, 2.0, 1);
    expect(sol.reached).toBe(false);
    expect(Number.isFinite(sol.upper)).toBe(true);
    expect(Number.isFinite(sol.lower)).toBe(true);
    expect(Math.abs(sol.lower)).toBeLessThan(0.02); // effectively straight
    const end = forwardTwoBone(sol.upper, sol.lower, 2.1, 2.0);
    // Pointing at the target, at full reach.
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(4.1, 3);
    expect(end.x).toBeCloseTo(0, 3);
  });

  it("collapses toward a target inside the dead zone without exploding", () => {
    const sol = solveTwoBone(0.001, 0, 2.1, 2.0, 1);
    expect(sol.reached).toBe(false);
    expect(Number.isFinite(sol.upper)).toBe(true);
    expect(Number.isFinite(sol.lower)).toBe(true);
  });
});

describe("drawing", () => {
  it("emits one capsule per drawn bone", () => {
    const ctx = createMockContext();
    const s = resolve(BASE_RIG, {}, { x: 0, y: 0, scale: 10, facing: 1 });
    drawBones(ctx, s, BONE_NAMES, "#ff0000");
    expect(countCapsules(ctx)).toBe(15);
  });

  it("skips zero-thickness bones", () => {
    const ctx = createMockContext();
    drawCapsule(ctx, 0, 0, 10, 10, 0, "#fff");
    expect(countCapsules(ctx)).toBe(0);
  });

  it("inflates every capsule by twice the requested amount, for the rim pass", () => {
    const ctx = createMockContext();
    const s = resolve(BASE_RIG, {}, { x: 0, y: 0, scale: 10, facing: 1 });
    drawBones(ctx, s, ["torso"], "#000", 4);
    const widths = ctx.calls.filter((c) => c.method === "set:lineWidth").map((c) => c.args[0]);
    expect(widths[0]).toBeCloseTo(s.torso.thickness + 8, 6);
  });

  it("nudges a degenerate capsule so its cap still paints", () => {
    const ctx = createMockContext();
    drawCapsule(ctx, 5, 5, 5, 5, 3, "#fff");
    const lineTo = ctx.calls.find((c) => c.method === "lineTo");
    expect(lineTo?.args[0]).not.toBe(5);
  });
});
