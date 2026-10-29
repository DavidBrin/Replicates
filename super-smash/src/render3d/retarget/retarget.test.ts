import { describe, expect, it } from "vitest";

import { angleDelta } from "@/render/poses/clip";
import { BASE_RIG, deg, resolve } from "@/render/skeleton";
import { IDENTITY_ROOT, worldMatrices } from "../bake/fk";
import { mAxis, mTranslation, normalize } from "../math/rigid";
import { buildRig } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { accumulatedAngles, calibrate, retarget } from "./retarget";

const rig = buildRig(testSkeleton());
const cal = calibrate(rig, BASE_RIG);
const at = (name: string) => rig.byLower.get(name.toLowerCase())!;
const posed = (angles: Parameters<typeof retarget>[2], rotation = 0) =>
  worldMatrices(rig, retarget(cal, BASE_RIG, angles, rotation), IDENTITY_ROOT);
const REST = posed({});

/** Side-plane angle (0 = up, + toward the front) of the vector between two bones. */
function sideAngle(world: number[][], from: string, to: string): number {
  const a = mTranslation(world[at(from)]);
  const b = mTranslation(world[at(to)]);
  const d = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  return Math.atan2(d[2], d[1]);
}

describe("retargeting a 2D pose onto an SSBU skeleton", () => {
  it("points the arms exactly where the 2D arm points (rest 'down': T-pose arms have no side-plane angle)", () => {
    const angles = { upperArmL: deg(-80), forearmL: deg(30), upperArmR: deg(100), forearmR: deg(-20) };
    const world = posed(angles);
    const acc = accumulatedAngles(BASE_RIG, angles, 0);
    expect(angleDelta(acc.upperArmL, sideAngle(world, "ShoulderL", "ArmL"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.forearmL, sideAngle(world, "ArmL", "HandL"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.upperArmR, sideAngle(world, "ShoulderR", "ArmR"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.forearmR, sideAngle(world, "ArmR", "HandR"))).toBeCloseTo(0, 9);
  });

  it("turns legs, feet and spine by the clip's angle relative to rest (rest 'bind')", () => {
    const angles = { thighR: deg(150), shinR: deg(40), footR: deg(-30), torso: deg(25) };
    const world = posed(angles);
    const acc = accumulatedAngles(BASE_RIG, angles, 0);
    const rest = accumulatedAngles(BASE_RIG, {}, 0);
    const turned = (from: string, to: string) => angleDelta(sideAngle(REST, from, to), sideAngle(world, from, to));
    expect(angleDelta(turned("LegR", "KneeR"), acc.thighR - rest.thighR)).toBeCloseTo(0, 9);
    expect(angleDelta(turned("KneeR", "FootR"), acc.shinR - rest.shinR)).toBeCloseTo(0, 9);
    expect(angleDelta(turned("FootR", "ToeR"), acc.footR - rest.footR)).toBeCloseTo(0, 9);
    const bust = mAxis(world[at("Bust")], 0);
    expect(angleDelta(Math.atan2(bust[2], bust[1]), acc.torso - rest.torso)).toBeCloseTo(0, 9);
  });

  it("stands in SSBU's own stance at the 2D rest pose: feet flat, legs and head where the bind pose has them", () => {
    for (const bone of ["Head", "KneeL", "FootR", "ToeL", "ToeR"]) {
      const want = mTranslation(rig.restWorld[at(bone)]);
      const got = mTranslation(REST[at(bone)]);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 9);
    }
  });

  it("brings the T-pose arms down: at rest the hands hang below the shoulders", () => {
    expect(mTranslation(REST[at("HandL")])[1]).toBeLessThan(mTranslation(REST[at("ShoulderL")])[1] - 2.5);
    expect(mTranslation(REST[at("HandR")])[1]).toBeLessThan(mTranslation(REST[at("ShoulderR")])[1] - 2.5);
  });

  it("keeps SSBU's bone lengths: the limbs are the model's, only the angles are the clip's", () => {
    const world = posed({ thighL: deg(120), shinL: deg(-90) });
    const len = (a: string, b: string) => {
      const p = mTranslation(world[at(a)]);
      const q = mTranslation(world[at(b)]);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    expect(len("LegL", "KneeL")).toBeCloseTo(2.1, 9);
    expect(len("KneeL", "FootL")).toBeCloseTo(1.9, 9);
  });

  it("swings limbs only in the side plane: a limb never leaves its own depth", () => {
    const world = posed({ upperArmR: deg(60), forearmR: deg(-100) });
    expect(mTranslation(world[at("ArmR")])[0]).toBeCloseTo(-2, 9);
    expect(mTranslation(world[at("HandR")])[0]).toBeCloseTo(-2, 9);
  });

  it("turns the whole body about the pelvis, as resolve() does, so a somersault does not orbit the feet", () => {
    const quarter = Math.PI / 2;
    const world = posed({}, quarter);
    const hip = mTranslation(world[at("Hip")]);
    expect(hip[1]).toBeCloseTo(cal.pivotY, 9);
    expect(hip[2]).toBeCloseTo(0, 9);
    const head = mTranslation(world[at("Head")]);
    expect(head[2]).toBeGreaterThan(3);
    expect(head[1]).toBeCloseTo(cal.pivotY, 6);
    // The 2D renderer agrees about which way a positive rotation turns.
    const sk = resolve(BASE_RIG, {}, { x: 0, y: 0, scale: 1, facing: 1, rotation: quarter });
    expect(sk.head.x1).toBeGreaterThan(sk.hip.x0);
  });

  it("names the bone a skeleton is missing, rather than posing a broken rig", () => {
    const broken = testSkeleton("broken");
    const noKnee = { ...broken, bones: broken.bones.filter((b) => !["KneeR", "FootR", "ToeR"].includes(b.name)) };
    expect(() => calibrate(buildRig(noKnee), BASE_RIG)).toThrow(/broken: skeleton lacks/);
  });

  it("refuses a 'bind' drive whose bind direction is sideways, naming the fix", () => {
    const sideways = testSkeleton("sideways");
    const bones = sideways.bones.map((b) =>
      // Lay the left thigh out sideways, as a T-pose arm is.
      b.name === "KneeL" ? { ...b, world: [...b.world.slice(0, 12), 3.3, 5.5, 0, 1] } : b,
    );
    expect(() => calibrate(buildRig({ ...sideways, bones }), BASE_RIG)).toThrow(/LegL points sideways.*thighL rest "down"/);
  });
});
