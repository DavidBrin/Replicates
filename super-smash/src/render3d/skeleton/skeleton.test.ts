import { describe, expect, it } from "vitest";

import { FIGHTER_IDS } from "@/fighters";

import { compose, mMul, qNormalize, type Mat4, type Vec3 } from "../math/rigid";
import { buildRig, parseSkeletonFile, RIGID_TOLERANCE, SKELETON_SCHEMA, trimSkeleton, type SkeletonBone, type SkeletonFile } from "./skeleton";
import { testSkeleton } from "./testSkeleton";

/** mulberry32: a seeded generator, so a failing skeleton can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function near(actual: readonly number[], expected: readonly number[], digits: number): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));
}

/**
 * A skeleton the way the dump produces one from a real model: every bone turned
 * by an oblique rotation off its parent, then each matrix rounded to five
 * decimals. Nothing in it lines up with an axis, and no frame is quite rigid.
 */
function obliqueSkeleton(seed: number): SkeletonFile {
  const r = rng(seed);
  const parents = [null, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13];
  const world: Mat4[] = [];
  const bones: SkeletonBone[] = parents.map((p, i) => {
    const q = qNormalize([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.3]);
    const t: Vec3 = [(r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 6];
    const local = compose(t, q);
    world.push(p === null ? local : mMul(world[p], local));
    return {
      name: `Bone${i}`,
      parent: p === null ? null : `Bone${p}`,
      world: world[i].map((v) => Math.round(v * 1e5) / 1e5),
    };
  });
  return { schema: SKELETON_SCHEMA, fighter: "oblique", bones, hurt: [{ bone: "Bone4", x1: 0, x2: 1, r: 0.5 }] };
}

/** `testSkeleton` with one bone changed. */
function withBone(s: SkeletonFile, name: string, change: Partial<SkeletonBone>): SkeletonFile {
  return { ...s, bones: s.bones.map((b) => (b.name === name ? { ...b, ...change } : b)) };
}

function withWorld(name: string, edit: (w: number[]) => number[]): SkeletonFile {
  const s = testSkeleton("bad");
  return withBone(s, name, { world: edit([...s.bones.find((b) => b.name === name)!.world]) });
}

describe("the skeleton file", () => {
  it("accepts the shape the Blender dump produces", () => {
    expect(parseSkeletonFile(testSkeleton()).bones).toHaveLength(28);
  });

  it("returns a clean copy: only the format's own fields, sharing nothing with the input", () => {
    const s = testSkeleton("copy");
    const noisy = { ...s, extra: 1, bones: s.bones.map((b) => ({ ...b, note: "x" })), hurt: s.hurt.map((h) => ({ ...h, why: "y" })) };
    const parsed = parseSkeletonFile(noisy);
    expect(Object.keys(parsed).sort()).toEqual(["bones", "fighter", "hurt", "schema"]);
    expect(Object.keys(parsed.bones[0]).sort()).toEqual(["name", "parent", "world"]);
    expect(Object.keys(parsed.hurt[0]).sort()).toEqual(["bone", "r", "x1", "x2"]);
    expect(parsed).toEqual(s);
    expect(parsed.bones[0].world).not.toBe(s.bones[0].world);
    expect(parseSkeletonFile(parsed)).toEqual(parsed);
  });

  it("refuses duplicate names, missing parents, bad matrices and capsules on missing bones — by name", () => {
    const s = testSkeleton("bad");
    expect(() => parseSkeletonFile({ ...s, schema: 2 })).toThrow(/bad: schema 2/);
    expect(() => parseSkeletonFile({ ...s, bones: [...s.bones, { ...s.bones[3], name: "hip" }] })).toThrow(/two bones are called "hip"/);
    expect(() => parseSkeletonFile(withBone(s, "Head", { parent: "Nope" }))).toThrow(/missing parent "Nope"/);
    expect(() => parseSkeletonFile(withBone(s, "Head", { world: [1, 2] }))).toThrow(/Head" has no 16-number/);
    expect(() => parseSkeletonFile({ ...s, hurt: [{ bone: "Tail1", x1: 0, x2: 1, r: 1 }] })).toThrow(/missing bone "Tail1"/);
  });

  it("is not fooled by something that is not a skeleton", () => {
    for (const junk of [null, undefined, "skeleton", 7, []]) expect(() => parseSkeletonFile(junk)).toThrow(/^skeleton \?: not an object/);
    const s = testSkeleton("bad");
    for (const bones of [[], "abc", undefined, null, {}]) expect(() => parseSkeletonFile({ ...s, bones })).toThrow(/bad: no bones/);
    for (const hurt of [undefined, null, "x", {}]) expect(() => parseSkeletonFile({ ...s, hurt })).toThrow(/bad: no hurt list/);
  });

  it("names the problem when a bone or a capsule is malformed, never a raw TypeError", () => {
    const s = testSkeleton("bad");
    expect(() => parseSkeletonFile({ ...s, bones: [null] })).toThrow(/^skeleton bad: a bone is not an object/);
    expect(() => parseSkeletonFile({ ...s, bones: [...s.bones, 5] })).toThrow(/^skeleton bad: a bone is not an object/);
    expect(() => parseSkeletonFile(withBone(s, "Head", { name: "" }))).toThrow(/^skeleton bad: a bone has no name/);
    expect(() => parseSkeletonFile(withBone(s, "Head", { name: 4 as unknown as string }))).toThrow(/^skeleton bad: a bone has no name/);
    for (const parent of [undefined, 5, {}]) {
      expect(() => parseSkeletonFile(withBone(s, "Head", { parent: parent as unknown as string }))).toThrow(/^skeleton bad: bone "Head" has no parent field/);
    }
    expect(() => parseSkeletonFile({ ...s, hurt: [null] })).toThrow(/^skeleton bad: a hurt capsule has no bone name/);
    expect(() => parseSkeletonFile({ ...s, hurt: [{ bone: 5, x1: 0, x2: 1, r: 1 }] })).toThrow(/^skeleton bad: a hurt capsule has no bone name/);
  });

  describe("the fighter id", () => {
    it("must be a plain identifier, because it names a file and keys a lookup", () => {
      const s = testSkeleton("bad");
      for (const fighter of [undefined, null, "", 3, "has space", "dash-ed", "1mario", "../etc", "a/b"]) {
        expect(() => parseSkeletonFile({ ...s, fighter })).toThrow(/^skeleton \??.*: fighter /);
      }
      for (const fighter of ["mario", "donkeyKong", "a", "snake_2"]) expect(() => parseSkeletonFile(testSkeleton(fighter))).not.toThrow();
    });

    it("accepts every fighter in the roster", () => {
      expect(FIGHTER_IDS.length).toBeGreaterThan(0);
      for (const id of FIGHTER_IDS) expect(parseSkeletonFile(testSkeleton(id)).fighter).toBe(id);
    });
  });

  describe("world matrices", () => {
    it("must have sixteen finite numbers", () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        for (const at of [0, 5, 12, 13, 14, 15]) {
          expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === at ? bad : v))))).toThrow(/Head" has no 16-number/);
        }
      }
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === 12 ? ("1" as unknown as number) : v))))).toThrow(/Head" has no 16-number/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.slice(0, 15)))).toThrow(/Head" has no 16-number/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => [...w, 1]))).toThrow(/Head" has no 16-number/);
      // A sparse array of length 16 has holes that `some` and `every` would skip.
      const sparse: number[] = new Array<number>(16);
      sparse[0] = 1;
      sparse[5] = 1;
      sparse[10] = 1;
      sparse[15] = 1;
      expect(() => parseSkeletonFile(withWorld("Head", () => sparse))).toThrow(/Head" has no 16-number/);
    });

    it("must be rigid: no scale, shear, mirror or perspective, each named by bone", () => {
      const bottom = (v: number) => (w: number[]) => w.map((x, i) => (i === 15 ? v : x));
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i < 12 && i % 4 !== 3 ? v * 2 : v))))).toThrow(/bone "Head" world matrix is scaled: its X axis has length 2/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i < 12 ? 0 : v))))).toThrow(/^skeleton bad: bone "Head" world matrix is scaled: its X axis has length 0/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i >= 8 && i < 11 ? v * 3 : v))))).toThrow(/its Z axis has length 3/);
      expect(() => parseSkeletonFile(withWorld("Head", bottom(2)))).toThrow(/bone "Head" world matrix has a bottom row other than 0 0 0 1/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === 3 ? 0.5 : v))))).toThrow(/bottom row/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === 11 ? -0.1 : v))))).toThrow(/bottom row/);
      // Two parallel axes: X and Y both point along +Y (Head's own frame is X up, Y forward).
      expect(() => parseSkeletonFile(withWorld("Head", (w) => [w[0], w[1], w[2], 0, w[0], w[1], w[2], 0, w[8], w[9], w[10], 0, w[12], w[13], w[14], 1]))).toThrow(/is sheared: its X and Y axes are not perpendicular/);
      // A mirror image: Z reversed, so the frame is left-handed.
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i >= 8 && i < 11 ? -v : v))))).toThrow(/bone "Head" world matrix is a mirror image \(determinant -1/);
      // Mirroring in the only way a hand-built matrix can hide it: swap two axes.
      expect(() => parseSkeletonFile(withWorld("Head", (w) => [...w.slice(4, 8), ...w.slice(0, 4), ...w.slice(8)]))).toThrow(/mirror image/);
    });

    it("tolerates the rounding the dump does, and not much more", () => {
      const scale = (f: number) => (w: number[]) => w.map((v, i) => (i < 12 && i % 4 !== 3 ? v * f : v));
      expect(RIGID_TOLERANCE).toBe(1e-4);
      expect(() => parseSkeletonFile(withWorld("Head", scale(1 + RIGID_TOLERANCE / 2)))).not.toThrow();
      expect(() => parseSkeletonFile(withWorld("Head", scale(1 - RIGID_TOLERANCE / 2)))).not.toThrow();
      expect(() => parseSkeletonFile(withWorld("Head", scale(1 + 2 * RIGID_TOLERANCE)))).toThrow(/scaled/);
      expect(() => parseSkeletonFile(withWorld("Head", scale(1 - 2 * RIGID_TOLERANCE)))).toThrow(/scaled/);
      // A real rotation, rounded to five decimals, is accepted as it comes out of the dump.
      for (let seed = 1; seed <= 20; seed++) expect(() => parseSkeletonFile(obliqueSkeleton(seed))).not.toThrow();
    });

    it("is not fooled into accepting a matrix with a NaN that every comparison would let past", () => {
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === 12 ? NaN : v))))).toThrow(/16-number/);
      expect(() => parseSkeletonFile(withWorld("Head", (w) => w.map((v, i) => (i === 2 ? NaN : v))))).toThrow(/16-number/);
    });
  });

  describe("hurt capsules", () => {
    const capsule = (patch: Record<string, unknown>) => ({ ...testSkeleton("bad"), hurt: [{ bone: "Head", x1: 0, x2: 1, r: 1, ...patch }] });

    it("need a finite radius above zero and finite ends", () => {
      for (const r of [0, -1, NaN, Infinity, -Infinity, "2", undefined, null]) {
        expect(() => parseSkeletonFile(capsule({ r }))).toThrow(/hurt capsule on "Head" is malformed/);
      }
      for (const x of [NaN, Infinity, "0", undefined]) {
        expect(() => parseSkeletonFile(capsule({ x1: x }))).toThrow(/hurt capsule on "Head" is malformed/);
        expect(() => parseSkeletonFile(capsule({ x2: x }))).toThrow(/hurt capsule on "Head" is malformed/);
      }
      expect(() => parseSkeletonFile(capsule({ r: 1e-9, x1: -3, x2: 3 }))).not.toThrow();
    });
  });

  describe("parent cycles", () => {
    const s = testSkeleton("loop");

    it("refuses a bone that is its own parent", () => {
      expect(() => parseSkeletonFile(withBone(s, "Head", { parent: "Head" }))).toThrow(/^skeleton loop: bone "Head" is its own ancestor/);
      expect(() => parseSkeletonFile(withBone(s, "Head", { parent: "head" }))).toThrow(/bone "Head" is its own ancestor/);
    });

    it("refuses a two-bone cycle, naming a bone on it", () => {
      expect(() => parseSkeletonFile(withBone(s, "Neck", { parent: "Head" }))).toThrow(/^skeleton loop: bone "Neck" is its own ancestor/);
    });

    it("names a bone on the cycle, not one that only hangs off it", () => {
      // Head first in the file, then Hip -> Bust -> Waist -> Hip: Head leads into the loop but is not in it.
      const cyclic = withBone(s, "Hip", { parent: "Bust" });
      const reordered = { ...cyclic, bones: [...cyclic.bones].reverse() };
      expect(() => parseSkeletonFile(reordered)).toThrow(/^skeleton loop: bone "(Bust|Waist|Hip)" is its own ancestor/);
    });

    it("accepts a parent that comes after its child, which buildRig orders", () => {
      expect(() => parseSkeletonFile({ ...s, bones: [...s.bones].reverse() })).not.toThrow();
    });

    it("is refused by buildRig on its own, for a file that skipped the parser", () => {
      expect(() => buildRig(withBone(s, "Head", { parent: "Head" }))).toThrow(/^skeleton loop: bone "(Head)" is its own ancestor/);
      expect(() => buildRig(withBone(s, "Neck", { parent: "Head" }))).toThrow(/skeleton loop: bone "(Neck|Head)" is its own ancestor/);
      expect(() => buildRig(withBone(s, "Head", { parent: "Nope" }))).toThrow(/^skeleton loop: bone "Head" names missing parent "Nope"/);
    });
  });

  describe("bone names", () => {
    it("resolves a parent written in any case to the bone's own spelling", () => {
      const s = testSkeleton("case");
      const parsed = parseSkeletonFile(withBone(s, "Head", { parent: "neck" }));
      expect(parsed.bones.find((b) => b.name === "Head")!.parent).toBe("Neck");
      expect(parseSkeletonFile(withBone(s, "Head", { parent: "NECK" })).bones.find((b) => b.name === "Head")!.parent).toBe("Neck");
      const rig = buildRig(parsed);
      expect(rig.names[rig.parent[rig.byLower.get("head")!]]).toBe("Neck");
      expect(rig.restWorld).toEqual(buildRig(s).restWorld);
    });

    it("resolves a hurt capsule's bone in any case, so trimming keeps it", () => {
      const s = testSkeleton("case");
      const parsed = parseSkeletonFile({ ...s, hurt: [{ bone: "head", x1: 0.5, x2: 2.5, r: 2 }, { bone: "KNEEL", x1: 0, x2: 2.4, r: 0.9 }] });
      expect(parsed.hurt.map((h) => h.bone)).toEqual(["Head", "KneeL"]);
      const t = trimSkeleton(parsed, (n) => n === "head");
      expect(t.hurt.map((h) => h.bone)).toEqual(["Head"]);
    });

    it("refuses two bones that differ only by case, as ambiguous", () => {
      const s = testSkeleton("case");
      expect(() => parseSkeletonFile({ ...s, bones: [...s.bones, { ...s.bones[6], name: "HEAD" }] })).toThrow(/two bones are called "HEAD"/);
    });
  });
});

