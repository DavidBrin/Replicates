import { describe, expect, it } from "vitest";

import { ONE, fx } from "../fixed";
import type { HitEffect } from "../types";
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
import { ATTR_OF_EFFECT, EFFECT_OF_ATTR, scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";

/**
 * Two bones, three frames; each Int32 encodes where it sits so a wrong index is obvious.
 * Synthetic fixture: these numbers are not real fighter values, only index markers.
 */
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

  it("prefers the first table where both answer", () => {
    const layered = layeredBoneTable(table, LEGACY_BONE_TABLE);
    expect(poseOf(layered, "mario", "attack_air_n", 1, "top")!.tx).toBe(1000);
    expect(poseOf(layered, "mario", "attack_air_n", 1, "top")).not.toEqual(TOP_POSE);
  });
});

describe("a malformed bake is refused when the table is built", () => {
  it("rejects data whose length is not frames x bones x stride", () => {
    const short: BakedFighterBones = { fighter: "mario", bones: ["top"], motions: { attack_11: { frames: 3, data: new Int32Array(BONE_POSE_STRIDE) } } };
    expect(() => bakedBoneTable([short])).toThrow(/mario\/attack_11.*24 Int32s, got 8/);
    const long: BakedFighterBones = { fighter: "mario", bones: ["top"], motions: { attack_11: { frames: 1, data: new Int32Array(2 * BONE_POSE_STRIDE) } } };
    expect(() => bakedBoneTable([long])).toThrow(/mario\/attack_11.*8 Int32s, got 16/);
  });

  it("rejects a frame count that is not a whole number of at least 1", () => {
    for (const frames of [2.5, 0, -1, Number.NaN]) {
      const bad: BakedFighterBones = { fighter: "mario", bones: ["top"], motions: { attack_11: { frames, data: new Int32Array(0) } } };
      expect(() => bakedBoneTable([bad])).toThrow(/mario\/attack_11.*frames/);
    }
  });

  it("rejects a fighter with no bones", () => {
    expect(() => bakedBoneTable([{ fighter: "mario", bones: [], motions: {} }])).toThrow(/mario.*no bones/);
  });

  it("rejects a bone listed twice", () => {
    expect(() => bakedBoneTable([{ fighter: "mario", bones: ["top", "hip", "top"], motions: {} }])).toThrow(/mario.*twice/);
  });

  it("rejects a fighter listed twice", () => {
    expect(() => bakedBoneTable([synthetic(), synthetic()])).toThrow(/"mario" is listed twice/);
  });

  it("does not mistake an inherited property for a motion", () => {
    expect(poseOf(bakedBoneTable([synthetic()]), "mario", "constructor", 1, "top")).toBeNull();
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

  it("has a fingerprint that covers its pose, pinned so a change to either is seen", () => {
    expect(LEGACY_BONE_TABLE.fingerprint).toBe("8e0cab2b");
  });

  it("puts script Z forward and script Y up, as D17 reads the root bone", () => {
    expect(bonePoint(TOP_POSE, fx(9), fx(6.3), fx(6))).toEqual({ x: fx(6), y: fx(6.3) });
  });

  it("rounds a negative, non-exact product toward zero, as fixed.ts mul does", () => {
    // m00 = 0.5, lx = -3 raw units: -1.5 raw units -> -1 (floor would give -2).
    const half = { tx: 0, ty: 0, m00: ONE / 2, m01: 0, m02: 0, m10: ONE / 2, m11: 0, m12: 0 };
    expect(bonePoint(half, -3, 0, 0)).toEqual({ x: -1, y: -1 });
    expect(bonePoint(half, 3, 0, 0)).toEqual({ x: 1, y: 1 });
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
    expect(set).toMatchObject({ fixedKnockback: fx(50), baseKnockback: 0, hitlagMultiplier: fx(1.5) });
    expect(elec).toMatchObject({ effect: "electric", baseKnockback: fx(20), shieldstunMultiplier: fx(2) });
    expect(elec.hitlagMultiplier).toBeUndefined();
  });

  it("refuses a bone the table cannot place, rather than guessing", () => {
    const limb = script("game_test", "attack_air_n", [
      ATTACK({ id: 0, bone: "kneer", damage: 8, angle: 361, kbg: 100, bkb: 20, size: 4, x: 0.8, y: 0, z: 0 }),
    ]);
    expect(() => scriptHitboxes(runScript(limb, 1), "mario", "attack_air_n", 1, LEGACY_BONE_TABLE)).toThrow(/kneer/);
  });

  it("resolves a non-identity baked pose, frame by frame, end to end", () => {
    // Synthetic bake, not real fighter values: "handl" rides forward 2 units per motion frame, 5 up.
    const frames = 3;
    const data = new Int32Array(frames * 2 * BONE_POSE_STRIDE);
    for (let f = 1; f <= frames; f++) {
      data.set([0, 0, 0, 0, ONE, 0, ONE, 0], bakedPoseIndex(f, 0, 2));
      data.set([fx(2 * f), fx(5), 0, 0, ONE, 0, ONE, 0], bakedPoseIndex(f, 1, 2));
    }
    const baked = bakedBoneTable([{ fighter: "mario", bones: ["top", "handl"], motions: { attack_11: { frames, data } } }]);
    const hand = script("game_test", "attack_11", [
      frame(1),
      ATTACK({ id: 0, bone: "handl", damage: 3, angle: 361, kbg: 30, bkb: 20, size: 1.5, x: 0, y: 1, z: 3 }),
    ]);
    const at = (g: number) => scriptHitboxes(runScript(hand, g), "mario", "attack_11", g, baked).map((h) => [h.x, h.y]);
    expect(at(1)).toEqual([[fx(5), fx(6)]]);
    expect(at(3)).toEqual([[fx(9), fx(6)]]);
  });

  it("does not let a table that writes nothing leak the last lookup's pose", () => {
    const lazy: BoneTable = { fingerprint: "00000000", pose: () => true };
    const hand = script("game_test", "attack_11", [
      ATTACK({ id: 0, bone: "top", damage: 3, angle: 361, kbg: 30, bkb: 20, size: 1.5, x: 0, y: 6.3, z: 6 }),
    ]);
    scriptHitboxes(runScript(hand, 1), "mario", "attack_11", 1, LEGACY_BONE_TABLE);
    const [h] = scriptHitboxes(runScript(hand, 1), "mario", "attack_11", 1, lazy);
    expect([h.x, h.y]).toEqual([0, 0]);
  });

  // Plan 3, Task 17: an extended hitbox resolves both ends through the bone table.
  it("resolves both ends of an extended (capsule) hitbox", () => {
    const capsule = script("game_test", "attack_s3_s", [
      ATTACK({ id: 2, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, x2: 0, y2: 6, z2: 12 }),
    ]);
    const [hb] = scriptHitboxes(runScript(capsule, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE);
    expect([hb.x, hb.y, hb.x2, hb.y2]).toEqual([fx(4), fx(6), fx(12), fx(6)]);
  });

  it("resolves both ends of an extended (capsule) CATCH too, and keeps it a grab", () => {
    const grab = script("game_test", "catch", [CATCH({ id: 0, bone: "top", size: 3.3, x: 0, y: 6.6, z: 6.4, x2: 0, y2: 6.6, z2: 9 })]);
    const [hb] = scriptHitboxes(runScript(grab, 1), "mario", "catch", 1, LEGACY_BONE_TABLE);
    expect([hb.x, hb.y, hb.x2, hb.y2, hb.grabbing]).toEqual([fx(6.4), fx(6.6), fx(9), fx(6.6), true]);
  });

  // `ATTACK(..., X, Y, Z, X2, Y2, Z2, ...)`: an axis the script leaves out is the near end's.
  it("gives a far end the near end's value on any axis the script leaves out", () => {
    const only = (end: Partial<{ x2: number; y2: number; z2: number }>) => {
      const s = script("game_test", "attack_s3_s", [
        ATTACK({ id: 0, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, ...end }),
      ]);
      const [hb] = scriptHitboxes(runScript(s, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE);
      return [hb.x2, hb.y2];
    };
    expect(only({ z2: 12 })).toEqual([fx(12), fx(6)]);
    expect(only({ y2: 2 })).toEqual([fx(4), fx(2)]);
    expect(only({ x2: 5 })).toEqual([fx(4), fx(6)]);
  });

  it("leaves a sphere with no far end at all", () => {
    const sphere = script("game_test", "attack_s3_s", [
      ATTACK({ id: 0, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4 }),
    ]);
    const [hb] = scriptHitboxes(runScript(sphere, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE);
    expect("x2" in hb || "y2" in hb).toBe(false);
  });

  it("carries a capsule's far end through a non-identity baked pose, frame by frame", () => {
    // Synthetic bake, not real fighter values: "handl" rides forward 2 units per motion frame, 5 up.
    const frames = 3;
    const data = new Int32Array(frames * 2 * BONE_POSE_STRIDE);
    for (let f = 1; f <= frames; f++) {
      data.set([0, 0, 0, 0, ONE, 0, ONE, 0], bakedPoseIndex(f, 0, 2));
      data.set([fx(2 * f), fx(5), 0, 0, ONE, 0, ONE, 0], bakedPoseIndex(f, 1, 2));
    }
    const baked = bakedBoneTable([{ fighter: "mario", bones: ["top", "handl"], motions: { attack_11: { frames, data } } }]);
    const arm = script("game_test", "attack_11", [
      frame(1),
      ATTACK({ id: 0, bone: "handl", damage: 3, angle: 361, kbg: 30, bkb: 20, size: 1.5, x: 0, y: 1, z: 3, z2: 9, y2: 4 }),
    ]);
    const at = (g: number) => scriptHitboxes(runScript(arm, g), "mario", "attack_11", g, baked).map((h) => [h.x, h.y, h.x2, h.y2]);
    expect(at(1)).toEqual([[fx(5), fx(6), fx(11), fx(9)]]);
    expect(at(3)).toEqual([[fx(9), fx(6), fx(15), fx(9)]]);
  });
});

describe("collision_attr <-> HitEffect", () => {
  // Compile-time exhaustive: a new HitEffect member fails typecheck here until it is listed.
  const EFFECTS: Record<HitEffect, true> = {
    normal: true,
    electric: true,
    fire: true,
    slash: true,
    stab: true,
    darkness: true,
    aura: true,
    freeze: true,
    bury: true,
    paralyze: true,
  };

  it.each(Object.keys(EFFECTS) as HitEffect[])("%s has a collision_attr_* name that maps back to it", (effect) => {
    const attr = ATTR_OF_EFFECT[effect];
    expect(attr).toMatch(/^collision_attr_[a-z]+$/);
    expect(EFFECT_OF_ATTR[attr]).toBe(effect);
  });

  it("has no collision_attr_* name that maps to a different effect than its inverse", () => {
    for (const [attr, effect] of Object.entries(EFFECT_OF_ATTR)) expect(ATTR_OF_EFFECT[effect]).toBe(attr);
    expect(Object.keys(EFFECT_OF_ATTR)).toHaveLength(Object.keys(EFFECTS).length);
  });
});
