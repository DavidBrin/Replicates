import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { getCharacterRig } from "@/render/chars";
import { angleDelta } from "@/render/poses/clip";
import { BASE_RIG, BONE_NAMES, deg, resolve, type BoneName, type PoseAngles } from "@/render/skeleton";
import { IDENTITY_ROOT, worldMatrices } from "../bake/fk";
import { compose, mAxis, mInvertRigid, mMul, mTranslation, normalize, qRotX, type Vec3 } from "../math/rigid";
import { buildRig, type SkeletonFile } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { SKELETONS } from "../skeletons";
import { RETARGET, RETARGET_OVERRIDES, driveFor } from "./map";
import { accumulatedAngles, calibrate, newPoseBuffer, retarget, retargetInto } from "./retarget";

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

  it("names the bone and the tip a skeleton is missing, rather than posing a broken rig", () => {
    const broken = testSkeleton("broken");
    const noKnee = { ...broken, bones: broken.bones.filter((b) => !["KneeR", "FootR", "ToeR"].includes(b.name)) };
    // LegR is there, its tip is not: the thigh is the first drive to fail.
    expect(() => calibrate(buildRig(noKnee), BASE_RIG)).toThrow(/^retarget broken: skeleton lacks LegR's tip KneeR$/);
  });

  it("names the 2D bone and every SSBU bone it tried when none of them is there", () => {
    const broken = testSkeleton("broken");
    const noLeg = { ...broken, bones: broken.bones.filter((b) => !["LegR", "KneeR", "FootR", "ToeR"].includes(b.name)) };
    expect(() => calibrate(buildRig(noLeg), BASE_RIG)).toThrow(/^retarget broken: skeleton lacks thighR's bone \(tried LegR\)$/);
    const noSpine = { ...broken, bones: broken.bones.filter((b) => !["Waist", "Bust", "Neck", "Head", "ClavicleC", "ClavicleL", "ShoulderL", "ArmL", "HandL", "HaveL", "ClavicleR", "ShoulderR", "ArmR", "HandR", "HaveR"].includes(b.name)) };
    expect(() => calibrate(buildRig(noSpine), BASE_RIG)).toThrow(/^retarget broken: skeleton lacks torso's bone \(tried Waist, Bust\)$/);
  });

  it("names the bone and its tip when they sit at the same point, rather than failing inside the maths", () => {
    const flat = testSkeleton("flat");
    const leg = flat.bones.find((b) => b.name === "LegL")!;
    // KneeL moved onto LegL: the thigh has no direction.
    const bones = flat.bones.map((b) => (b.name === "KneeL" ? { ...b, world: [...b.world.slice(0, 12), leg.world[12], leg.world[13], leg.world[14], 1] } : b));
    expect(() => calibrate(buildRig({ ...flat, bones }), BASE_RIG)).toThrow(/^retarget flat: LegL and its tip KneeL sit at the same point, so thighL has no direction$/);
  });

  it("refuses a root bone that is not at the feet: the pivot shift assumes y = z = 0", () => {
    const at = (name: string, y: number, z: number): SkeletonFile => {
      const file = testSkeleton("raised");
      return { ...file, bones: file.bones.map((b) => (b.name === name ? { ...b, world: [...b.world.slice(0, 12), 0, y, z, 1] } : b)) };
    };
    expect(() => calibrate(buildRig(at("Trans", 1, 0)), BASE_RIG)).toThrow(/^retarget raised: root bone Trans sits at y 1, z 0, not at the feet/);
    expect(() => calibrate(buildRig(at("Trans", 0, -2)), BASE_RIG)).toThrow(/^retarget raised: root bone Trans sits at y 0, z -2, not at the feet/);
    // Along the depth axis is harmless: a turn about X leaves it alone.
    const sideways = testSkeleton("sideways-root");
    const moved = { ...sideways, bones: sideways.bones.map((b) => (b.name === "Trans" ? { ...b, world: [...b.world.slice(0, 12), 3, 0, 0, 1] } : b)) };
    expect(() => calibrate(buildRig(moved), BASE_RIG)).not.toThrow();
  });

  it("refuses a 'bind' drive whose bind direction is sideways, naming the fix", () => {
    const sideways = testSkeleton("sideways");
    const bones = sideways.bones.map((b) =>
      // Lay the left thigh out sideways, as a T-pose arm is.
      b.name === "KneeL" ? { ...b, world: [...b.world.slice(0, 12), 3.3, 5.5, 0, 1] } : b,
    );
    expect(() => calibrate(buildRig({ ...sideways, bones }), BASE_RIG)).toThrow(/LegL points sideways.*thighL rest "down"/);
  });

  // Plan 4 final wave: two drives on one SSBU bone would pose it twice, the
  // later one silently winning (Task 3 review); and a `turn` is read only by a
  // "down" drive, so on a "bind" drive it would do nothing and pass every test
  // (Task 13b re-review). Both are mistakes in the drive table, refused by name.
  it("refuses two drives on one SSBU bone, naming the bone and both 2D bones", () => {
    const twice = (id: string, bone: BoneName) => (bone === "head" ? { bones: ["Neck", "Bust"], rest: "bind" as const } : driveFor(id, bone));
    expect(() => calibrate(rig, BASE_RIG, twice)).toThrow(/^retarget test: Bust is driven by both torso and head; one SSBU bone takes one drive$/);
    const sameTwice = (id: string, bone: BoneName) => (bone === "torso" ? { bones: ["Waist", "waist"], rest: "bind" as const } : driveFor(id, bone));
    expect(() => calibrate(rig, BASE_RIG, sameTwice)).toThrow(/^retarget test: waist is driven by both torso and torso; one SSBU bone takes one drive$/);
  });

  it("refuses a turn on a \"bind\" drive, which only a \"down\" drive reads", () => {
    const turned = (id: string, bone: BoneName) => (bone === "thighL" ? { ...RETARGET.thighL!, turn: 30 } : driveFor(id, bone));
    expect(() => calibrate(rig, BASE_RIG, turned)).toThrow(/^retarget test: thighL has a turn of 30°, which only a "down" drive reads; give it rest "down" or drop the turn$/);
    // The swordsmen's grip, a turn on a "down" drive, is what a turn is for.
    expect(() => calibrate(buildRig(SKELETONS.marth), getCharacterRig("marth").bones)).not.toThrow();
  });
});

/**
 * The map, written out in full, on purpose: this table is the authority and
 * `RETARGET` is checked against it, so a row deleted from, or added to, the map
 * cannot slip through by shrinking the thing the test iterates. Each row is a
 * 2D bone, how its rest pose meets SSBU's bind pose, and the SSBU bones it turns
 * as `[bone, tip]` (a bone with no tip points along its own +X).
 */
interface Row {
  readonly bone: BoneName;
  readonly rest: "bind" | "down";
  readonly drives: readonly (readonly [bone: string, tip: string | null])[];
}

const MAP: readonly Row[] = [
  { bone: "hip", rest: "bind", drives: [["Hip", null]] },
  { bone: "torso", rest: "bind", drives: [["Waist", null], ["Bust", null]] },
  { bone: "head", rest: "bind", drives: [["Neck", null], ["Head", null]] },
  { bone: "thighL", rest: "bind", drives: [["LegL", "KneeL"]] },
  { bone: "shinL", rest: "bind", drives: [["KneeL", "FootL"]] },
  { bone: "footL", rest: "bind", drives: [["FootL", "ToeL"]] },
  { bone: "thighR", rest: "bind", drives: [["LegR", "KneeR"]] },
  { bone: "shinR", rest: "bind", drives: [["KneeR", "FootR"]] },
  { bone: "footR", rest: "bind", drives: [["FootR", "ToeR"]] },
  { bone: "upperArmL", rest: "down", drives: [["ShoulderL", "ArmL"]] },
  { bone: "forearmL", rest: "down", drives: [["ArmL", "HandL"]] },
  { bone: "handL", rest: "down", drives: [["HandL", "HaveL"]] },
  { bone: "upperArmR", rest: "down", drives: [["ShoulderR", "ArmR"]] },
  { bone: "forearmR", rest: "down", drives: [["ArmR", "HandR"]] },
  { bone: "handR", rest: "down", drives: [["HandR", "HaveR"]] },
];

/** Every 2D bone but the root at its own angle, no two alike, so a bone driving another's SSBU bone is a different direction. */
const DISTINCT: PoseAngles = {
  hip: deg(9),
  torso: deg(-24),
  head: deg(17),
  thighL: deg(-70),
  shinL: deg(35),
  footL: deg(52),
  thighR: deg(115),
  shinR: deg(-48),
  footR: deg(-21),
  upperArmL: deg(-130),
  forearmL: deg(66),
  handL: deg(-37),
  upperArmR: deg(95),
  forearmR: deg(-58),
  handR: deg(41),
};

const T2D = { x: 0, y: 0, scale: 1, facing: 1 } as const;

/** Side-plane angle of an SSBU bone: toward its tip, or along its own +X without one. */
function boneAngle(world: readonly (readonly number[])[], bone: string, tip: string | null): number {
  if (tip === null) {
    const axis = mAxis(world[at(bone)], 0);
    return Math.atan2(axis[2], axis[1]);
  }
  return sideAngle(world as number[][], bone, tip);
}

/** Every matrix entry of two poses agrees. */
function expectSamePose(got: readonly (readonly number[])[], want: readonly (readonly number[])[]): void {
  expect(got).toHaveLength(want.length);
  got.forEach((m, i) => {
    m.forEach((v, k) => expect(v, `${rig.names[i]}[${k}]`).toBeCloseTo(want[i][k], 9));
  });
}

describe("the 2D-to-SSBU map, row by row", () => {
  it("is the fifteen rows below: one per 2D bone but the root, and nothing else", () => {
    expect(MAP.map((r) => r.bone)).toEqual(BONE_NAMES.filter((n) => n !== "root"));
    expect(Object.keys(RETARGET).sort()).toEqual(MAP.map((r) => r.bone).sort());
  });

  it("accumulates the 2D angles the way resolve() does, which is the oracle for the rows", () => {
    const rotation = deg(13);
    const sk = resolve(BASE_RIG, { ...DISTINCT, root: deg(-6) }, { ...T2D, rotation });
    const acc = accumulatedAngles(BASE_RIG, { ...DISTINCT, root: deg(-6) }, rotation);
    for (const name of BONE_NAMES) expect(acc[name], name).toBeCloseTo(sk[name].angle, 12);
  });

  for (const row of MAP) {
    it(`${row.bone} turns ${row.drives.map(([b]) => b).join(" and ")} to the 2D angle (rest "${row.rest}")`, () => {
      const world = posed(DISTINCT);
      const posed2d = resolve(BASE_RIG, DISTINCT, T2D)[row.bone].angle;
      const rest2d = resolve(BASE_RIG, {}, T2D)[row.bone].angle;
      for (const [bone, tip] of row.drives) {
        // "down": the 2D angle itself. "bind": SSBU's own bind direction, turned by the clip's angle relative to the 2D rest.
        const want =
          row.rest === "down"
            ? posed2d
            : boneAngle(rig.restWorld, bone, tip) + (posed2d - rest2d);
        expect(angleDelta(boneAngle(world, bone, tip), want), `${bone}`).toBeCloseTo(0, 9);
      }
    });
  }

  it("turns exactly the bones it drives: a bone no row names rides on its parent", () => {
    // Every SSBU bone the map names, from the literal table.
    const driven = new Set(MAP.flatMap((r) => r.drives.map(([b]) => b)));
    const world = posed(DISTINCT);
    for (const name of ["ClavicleL", "ClavicleR", "ClavicleC", "HaveL", "HaveR", "ToeL", "ToeR", "Throw"]) {
      expect(driven.has(name), name).toBe(false);
      const i = at(name);
      const p = rig.parent[i];
      // Its transform relative to its parent is its bind transform.
      const bind = mMul(mInvertRigid(rig.restWorld[p]), rig.restWorld[i]);
      const now = mMul(mInvertRigid(world[p]), world[i]);
      now.forEach((v, k) => expect(v, `${name}[${k}]`).toBeCloseTo(bind[k], 9));
    }
  });
});

describe("whole-body turns", () => {
  const turn = (a: number, shift: Vec3 = [0, 0, 0]) => compose(shift, qRotX(a));

  it("turns every bone by the root's angle about the feet, as resolve() does for the root bone", () => {
    const a = deg(30);
    const world = posed({ root: a });
    expectSamePose(world, REST.map((m) => mMul(turn(a), m)));
    // The head, 10 up at rest, leans forward: +z, the way the 2D rig's front is.
    const head = mTranslation(world[at("Head")]);
    expect(head[1]).toBeCloseTo(10 * Math.cos(a), 9);
    expect(head[2]).toBeCloseTo(10 * Math.sin(a), 9);
    const sk = resolve(BASE_RIG, { root: a }, T2D);
    expect(Math.atan2(head[2], head[1])).toBeCloseTo(Math.atan2(sk.head.x1, -sk.head.y1), 9);
  });

  it("composes the root's angle with the pose rotation, which alone pivots about the pelvis", () => {
    const a = deg(30);
    const r = deg(20);
    const world = posed({ root: a }, r);
    // resolve()'s shift: P - R*P, with R the rotation only (forward is -P sin r, up P (1 - cos r)).
    const shift: Vec3 = [0, cal.pivotY * (1 - Math.cos(r)), -cal.pivotY * Math.sin(r)];
    expectSamePose(world, REST.map((m) => mMul(turn(a + r, shift), m)));
  });

  it("still poses the driven bones on top of a whole-body turn", () => {
    const a = deg(-35);
    const r = deg(15);
    const world = posed(DISTINCT, r);
    const turned = posed({ ...DISTINCT, root: a }, 0);
    // Turning the root by `a` turns the whole posed body by `a`, driven bones included.
    expectSamePose(turned, posed(DISTINCT).map((m) => mMul(turn(a), m)));
    // The rotation adds to every driven bone's 2D angle.
    const acc = accumulatedAngles(BASE_RIG, DISTINCT, r);
    expect(angleDelta(acc.upperArmR, sideAngle(world, "ShoulderR", "ArmR"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.forearmL, sideAngle(world, "ArmL", "HandL"))).toBeCloseTo(0, 9);
  });
});

describe("posing in place (the renderer, every frame)", () => {
  it("refills one buffer with exactly what a fresh one gets, pose after pose, keeping every array it owns", () => {
    const buffer = newPoseBuffer(rig);
    const arrays = [buffer.q, buffer.t, ...buffer.q, ...buffer.t];
    const poses: [PoseAngles, number][] = [
      [DISTINCT, deg(15)],
      [{}, 0],
      [{ ...DISTINCT, root: deg(-6) }, deg(-140)],
      [{ thighR: 2.6, upperArmL: deg(-80), forearmL: deg(30) }, deg(400)],
      [DISTINCT, deg(15)],
    ];
    for (const [angles, rotation] of poses) {
      expect(retargetInto(cal, BASE_RIG, angles, rotation, buffer)).toBe(buffer);
      const fresh = retarget(cal, BASE_RIG, angles, rotation);
      expect(buffer.q).toEqual(fresh.q);
      expect(buffer.t).toEqual(fresh.t);
    }
    expect([buffer.q, buffer.t, ...buffer.q, ...buffer.t].every((a, k) => a === arrays[k])).toBe(true);
  });

  it("refuses a buffer made for another skeleton", () => {
    const fewer = newPoseBuffer({ ...rig, names: rig.names.slice(1) });
    expect(() => retargetInto(cal, BASE_RIG, {}, 0, fewer)).toThrow(`retarget ${rig.fighter}: a pose buffer for ${rig.names.length - 1} bones, not ${rig.names.length}`);
  });
});

describe("a bind pose that leans out of the side plane", () => {
  // The left thigh leans 0.6 out sideways and 0.5 forward of the hip, with the rest of the leg moved along with the knee.
  const lean = testSkeleton("lean");
  const OUT = 0.6;
  const FORWARD = 0.5;
  const leaning = {
    ...lean,
    bones: lean.bones.map((b) =>
      ["KneeL", "FootL", "ToeL"].includes(b.name)
        ? { ...b, world: [...b.world.slice(0, 12), b.world[12] + OUT, b.world[13], b.world[14] + FORWARD, 1] }
        : b,
    ),
  };
  const leanRig = buildRig(leaning);
  const leanCal = calibrate(leanRig, BASE_RIG);
  const poseOf = (angles: PoseAngles) => worldMatrices(leanRig, retarget(leanCal, BASE_RIG, angles, 0), IDENTITY_ROOT);
  const idx = (name: string) => leanRig.byLower.get(name.toLowerCase())!;
  const sideAngleOf = (world: readonly (readonly number[])[], from: string, to: string): number => {
    const a = mTranslation(world[idx(from)]);
    const b = mTranslation(world[idx(to)]);
    return Math.atan2(b[2] - a[2], b[1] - a[1]);
  };
  const hipSide = leanRig.restWorld[idx("LegL")][12];
  const full = Math.hypot(OUT, 2.1, FORWARD);
  const inPlane = Math.atan2(FORWARD, -2.1);

  it("swings the lean out at the 2D rest pose: the knee comes into the thigh's own plane at the projected angle, keeping its length", () => {
    const world = poseOf({});
    const leg = mTranslation(world[idx("LegL")]);
    const knee = mTranslation(world[idx("KneeL")]);
    expect(knee[0]).toBeCloseTo(hipSide, 9);
    expect(knee[0]).toBeCloseTo(leg[0], 9);
    expect(Math.hypot(knee[0] - leg[0], knee[1] - leg[1], knee[2] - leg[2])).toBeCloseTo(full, 9);
    expect(angleDelta(sideAngleOf(world, "LegL", "KneeL"), inPlane)).toBeCloseTo(0, 9);
    // Without the swing the knee would sit where the bind pose put it.
    expect(mTranslation(leanRig.restWorld[idx("KneeL")])[0]).toBeCloseTo(hipSide + OUT, 9);
  });

  it("keeps the thigh in its plane at the clip's angle relative to rest, and its length, in motion", () => {
    const rest = accumulatedAngles(BASE_RIG, {}, 0).thighL;
    const delta = deg(40);
    const world = poseOf({ thighL: rest + delta });
    const leg = mTranslation(world[idx("LegL")]);
    const knee = mTranslation(world[idx("KneeL")]);
    expect(knee[0]).toBeCloseTo(hipSide, 9);
    expect(Math.hypot(knee[0] - leg[0], knee[1] - leg[1], knee[2] - leg[2])).toBeCloseTo(full, 9);
    expect(angleDelta(sideAngleOf(world, "LegL", "KneeL"), inPlane + delta)).toBeCloseTo(0, 9);
  });
});

/*
 * The swordsmen's grip (Task 13b fix round 1): the model's fist holds the blade
 * across it, a quarter-turn from the 2D drawing, so Link's and Marth's right
 * hand is turned 90° further. That is the only override, and only `handR`'s
 * reference angle moves: π for the other six fighters, π/2 for the two.
 */
describe("the per-fighter drives", () => {
  const SWORDSMEN = ["link", "marth"];

  it("override only the swordsmen's right hand, keeping its bones and tip", () => {
    expect(Object.keys(RETARGET_OVERRIDES).sort()).toEqual(SWORDSMEN);
    for (const id of SWORDSMEN) {
      expect(Object.keys(RETARGET_OVERRIDES[id])).toEqual(["handR"]);
      expect(driveFor(id, "handR")).toEqual({ ...RETARGET.handR, turn: 90 });
      for (const bone of BONE_NAMES) if (bone !== "handR") expect(driveFor(id, bone), `${id} ${bone}`).toBe(RETARGET[bone]);
    }
  });

  it.each(FIGHTERS.map((f) => f.id))("calibrate %s's right hand at its reference angle", (id) => {
    const c = calibrate(buildRig(SKELETONS[id]), getCharacterRig(id).bones);
    const hand = c.drives.filter((d) => d.our === "handR");
    expect(hand).toHaveLength(1);
    expect(hand[0].ref).toBeCloseTo(SWORDSMEN.includes(id) ? Math.PI / 2 : Math.PI, 12);
    // Every other drive keeps the shared rule.
    for (const d of c.drives) if (d.our !== "handR" && RETARGET[d.our]!.rest === "down") expect(d.ref, `${id} ${d.our}`).toBe(Math.PI);
  });
});