describe("buildRig", () => {
  it("orders parents before children and recovers each bone's local transform", () => {
    const shuffled = testSkeleton();
    const rig = buildRig({ ...shuffled, bones: [...shuffled.bones].reverse() });
    rig.parent.forEach((p, i) => expect(p).toBeLessThan(i));
    const knee = rig.byLower.get("kneel")!;
    // KneeL sits 2.1 below LegL along LegL's +X (which points down).
    expect(rig.restLocalT[knee][0]).toBeCloseTo(2.1, 9);
  });

  it("splits each bind matrix into the translation in its parent's frame: every component", () => {
    const s = testSkeleton();
    const rig = buildRig(s);
    const raw = new Map(s.bones.map((b) => [b.name, b]));
    rig.names.forEach((name, i) => {
      const b = raw.get(name)!;
      if (b.parent === null) return near(rig.restLocalT[i], [b.world[12], b.world[13], b.world[14]], 12);
      const p = raw.get(b.parent)!;
      const d = [b.world[12] - p.world[12], b.world[13] - p.world[13], b.world[14] - p.world[14]];
      // Dot the offset with each of the parent's axes: independent of mInvertRigid and mMul.
      const local = [0, 4, 8].map((c) => d[0] * p.world[c] + d[1] * p.world[c + 1] + d[2] * p.world[c + 2]);
      near(rig.restLocalT[i], local, 12);
    });
    // Two by hand: Hip sits 0.5 below Rot; ToeL is 0.7 down-axis and 1.3 along FootL's -Y.
    near(rig.restLocalT[rig.byLower.get("hip")!], [0, -0.5, 0], 12);
    near(rig.restLocalT[rig.byLower.get("toel")!], [0.7, -1.3, 0], 12);
  });

  it("gives each local a rotation that rebuilds the bone from its parent, on every bone", () => {
    for (const file of [testSkeleton(), obliqueSkeleton(1), obliqueSkeleton(2), obliqueSkeleton(3)]) {
      const rig = buildRig(parseSkeletonFile(file));
      rig.names.forEach((_, i) => {
        const local = compose(rig.restLocalT[i], rig.restLocalQ[i]);
        const world = rig.parent[i] < 0 ? local : mMul(rig.restWorld[rig.parent[i]], local);
        near(world, rig.restWorld[i], 11);
      });
    }
  });

  it("keeps a bone's rest rotation, not the identity, in its local", () => {
    const rig = buildRig(testSkeleton());
    // Rot is the identity frame and Hip's axes are (up, forward, left): a cyclic permutation of X, Y, Z,
    // which is 120 degrees about (1,1,1), the quaternion (.5, .5, .5, .5).
    near(rig.restLocalQ[rig.byLower.get("hip")!], [0.5, 0.5, 0.5, 0.5], 12);
    near(rig.restLocalQ[rig.byLower.get("rot")!], [0, 0, 0, 1], 12);
  });

  it("keeps each rest frame orthonormal and within rounding of the dump, for a rounded oblique rig", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const file = obliqueSkeleton(seed);
      const rig = buildRig(parseSkeletonFile(file));
      const raw = new Map(file.bones.map((b) => [b.name, b]));
      rig.names.forEach((name, i) => {
        const m = rig.restWorld[i];
        const ax = [0, 4, 8].map((c) => [m[c], m[c + 1], m[c + 2]]);
        // Orthonormal to machine precision, where the dump's frame is only within 1e-4.
        ax.forEach((a, k) => {
          expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 12);
          ax.slice(k + 1).forEach((b) => expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeCloseTo(0, 12));
        });
        // The same frame as the dump, to the dump's rounding: no flipped axis, no drift.
        near(m, raw.get(name)!.world, 4);
        // And right-handed.
        const [x, y, z] = ax;
        expect(x[0] * (y[1] * z[2] - y[2] * z[1]) + x[1] * (y[2] * z[0] - y[0] * z[2]) + x[2] * (y[0] * z[1] - y[1] * z[0])).toBeCloseTo(1, 12);
      });
    }
  });
});

