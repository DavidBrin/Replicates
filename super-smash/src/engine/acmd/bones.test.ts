import { describe, expect, it } from "vitest";

import { ONE, fx } from "../fixed";
import {
  BONE_POSE_STRIDE,
  LEGACY_BONE_TABLE,
  TOP_POSE,
  bakedBoneTable,
  bakedPoseIndex,
  bonePoint,
  layeredBoneTable,
  newBonePose,
} from "./bones";
import type { BakedFighterBones, BonePose, BoneTable } from "./bones";
import { ATTACK, CATCH, frame, script, shieldSetoffMul } from "./dsl";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";

/** Two bones, three frames; each Int32 encodes where it sits so a wrong index is obvious. */
function synthetic(): BakedFighterBones {
  const bones = ["top", "kneer"];
  const frames = 3;
  const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
  for (let f = 1; f <= frames; f++) {
    for (let b = 0; b < bones.length; b++) {
      const i = bakedPoseIndex(f, b, bones.length);
      for (let k = 0; k < BONE_POSE_STRIDE; k++) data[i + k] = f * 1000 + b * 100 + k;
    }
  }
  return { fighter: "mario", bones, motions: { attack_air_n: { frames, data } } };
}

/** Ask a table for a pose; null when it has none. */
function poseOf(table: BoneTable, fighter: string, motion: string, frame: number, bone: string): BonePose | null {
  const out = newBonePose();
  return table.pose(fighter, motion, frame, bone, out) ? out : null;
}

describe("baked bone tables (the layout Plan 4 produces)", () => {
  const table = bakedBoneTable([synthetic()]);

  it("indexes frame-major, then bone, then the eight pose numbers", () => {
    const p = poseOf(table, "mario", "attack_air_n", 2, "kneer")!;
    expect([p.tx, p.ty, p.m00, p.m01, p.m02, p.m10, p.m11, p.m12]).toEqual([2100, 2101, 2102, 2103, 2104, 2105, 2106, 2107]);
  });

  it("clamps frames outside the motion to its ends", () => {
    expect(poseOf(table, "mario", "attack_air_n", 0, "top")!.tx).toBe(1000);
    expect(poseOf(table, "mario", "attack_air_n", 99, "top")!.tx).toBe(3000);
  });

  it("knows nothing it was not given, and leaves the output alone then", () => {
    expect(poseOf(table, "fox", "attack_air_n", 1, "top")).toBeNull();
    expect(poseOf(table, "mario", "attack_11", 1, "top")).toBeNull();
    expect(poseOf(table, "mario", "attack_air_n", 1, "handl")).toBeNull();
    const out = newBonePose();
    out.tx = 77;
    expect(table.pose("fox", "attack_air_n", 1, "top", out)).toBe(false);
    expect(out.tx).toBe(77);
  });

  it("writes into the pose it is handed, so a lookup allocates nothing", () => {
    const out = newBonePose();
    expect(table.pose("mario", "attack_air_n", 1, "top", out)).toBe(true);
    expect(table.pose("mario", "attack_air_n", 3, "kneer", out)).toBe(true);
    expect(out.tx).toBe(3100);
  });

  it("falls back to another table where the first has no answer", () => {
    const layered = layeredBoneTable(table, LEGACY_BONE_TABLE);
    expect(poseOf(layered, "fox", "attack_11", 7, "top")).toEqual(TOP_POSE);
  });
});

