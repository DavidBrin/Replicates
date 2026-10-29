import { describe, expect, it } from "vitest";

import { BAKE_QUANTUM, decodeBake, encodeBake, type BakedFighter } from "./bakeCodec";
import { bakeTables } from "./bakeTables";
import { BONE_POSE_STRIDE, TOP_POSE, newBonePose, type BoneTable } from "./bones";

const get = (t: BoneTable, f: string, m: string, fr: number, b: string) => {
  const out = newBonePose();
  return t.pose(f, m, fr, b, out) ? out : null;
};

function fighter(): BakedFighter {
  const bones = ["hip", "kneer"];
  const frames = 3;
  const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 37) % 4001 - 2000) * BAKE_QUANTUM;
  return {
    bones: { fighter: "mario", bones, motions: { attack_air_n: { frames, data }, status_stand: { frames, data: data.map((v) => -v) } } },
    clocks: { attack_air_n: { kind: "script", frames }, status_stand: { kind: "idle", frames } },
    hurt: [{ bone: "kneer", x1: 0, x2: 4096 * 2, r: 4096 }],
  };
}

describe("the bake's file format", () => {
  it("round-trips every number, clock and hurtbox exactly", () => {
    const f = fighter();
    const [back] = decodeBake(encodeBake([f]));
    expect(back.bones.bones).toEqual(f.bones.bones);
    expect(Array.from(back.bones.motions.attack_air_n.data)).toEqual(Array.from(f.bones.motions.attack_air_n.data));
    expect(back.clocks).toEqual(f.clocks);
    expect(back.hurt).toEqual(f.hurt);
  });

  it("is byte-for-byte deterministic, whatever order the motions were baked in", () => {
    const f = fighter();
    const reordered: BakedFighter = { ...f, bones: { ...f.bones, motions: { status_stand: f.bones.motions.status_stand, attack_air_n: f.bones.motions.attack_air_n } } };
    expect(encodeBake([reordered])).toEqual(encodeBake([f]));
  });

  it("refuses a value off the 1/256 grid, a truncated file and a foreign file — loudly", () => {
    const f = fighter();
    const off = { ...f, bones: { ...f.bones, motions: { ...f.bones.motions, attack_air_n: { frames: 3, data: f.bones.motions.attack_air_n.data.map((v, i) => (i === 5 ? v + 1 : v)) } } } };
    expect(() => encodeBake([off])).toThrow(/not on the 16-unit grid/);
    const bytes = encodeBake([f]);
    expect(() => decodeBake(bytes.slice(0, bytes.length - 3))).toThrow(/truncated/);
    expect(() => decodeBake(new TextEncoder().encode("PNG!...."))).toThrow(/not a David-Smash bake/);
  });

  it("answers baked limbs from the bake and the root bone from Plan 2's table", () => {
    const t = bakeTables(decodeBake(encodeBake([fighter()])), "test");
    expect(get(t.bones, "mario", "attack_air_n", 2, "kneer")).not.toBeNull();
    expect(get(t.bones, "mario", "attack_air_n", 2, "top")).toEqual(TOP_POSE);
    expect(get(t.bones, "fox", "attack_air_n", 2, "kneer")).toBeNull();
    expect(t.clock("mario", "status_stand")).toEqual({ kind: "idle", frames: 3 });
    expect(t.hurtboxes("fox")).toBeUndefined();
  });
});

/**
 * A motion of no frames cannot be indexed: the pose clock's once and scaled
 * clocks would answer frame 0 and its looping ones `n % 0` (NaN), and a bone
 * table would read past its data. So every motion has at least one frame, and
 * the bake is refused where it is built (DISPATCH-NOTES 10.4; Task 9 review,
 * Minor 2: the clock table is validated with the bone table).
 */
describe("a bake every motion of which has at least one frame", () => {
  /** `fighter()` cut down to one motion of `frames` frames. */
  function oneMotion(frames: number, clockFrames = frames): BakedFighter {
    const f = fighter();
    const data = new Int32Array(frames * f.bones.bones.length * BONE_POSE_STRIDE);
    return { ...f, bones: { ...f.bones, motions: { status_stand: { frames, data } } }, clocks: { status_stand: { kind: "once", frames: clockFrames } } };
  }

  it("is the only kind the encoder writes", () => {
    expect(() => encodeBake([oneMotion(0)])).toThrow(/mario\/status_stand has 0 frames; a motion needs at least 1/);
    expect(() => encodeBake([oneMotion(1)])).not.toThrow();
  });

  it("is the only kind the decoder reads", () => {
    // The one motion's frame count is the u16 just before its data, which is last in the file.
    const one = encodeBake([oneMotion(1)]);
    const dataBytes = 2 * 2 * BONE_POSE_STRIDE;
    const zero = one.slice(0, one.length - dataBytes);
    new DataView(zero.buffer).setUint16(zero.length - 2, 0, true);
    expect(() => decodeBake(zero)).toThrow(/mario\/status_stand has 0 frames; a motion needs at least 1/);
    expect(decodeBake(one)[0].bones.motions.status_stand.frames).toBe(1);
  });

  it("is the only kind bakeTables builds a bone table from (bakedBoneTable's assertWellFormed)", () => {
    expect(() => bakeTables([oneMotion(0)], "test")).toThrow(/frames must be a whole number of at least 1, got 0/);
    const f = oneMotion(2);
    const short: BakedFighter = { ...f, bones: { ...f.bones, motions: { status_stand: { frames: 2, data: new Int32Array(8) } } } };
    expect(() => bakeTables([short], "test")).toThrow(/needs 32 Int32s, got 8/);
  });

  it("has a clock for every motion and no other, each as long as its motion", () => {
    expect(() => bakeTables([oneMotion(2, 3)], "test")).toThrow(/"mario\/status_stand": a 3-frame clock for a 2-frame motion/);
    const f = oneMotion(2);
    expect(() => bakeTables([{ ...f, clocks: {} }], "test")).toThrow(/"mario\/status_stand": no clock/);
    expect(() => bakeTables([{ ...f, clocks: { ...f.clocks, status_fall: { kind: "loop", frames: 4 } } }], "test")).toThrow(
      /"mario\/status_fall": a clock for a motion the bake does not have/,
    );
    expect(() => bakeTables([f], "test")).not.toThrow();
  });
});