describe("trimSkeleton", () => {
  it("trims to the bones asked for and every ancestor, keeping only their hurt capsules", () => {
    const t = trimSkeleton(testSkeleton(), (n) => n === "handl" || n === "head");
    expect(t.bones.map((b) => b.name)).toEqual(["Trans", "Rot", "Hip", "Waist", "Bust", "Neck", "Head", "ClavicleC", "ClavicleL", "ShoulderL", "ArmL", "HandL"]);
    expect(t.hurt.map((h) => h.bone).sort()).toEqual(["ArmL", "Bust", "Head", "Hip", "ShoulderL"]);
  });

  it("asks about lower-case names and keeps the file's own spelling", () => {
    const asked: string[] = [];
    const s = testSkeleton();
    const t = trimSkeleton(s, (n) => {
      asked.push(n);
      return false;
    });
    expect(asked).toEqual(s.bones.map((b) => b.name.toLowerCase()));
    expect(t.bones).toEqual([]);
    expect(t.hurt).toEqual([]);
    expect(t.schema).toBe(SKELETON_SCHEMA);
    expect(t.fighter).toBe("test");
  });

  it("poses the trimmed skeleton exactly like the full one", () => {
    const full = buildRig(testSkeleton());
    const t = buildRig(trimSkeleton(testSkeleton(), (n) => n === "toer"));
    t.names.forEach((name, i) => near(t.restWorld[i], full.restWorld[full.byLower.get(name.toLowerCase())!], 12));
  });

  it("stops at a parent cycle in a file that skipped the parser, instead of looping", () => {
    const s = testSkeleton("loop");
    const cyclic = withBone(s, "Neck", { parent: "Head" });
    expect(trimSkeleton(cyclic, (n) => n === "head").bones.map((b) => b.name)).toEqual(["Neck", "Head"]);
    const self = withBone(s, "Head", { parent: "Head" });
    expect(trimSkeleton(self, (n) => n === "head").bones.map((b) => b.name)).toEqual(["Head"]);
  });
});