describe("bone-table fingerprints (compared by online peers, Task 27)", () => {
  it("are 8 hex digits, stable across builds of the same data", () => {
    expect(bakedBoneTable([synthetic()]).fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(bakedBoneTable([synthetic()]).fingerprint).toBe(bakedBoneTable([synthetic()]).fingerprint);
  });

  it("change when one Int32 of the bake changes", () => {
    const a = synthetic();
    const b = synthetic();
    b.motions.attack_air_n.data[13] += 1;
    expect(bakedBoneTable([b]).fingerprint).not.toBe(bakedBoneTable([a]).fingerprint);
  });

  it("do not depend on the order fighters are listed in", () => {
    const fox: BakedFighterBones = { ...synthetic(), fighter: "fox" };
    expect(bakedBoneTable([synthetic(), fox]).fingerprint).toBe(bakedBoneTable([fox, synthetic()]).fingerprint);
  });

  it("tell a layered table from either of its layers", () => {
    const baked = bakedBoneTable([synthetic()]);
    const layered = layeredBoneTable(baked, LEGACY_BONE_TABLE);
    expect(new Set([baked.fingerprint, LEGACY_BONE_TABLE.fingerprint, layered.fingerprint]).size).toBe(3);
  });
});

describe("the legacy (Plan 2) bone table", () => {
  it("answers for the root bone only, the same on every frame", () => {
    expect(poseOf(LEGACY_BONE_TABLE, "mario", "attack_11", 1, "top")).toEqual(TOP_POSE);
    expect(poseOf(LEGACY_BONE_TABLE, "kirby", "special_hi", 40, "top")).toEqual(TOP_POSE);
    expect(poseOf(LEGACY_BONE_TABLE, "mario", "attack_11", 1, "kneer")).toBeNull();
  });

  it("puts script Z forward and script Y up, as D17 reads the root bone", () => {
    expect(bonePoint(TOP_POSE, fx(9), fx(6.3), fx(6))).toEqual({ x: fx(6), y: fx(6.3) });
  });

  it("applies a general pose as matrix then translation", () => {
    const p = { tx: fx(1), ty: fx(2), m00: ONE, m01: 0, m02: 0, m10: 0, m11: 0, m12: -ONE };
    expect(bonePoint(p, fx(3), fx(4), fx(5))).toEqual({ x: fx(4), y: fx(-3) });
  });
});

describe("scriptHitboxes", () => {
  const s = script("game_test", "attack_11", [
    frame(2),
    ATTACK({ id: 1, bone: "top", damage: 3, angle: 361, kbg: 30, bkb: 20, size: 1.5, x: 0, y: 6.3, z: 8.7, collisionAttr: "collision_attr_elec" }),
    ATTACK({ id: 0, bone: "top", damage: 2.2, angle: 361, kbg: 30, fkb: 50, bkb: 0, size: 1.2, x: 0, y: 6.3, z: 6, hitlag: 1.5 }),
    shieldSetoffMul(1, 2),
    CATCH({ id: 0, bone: "top", size: 3.3, x: 0, y: 6.6, z: 6.4 }),
  ]);

  it("resolves through the bone table, attacks by id then catches", () => {
    const out = scriptHitboxes(runScript(s, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(out.map((h) => [h.id, h.x, h.y, h.grabbing === true])).toEqual([
      [0, fx(6), fx(6.3), false],
      [1, fx(8.7), fx(6.3), false],
      [0, fx(6.4), fx(6.6), true],
    ]);
  });

  it("maps ATTACK's arguments onto the Hitbox the combat pipeline reads", () => {
    const [set, elec] = scriptHitboxes(runScript(s, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(set).toMatchObject({ setKnockback: true, baseKnockback: fx(50), hitlagMultiplier: fx(1.5) });
    expect(elec).toMatchObject({ effect: "electric", baseKnockback: fx(20), shieldstunMultiplier: fx(2) });
    expect(elec.hitlagMultiplier).toBeUndefined();
  });

  it("refuses a bone the table cannot place, rather than guessing", () => {
    const limb = script("game_test", "attack_air_n", [
      ATTACK({ id: 0, bone: "kneer", damage: 8, angle: 361, kbg: 100, bkb: 20, size: 4, x: 0.8, y: 0, z: 0 }),
    ]);
    expect(() => scriptHitboxes(runScript(limb, 1), "mario", "attack_air_n", 1, LEGACY_BONE_TABLE)).toThrow(/kneer/);
  });

  it("refuses an extended (capsule) hitbox until Plan 3 can collide one", () => {
    const capsule = script("game_test", "attack_s3_s", [
      ATTACK({ id: 2, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, x2: 0, y2: 6, z2: 12 }),
    ]);
    expect(() => scriptHitboxes(runScript(capsule, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE)).toThrow(/capsule/);
  });
});
