import { describe, expect, it } from "vitest";

import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { TOP_POSE, bonePoint } from "@/engine/acmd/bones";
import { ONE, fx } from "@/engine/fixed";
import { BASE_RIG } from "@/render/skeleton";
import { compose, mTranslation, qNormalize, type Quat } from "../math/rigid";
import { calibrate, restPose, retarget } from "../retarget/retarget";
import { buildRig } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { IDENTITY_ROOT, sideBonePose, worldMatrices } from "./fk";

const rig = buildRig(testSkeleton());
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Nearest 1/256 unit, in Q12, written without the production helper (`+ 0`: a tiny negative stores 0, not -0). */
const grid = (v: number): number => Math.round(v * 256) * BAKE_QUANTUM + 0;

/** A fixed stream of numbers in [-1, 1): no Math.random, so a failure reproduces. */
function stream(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

describe("forward kinematics and the side-plane projection", () => {
  it("projects the model's identity frame onto Plan 2's root pose: script Z forward, Y up", () => {
    expect(sideBonePose(IDENTITY)).toEqual(TOP_POSE);
  });

  it("lands a bone-local point where bonePoint says, so baked limbs and root-bone scripts share one frame", () => {
    const world = worldMatrices(rig, retarget(calibrate(rig, BASE_RIG), BASE_RIG, { thighR: 2.6 }, 0), IDENTITY_ROOT);
    const knee = world[rig.byLower.get("kneer")!];
    const pose = sideBonePose(knee);
    // A point 1.5 down the shin (KneeR's +X), in model space and through the baked pose.
    const lx = 1.5;
    const model = [knee[0] * lx + knee[12], knee[1] * lx + knee[13], knee[2] * lx + knee[14]];
    const p = bonePoint(pose, fx(lx), 0, 0);
    expect(Math.abs(p.x - Math.round(model[2] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
    expect(Math.abs(p.y - Math.round(model[1] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
  });

  it("keeps the model's Z row as the sim's x and its Y row as the sim's y, for offsets on every bone axis", () => {
    const next = stream(7);
    for (let n = 0; n < 40; n++) {
      const q = qNormalize([next(), next(), next(), next() + 1.5] as Quat);
      const m = compose([next() * 6, next() * 6, next() * 6], q, [1.08, 1.08, 1.08]);
      const pose = sideBonePose(m);
      // Each stored number is the matrix entry rounded to the grid, sign and all.
      expect(pose.tx).toBe(grid(m[14]));
      expect([pose.m00, pose.m01, pose.m02]).toEqual([grid(m[2]), grid(m[6]), grid(m[10])]);
      expect([pose.m10, pose.m11, pose.m12]).toEqual([grid(m[1]), grid(m[5]), grid(m[9])]);
      expect(pose.ty).toBe(grid(m[13]));
      // And a point off every bone axis lands where the full matrix puts it (x = model Z, y = model Y).
      const [lx, ly, lz] = [next() * 4, next() * 4, next() * 4];
      const p = bonePoint(pose, fx(lx), fx(ly), fx(lz));
      const slack = (BAKE_QUANTUM / 2) * (2 + Math.abs(lx) + Math.abs(ly) + Math.abs(lz)) + 2;
      expect(Math.abs(p.x - (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * ONE)).toBeLessThanOrEqual(slack);
      expect(Math.abs(p.y - (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * ONE)).toBeLessThanOrEqual(slack);
    }
  });

  it("stores every number on the bake's 1/256-unit grid", () => {
    const pose = sideBonePose(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[rig.byLower.get("head")!]);
    for (const v of Object.values(pose)) expect(Math.abs(v) % BAKE_QUANTUM).toBe(0);
  });

  it("rounds an off-grid translation to the nearest 1/256 unit, either side of zero", () => {
    // The test skeleton's own offsets sit on the grid, so the test above cannot see a missing round.
    // 32.6 and 31.4 steps: 33 and 31 for round, but 32 and 32 once the grid is a power of two coarser.
    for (const [up, back, ty, tx] of [
      [0.1275, -0.1227, 33, -31],
      [-0.1227, 0.1275, -31, 33],
    ]) {
      const m = [...IDENTITY];
      m[13] = up;
      m[14] = back;
      const pose = sideBonePose(m);
      expect(pose.ty).toBe(ty * BAKE_QUANTUM);
      expect(pose.tx).toBe(tx * BAKE_QUANTUM);
    }
  });

  it("breaks a half-step tie toward +infinity, as Math.round does, so a re-bake writes the same bytes", () => {
    // Exact binary fractions: 1/512 and 3/512 are 0.5 and 1.5 steps of 1/256.
    for (const [v, steps] of [
      [1 / 512, 1],
      [-1 / 512, 0],
      [3 / 512, 2],
      [-3 / 512, -1],
    ]) {
      const m = [...IDENTITY];
      m[13] = v;
      expect(sideBonePose(m).ty).toBe(steps * BAKE_QUANTUM);
    }
  });

  it("never stores a negative zero: a tiny negative entry rounds to 0, which a decoded bake compares equal to", () => {
    // Math.round(-0.3) is -0, and -0 is not 0 to toBe/Object.is or to `v % BAKE_QUANTUM === 0` in a round trip.
    const m = [...IDENTITY];
    m[1] = -0.0001;
    m[2] = -0.0001;
    m[6] = -0.0001;
    m[9] = -0.0001;
    m[13] = -0.0001;
    m[14] = -0.0001;
    expect(sideBonePose(m)).toEqual({ tx: 0, ty: 0, m00: 0, m01: 0, m02: ONE, m10: 0, m11: ONE, m12: 0 });
    for (const v of Object.values(sideBonePose(m))) expect(Object.is(v, -0)).toBe(false);
  });

  it("applies the root transform: clip offsets, squash and the fighter's size", () => {
    const toe = rig.byLower.get("toer")!;
    const plain = mTranslation(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[toe]);
    const moved = mTranslation(worldMatrices(rig, restPose(rig), { forward: 2, up: 1, squashForward: 0.75, squashUp: 0.5, scale: 1.08 })[toe]);
    expect(moved[1]).toBeCloseTo(1 + plain[1] * 1.08 * 0.5, 9);
    expect(moved[2]).toBeCloseTo(2 + plain[2] * 1.08 * 0.75, 9);
  });
});
