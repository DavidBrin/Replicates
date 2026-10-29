/**
 * The little rigid-body maths the bake and the retargeter need, with no
 * three.js in it.
 *
 * The bake (`bake/bake.ts`) must be reproducible from a plain `vitest run`, so
 * it cannot depend on a rendering library's matrix conventions or version. The
 * renderer uses three.js, and `render3d/fighter3d.test.ts` proves the two agree.
 *
 * Conventions: quaternions are `[x, y, z, w]`; matrices are 4×4 **column-major**
 * (`m[12..14]` is the translation), the layout three.js and glTF both use.
 */

export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];
/** 16 numbers, column-major. */
export type Mat4 = readonly number[];

export const IDENTITY_Q: Quat = [0, 0, 0, 1];

/** A quaternion or vector the caller owns and refills (the renderer's per-frame scratch). */
export type QuatOut = [number, number, number, number];
export type Vec3Out = [number, number, number];

export function qMul(a: Quat, b: Quat): Quat {
  return qMulInto([0, 0, 0, 0], a, b);
}

/** `a · b` written into `out` (which may be `a` or `b`); the one formula `qMul` also runs. */
export function qMulInto(out: QuatOut, a: Quat, b: Quat): QuatOut {
  // Indexed reads, not destructuring: no iterator, so nothing is allocated even before V8 optimises this.
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function qConj(q: Quat): Quat {
  return qConjInto([0, 0, 0, 0], q);
}

export function qConjInto(out: QuatOut, q: Quat): QuatOut {
  out[0] = -q[0];
  out[1] = -q[1];
  out[2] = -q[2];
  out[3] = q[3];
  return out;
}

/** Copy `q` into `out`. */
export function qCopyInto(out: QuatOut, q: Quat): QuatOut {
  out[0] = q[0];
  out[1] = q[1];
  out[2] = q[2];
  out[3] = q[3];
  return out;
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation of `angle` radians about the unit `axis`. */
export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Rotation about +X — the side view's screen normal in model space. */
export function qRotX(angle: number): Quat {
  return qRotXInto([0, 0, 0, 0], angle);
}

export function qRotXInto(out: QuatOut, angle: number): QuatOut {
  out[0] = Math.sin(angle / 2);
  out[1] = 0;
  out[2] = 0;
  out[3] = Math.cos(angle / 2);
  return out;
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  return qRotateInto([0, 0, 0], q, v);
}

/** `v` turned by `q`, written into `out` (which may be `v`). */
export function qRotateInto(out: Vec3Out, q: Quat, v: Vec3): Vec3Out {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}

/**
 * The shortest rotation taking unit vector `from` onto unit vector `to` (the
 * "swing"; both must be unit length).
 *
 * Antiparallel vectors have no unique shortest rotation: any half turn about an
 * axis perpendicular to `from` works. We pick the one nearest +X, the side
 * view's screen normal in model space, so a bone pointing straight up swings
 * forward-and-down rather than sideways. That is +X itself whenever `from` is
 * perpendicular to X, and +X with its `from` component removed otherwise; when
 * `from` lies (nearly) along ±X, +X has nothing left to keep, so +Y is used.
 */
export function qFromTo(from: Vec3, to: Vec3): Quat {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (d < -1 + 1e-9) {
    const ref: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const along = ref[0] * from[0] + ref[1] * from[1] + ref[2] * from[2];
    const [ax, ay, az] = normalize([ref[0] - along * from[0], ref[1] - along * from[1], ref[2] - along * from[2]]);
    return [ax, ay, az, 0];
  }
  const cx = from[1] * to[2] - from[2] * to[1];
  const cy = from[2] * to[0] - from[0] * to[2];
  const cz = from[0] * to[1] - from[1] * to[0];
  return qNormalize([cx, cy, cz, 1 + d]);
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-12) throw new Error("cannot normalise a zero-length vector");
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Translation, rotation and per-axis scale → column-major matrix (three.js `compose`). */
export function compose(t: Vec3, q: Quat, s: Vec3 = [1, 1, 1]): number[] {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export function mMul(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Inverse of a rigid transform (orthonormal rotation + translation). */
export function mInvertRigid(m: Mat4): number[] {
  const out = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  out[12] = -(out[0] * m[12] + out[4] * m[13] + out[8] * m[14]);
  out[13] = -(out[1] * m[12] + out[5] * m[13] + out[9] * m[14]);
  out[14] = -(out[2] * m[12] + out[6] * m[13] + out[10] * m[14]);
  return out;
}

export function mTranslation(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Column `i` (0 = local X axis) of a matrix's 3×3 part. */
export function mAxis(m: Mat4, i: 0 | 1 | 2): Vec3 {
  return [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
}

/** The rotation of an orthonormal (unscaled) matrix, as a quaternion. */
export function mRotation(m: Mat4): Quat {
  const m11 = m[0];
  const m12 = m[4];
  const m13 = m[8];
  const m21 = m[1];
  const m22 = m[5];
  const m23 = m[9];
  const m31 = m[2];
  const m32 = m[6];
  const m33 = m[10];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return qNormalize([(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]);
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return qNormalize([0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]);
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return qNormalize([(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]);
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return qNormalize([(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]);
}
