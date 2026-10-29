import { describe, expect, it } from "vitest";

import {
  compose,
  IDENTITY_Q,
  mAxis,
  mInvertRigid,
  mMul,
  mRotation,
  mTranslation,
  normalize,
  qAxisAngle,
  qConj,
  qFromTo,
  qMul,
  qNormalize,
  qRotate,
  qRotX,
  type Mat4,
  type Quat,
  type Vec3,
} from "./rigid";

/**
 * Every check here compares the maths with something that is not the maths: a
 * textbook formula written out again in this file (Rodrigues, the quaternion's
 * rotation matrix, a matrix applied to a point), a known answer (120 degrees
 * about (1,1,1) permutes the axes), or an identity (q times its conjugate).
 * three.js is not a dependency here, so the agreement with it that the first
 * review measured over 3,000 cases is pinned by these oracles instead.
 *
 * Inputs are seeded random rotations and offsets, never just multiples of 90
 * degrees: an axis-aligned case cannot tell a transposed matrix from the right
 * one, or `qMul(a, b)` from `qMul(b, a)` when one factor is the identity.
 */

/** mulberry32: a seeded generator, so a failing case can be replayed. */
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

function randomUnit(r: () => number): Vec3 {
  for (;;) {
    const v: Vec3 = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n > 0.1 && n <= 1) return [v[0] / n, v[1] / n, v[2] / n];
  }
}

function randomQuat(r: () => number): Quat {
  for (;;) {
    const q: Quat = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (n > 0.1 && n <= 1) return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }
}

function randomVec(r: () => number, span = 10): Vec3 {
  return [(r() * 2 - 1) * span, (r() * 2 - 1) * span, (r() * 2 - 1) * span];
}

function near(actual: readonly number[], expected: readonly number[], digits = 11): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));
}

/** The textbook 3x3 rotation matrix of a unit quaternion, row-major, applied to `v`. */
function textbookRotate([x, y, z, w]: Quat, v: Vec3): Vec3 {
  return [
    (1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2],
    2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2],
    2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2],
  ];
}

/** Rodrigues' formula: `v` turned by `angle` about the unit `k`. */
function rodrigues(k: Vec3, angle: number, v: Vec3): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const kxv: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const at = (i: 0 | 1 | 2): number => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c);
  return [at(0), at(1), at(2)];
}

