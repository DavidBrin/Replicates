import { describe, expect, it } from "vitest";

import { compose, mMul, mRotation, mTranslation, qAxisAngle, qRotate } from "../math/rigid";
import { buildRig, parseSkeletonFile, trimSkeleton } from "./skeleton";
import { testSkeleton } from "./testSkeleton";

describe("rigid maths", () => {
  it("composes, multiplies and decomposes like three.js (column-major)", () => {
    const q = qAxisAngle([0, 0, 1], Math.PI / 2);
    const m = compose([1, 2, 3], q);
    expect(mTranslation(m)).toEqual([1, 2, 3]);
    const r = mRotation(m);
    const v = qRotate(r, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
    const twice = mMul(m, m);
    expect(mTranslation(twice)[0]).toBeCloseTo(1 - 2, 12);
  });
});

describe("the skeleton file", () => {
  it("accepts the shape the Blender dump produces", () => {
    expect(parseSkeletonFile(testSkeleton()).bones).toHaveLength(28);
  });

  it("refuses duplicate names, missing parents, bad matrices and capsules on missing bones — by name", () => {
    const s = testSkeleton("bad");
    expect(() => parseSkeletonFile({ ...s, schema: 2 })).toThrow(/bad: schema 2/);
    expect(() => parseSkeletonFile({ ...s, bones: [...s.bones, { ...s.bones[3], name: "hip" }] })).toThrow(/two bones are called "hip"/);
    expect(() => parseSkeletonFile({ ...s, bones: s.bones.map((b) => (b.name === "Head" ? { ...b, parent: "Nope" } : b)) })).toThrow(/missing parent "Nope"/);
    expect(() => parseSkeletonFile({ ...s, bones: s.bones.map((b) => (b.name === "Head" ? { ...b, world: [1, 2] } : b)) })).toThrow(/Head" has no 16-number/);
    expect(() => parseSkeletonFile({ ...s, hurt: [{ bone: "Tail1", x1: 0, x2: 1, r: 1 }] })).toThrow(/missing bone "Tail1"/);
  });

  it("orders parents before children and recovers each bone's local transform", () => {
    const shuffled = testSkeleton();
    const rig = buildRig({ ...shuffled, bones: [...shuffled.bones].reverse() });
    rig.parent.forEach((p, i) => expect(p).toBeLessThan(i));
    const knee = rig.byLower.get("kneel")!;
    // KneeL sits 2.1 below LegL along LegL's +X (which points down).
    expect(rig.restLocalT[knee][0]).toBeCloseTo(2.1, 9);
  });

  it("trims to the bones asked for and every ancestor, keeping only their hurt capsules", () => {
    const t = trimSkeleton(testSkeleton(), (n) => n === "handl" || n === "head");
    expect(t.bones.map((b) => b.name)).toEqual(["Trans", "Rot", "Hip", "Waist", "Bust", "Neck", "Head", "ClavicleC", "ClavicleL", "ShoulderL", "ArmL", "HandL"]);
    expect(t.hurt.map((h) => h.bone).sort()).toEqual(["ArmL", "Bust", "Head", "Hip", "ShoulderL"]);
  });
});