/** A column-major 4x4 applied to a point. */
function applyMat(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];
const IDENTITY_M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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

  describe("quaternions", () => {
    it("turn a vector like Rodrigues' formula, about a skew axis by an oblique angle", () => {
      const r = rng(1);
      for (let n = 0; n < 200; n++) {
        const axis = randomUnit(r);
        const angle = (r() * 2 - 1) * 2 * Math.PI;
        const v = randomVec(r);
        near(qRotate(qAxisAngle(axis, angle), v), rodrigues(axis, angle, v));
      }
    });

    it("turn a vector like the textbook rotation matrix", () => {
      const r = rng(2);
      for (let n = 0; n < 200; n++) {
        const q = randomQuat(r);
        const v = randomVec(r);
        near(qRotate(q, v), textbookRotate(q, v));
      }
    });

    it("120 degrees about (1,1,1) sends X to Y, Y to Z and Z to X", () => {
      const s = 1 / Math.sqrt(3);
      const q = qAxisAngle([s, s, s], (2 * Math.PI) / 3);
      near(qRotate(q, X), Y);
      near(qRotate(q, Y), Z);
      near(qRotate(q, Z), X);
    });

    it("qMul(a, b) is 'b first, then a', the order mMul uses for the matrices", () => {
      const r = rng(3);
      for (let n = 0; n < 200; n++) {
        const a = randomQuat(r);
        const b = randomQuat(r);
        const v = randomVec(r);
        near(qRotate(qMul(a, b), v), qRotate(a, qRotate(b, v)));
        near(compose([0, 0, 0], qMul(a, b)), mMul(compose([0, 0, 0], a), compose([0, 0, 0], b)));
      }
      // Two quarter turns that do not commute: Rx then Rz takes Y to Z; Rz then Rx takes it to -X.
      const rx = qAxisAngle(X, Math.PI / 2);
      const rz = qAxisAngle(Z, Math.PI / 2);
      near(qRotate(qMul(rz, rx), Y), Z);
      near(qRotate(qMul(rx, rz), Y), [-1, 0, 0]);
    });

    it("qMul by the identity changes nothing, and agrees with the Hamilton product on a fixed case", () => {
      const q = qNormalize([0.1, -0.5, 0.7, 0.3]);
      near(qMul(IDENTITY_Q, q), q);
      near(qMul(q, IDENTITY_Q), q);
      // (1 + 2i + 3j + 4k)(5 + 6i + 7j + 8k) = -60 + 12i + 30j + 24k, hand-expanded.
      near(qMul([2, 3, 4, 1], [6, 7, 8, 5]), [12, 30, 24, -60]);
    });

    it("qConj is the inverse of a unit quaternion", () => {
      const r = rng(4);
      for (let n = 0; n < 100; n++) {
        const q = randomQuat(r);
        near(qMul(q, qConj(q)), IDENTITY_Q);
        near(qMul(qConj(q), q), IDENTITY_Q);
        const v = randomVec(r);
        near(qRotate(qConj(q), qRotate(q, v)), v);
      }
      expect(qConj([1, 2, 3, 4])).toEqual([-1, -2, -3, 4]);
    });

    it("qNormalize gives unit length in the same direction", () => {
      expect(qNormalize([0, 3, 0, 4])).toEqual([0, 0.6, 0, 0.8]);
      const r = rng(5);
      for (let n = 0; n < 50; n++) {
        const q = randomQuat(r);
        const scaled: Quat = [q[0] * 7.5, q[1] * 7.5, q[2] * 7.5, q[3] * 7.5];
        near(qNormalize(scaled), q);
      }
    });

    it("qRotX is a right-handed turn about +X: Y goes to Z", () => {
      for (const angle of [0.3, -1.1, Math.PI / 2, 2.9]) near(qRotX(angle), qAxisAngle(X, angle));
      near(qRotate(qRotX(Math.PI / 2), Y), Z);
      near(qRotate(qRotX(-Math.PI / 2), Y), [0, 0, -1]);
    });

    it("normalize makes a unit vector, and names a zero-length one", () => {
      expect(normalize([0, 3, 4])).toEqual([0, 0.6, 0.8]);
      expect(() => normalize([0, 0, 0])).toThrow(/zero-length/);
      expect(() => normalize([1e-13, 0, 0])).toThrow(/zero-length/);
      near(normalize([1e-11, 0, 0]), X);
    });
  });

  describe("qFromTo", () => {
    it("takes `from` onto `to` by the shortest turn, for random pairs", () => {
      const r = rng(6);
      for (let n = 0; n < 300; n++) {
        const a = randomUnit(r);
        const b = randomUnit(r);
        const q = qFromTo(a, b);
        near(qRotate(q, a), b);
        expect(Math.hypot(...q)).toBeCloseTo(1, 12);
        const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        // The turn is the shortest one: angle acos(a.b), about the axis a x b, with no twist.
        const cross: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        near(q, qAxisAngle(normalize(cross), Math.acos(Math.max(-1, Math.min(1, d)))), 9);
        near(qRotate(q, cross), cross);
      }
    });

    it("is the identity for equal vectors and the inverse turn when its arguments swap", () => {
      const a = normalize([0.3, -0.5, 0.8]);
      const b = normalize([-0.7, 0.2, 0.4]);
      near(qFromTo(a, a), IDENTITY_Q);
      near(qRotate(qFromTo(b, a), b), a);
      near(qRotate(qFromTo(b, a), a), qRotate(qConj(qFromTo(a, b)), a));
      // 90 degrees about +Z takes X onto Y: the half-angle quaternion, by hand.
      near(qFromTo(X, Y), [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    });

    it("still turns the right way a hair outside the antiparallel band", () => {
      const eps = 1e-4;
      const to: Vec3 = [Math.sin(eps), -Math.cos(eps), 0];
      near(qRotate(qFromTo(Y, to), Y), to, 9);
    });

    it("turns antiparallel vectors a half turn, along ±X, ±Y, ±Z and askew", () => {
      const r = rng(7);
      const askew: Vec3[] = [];
      for (let n = 0; n < 100; n++) askew.push(randomUnit(r));
      const axes: Vec3[] = [X, Y, Z, [-1, 0, 0], [0, -1, 0], [0, 0, -1], normalize([0.9, 0.3, 0.1]), normalize([1, 1e-6, 0]), ...askew];
      for (const a of axes) {
        const back: Vec3 = [-a[0], -a[1], -a[2]];
        const q = qFromTo(a, back);
        near(qRotate(q, a), back);
        expect(Math.hypot(...q)).toBeCloseTo(1, 12);
        // A half turn (w is 0) about an axis perpendicular to `a`.
        expect(q[3]).toBeCloseTo(0, 12);
        expect(q[0] * a[0] + q[1] * a[1] + q[2] * a[2]).toBeCloseTo(0, 12);
      }
    });

    it("swings a vector perpendicular to X about +X, the side view's screen normal", () => {
      // Straight up to straight down, and forward to back, turn in the YZ plane.
      near(qFromTo(Y, [0, -1, 0]), [1, 0, 0, 0]);
      near(qFromTo(Z, [0, 0, -1]), [1, 0, 0, 0]);
      near(qFromTo(normalize([0, 1, 1]), normalize([0, -1, -1])), [1, 0, 0, 0]);
    });
  });

  describe("matrices", () => {
    it("compose puts the rotation in the columns, the scale on each axis and the offset last", () => {
      const r = rng(8);
      for (let n = 0; n < 100; n++) {
        const q = randomQuat(r);
        const t = randomVec(r);
        const s: Vec3 = [0.5 + r() * 3, 0.5 + r() * 3, 0.5 + r() * 3];
        const unscaled = compose([0, 0, 0], q);
        const m = compose(t, q, s);
        // Column i is rotated basis vector i, scaled by s[i].
        for (const i of [0, 1, 2] as const) near(mAxis(m, i), mAxis(unscaled, i).map((c) => c * s[i]));
        expect(mTranslation(m)).toEqual(t);
        expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
        const v = randomVec(r);
        const rv = textbookRotate(q, [v[0] * s[0], v[1] * s[1], v[2] * s[2]]);
        near(applyMat(m, v), [rv[0] + t[0], rv[1] + t[1], rv[2] + t[2]]);
      }
      // A fixed scale of (2, 3, 5) with no rotation reads straight off the diagonal.
      near(compose([0, 0, 0], IDENTITY_Q, [2, 3, 5]), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1]);
      near(compose([1, 2, 3], IDENTITY_Q), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
    });

    it("mMul(a, b) applies b first, then a, for two different non-symmetric transforms", () => {
      const r = rng(9);
      for (let n = 0; n < 100; n++) {
        const a = compose(randomVec(r), randomQuat(r));
        const b = compose(randomVec(r), randomQuat(r));
        const v = randomVec(r);
        near(applyMat(mMul(a, b), v), applyMat(a, applyMat(b, v)));
        near(mMul(a, IDENTITY_M), a);
        near(mMul(IDENTITY_M, a), a);
      }
      // A turn then a shift is not a shift then a turn.
      const turn = compose([0, 0, 0], qAxisAngle(Z, Math.PI / 2));
      const shift = compose([1, 0, 0], IDENTITY_Q);
      near(applyMat(mMul(turn, shift), [0, 0, 0]), [0, 1, 0]);
      near(applyMat(mMul(shift, turn), [0, 0, 0]), [1, 0, 0]);
    });

    it("mInvertRigid undoes a rigid transform with an offset in every component", () => {
      const r = rng(10);
      for (let n = 0; n < 100; n++) {
        const m = compose(randomVec(r), randomQuat(r));
        const inv = mInvertRigid(m);
        near(mMul(inv, m), IDENTITY_M);
        near(mMul(m, inv), IDENTITY_M);
        const v = randomVec(r);
        near(applyMat(inv, applyMat(m, v)), v);
      }
    });

    it("mTranslation reads the last column", () => {
      const m = compose([4, -5, 6], qAxisAngle(normalize([1, 2, 3]), 0.7));
      expect(mTranslation(m)).toEqual([4, -5, 6]);
    });

    it("mAxis reads columns, not rows", () => {
      // 120 degrees about (1,1,1) is a cyclic permutation: its transpose is the other cycle.
      const s = 1 / Math.sqrt(3);
      const m = compose([1, 2, 3], qAxisAngle([s, s, s], (2 * Math.PI) / 3));
      near(mAxis(m, 0), Y);
      near(mAxis(m, 1), Z);
      near(mAxis(m, 2), X);
      const r = rng(11);
      for (let n = 0; n < 50; n++) {
        const q = randomQuat(r);
        const rot = compose(randomVec(r), q);
        near(mAxis(rot, 0), qRotate(q, X));
        near(mAxis(rot, 1), qRotate(q, Y));
        near(mAxis(rot, 2), qRotate(q, Z));
      }
    });
  });

  describe("mRotation", () => {
    // Quaternions whose matrices take each of its four branches, with a distinct sign on every
    // component so that a sign slip in any one of them is visible. `trace` is 4w² − 1.
    const BRANCHES: ReadonlyArray<readonly [string, Quat]> = [
      ["trace", qNormalize([0.3, -0.4, 0.2, 0.8])],
      ["x", qNormalize([-0.7, 0.3, 0.4, 0.2])],
      ["y", qNormalize([0.3, -0.7, 0.4, -0.2])],
      ["z", qNormalize([0.3, 0.4, -0.7, 0.2])],
      // Every branch is correct in exact arithmetic; they differ in what they divide by. A turn of almost
      // exactly 180 degrees about Z leaves x and y tiny, and the x or y branch would then divide by ~1e-6
      // and lose eleven digits, so the choice of branch has to compare all three diagonal entries,
      // whichever of x or y leads.
      ["z, x above y", qNormalize([1e-6, 1e-7, 1, 0])],
      ["z, y above x", qNormalize([1e-7, 1e-6, 1, 0])],
    ];

    it("the fixtures really do take the branch each one names", () => {
      for (const [branch, q] of BRANCHES) {
        const m = compose([0, 0, 0], q);
        const trace = m[0] + m[5] + m[10];
        if (branch === "trace") expect(trace).toBeGreaterThan(0);
        else expect(trace).toBeLessThanOrEqual(0);
        if (branch === "x") expect(m[0]).toBeGreaterThan(Math.max(m[5], m[10]));
        if (branch === "y") expect(m[5]).toBeGreaterThan(Math.max(m[0], m[10]));
        if (branch.startsWith("z")) expect(m[10]).toBeGreaterThan(Math.max(m[0], m[5]));
        if (branch === "z, x above y") expect(m[0]).toBeGreaterThan(m[5]);
        if (branch === "z, y above x") expect(m[5]).toBeGreaterThan(m[0]);
      }
    });

    it.each(BRANCHES)("recovers a quaternion from its matrix: %s branch", (_branch, q) => {
      const back = mRotation(compose([1, 2, 3], q));
      // q and −q are the same rotation; compare as a rotation of three vectors and as a quaternion.
      const sign = Math.sign(back[0] * q[0] + back[1] * q[1] + back[2] * q[2] + back[3] * q[3]);
      near(back, q.map((c) => c * sign), 12);
      for (const v of [X, Y, Z, normalize([1, -2, 3])]) near(qRotate(back, v), qRotate(q, v), 12);
    });

    it("recovers 180-degree turns about each axis (every non-trace branch, w = 0)", () => {
      for (const axis of [X, Y, Z]) {
        const m = compose([0, 0, 0], qAxisAngle(axis, Math.PI));
        const back = mRotation(m);
        near(qRotate(back, axis), axis, 12);
        const other = axis === X ? Y : X;
        near(qRotate(back, other), applyMat(m, other), 12);
      }
    });

    it("round-trips seeded random rotations through all four branches", () => {
      const r = rng(12);
      const taken = new Set<string>();
      for (let n = 0; n < 400; n++) {
        const q = randomQuat(r);
        const m = compose([0, 0, 0], q);
        const trace = m[0] + m[5] + m[10];
        taken.add(trace > 0 ? "trace" : m[0] > m[5] && m[0] > m[10] ? "x" : m[5] > m[10] ? "y" : "z");
        const back = mRotation(m);
        for (const v of [X, Y, Z]) near(qRotate(back, v), qRotate(q, v), 11);
        expect(Math.abs(back[0] * q[0] + back[1] * q[1] + back[2] * q[2] + back[3] * q[3])).toBeCloseTo(1, 11);
      }
      expect([...taken].sort()).toEqual(["trace", "x", "y", "z"]);
    });
  });
});
