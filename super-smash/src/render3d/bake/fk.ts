/**
 * Forward kinematics and the projection onto the sim's side plane.
 *
 * The sim's `BonePose` (Plan 2, `engine/acmd/bones.ts`) is a bone's transform
 * in the fighter's facing-relative side plane: +x forward, +y up, origin at the
 * feet, Q12. SSBU model space has forward = +Z and up = +Y, so the projection
 * keeps the Z and Y rows of the bone's world matrix and drops X (depth):
 *
 *   x = m.Z·(lx, ly, lz) + t.z      y = m.Y·(lx, ly, lz) + t.y
 *
 * which is exactly `bonePoint`'s `m0* / m1*` rows. The root bone `top` in Plan
 * 2's `TOP_POSE` is the identity matrix under this projection, which is how the
 * legacy root-bone scripts and the baked limb bones share one coordinate frame.
 */

import { ONE } from "@/engine/fixed";
import type { BonePose } from "@/engine/acmd/bones";
import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { compose, mMul, type Mat4 } from "../math/rigid";
import type { Rig3 } from "../skeleton/skeleton";
import type { LocalPose } from "../retarget/retarget";

/** The whole-body transform the renderer puts on the fighter's group, in model space. */
export interface RootXform {
  /** Clip offsets in model units: +forward, +up. */
  readonly forward: number;
  readonly up: number;
  /** Clip squash: `scaleX` stretches forward, `scaleY` up. */
  readonly squashForward: number;
  readonly squashUp: number;
  /** The fighter's own size (`FighterParams.scale`, e.g. Fox 1.08). */
  readonly scale: number;
}

export const IDENTITY_ROOT: RootXform = { forward: 0, up: 0, squashForward: 1, squashUp: 1, scale: 1 };

export function rootMatrix(r: RootXform): number[] {
  return compose([0, r.up, r.forward], [0, 0, 0, 1], [r.scale, r.scale * r.squashUp, r.scale * r.squashForward]);
}

/** Every bone's world matrix (model space, root transform applied), parents first. */
export function worldMatrices(rig: Rig3, pose: LocalPose, root: RootXform): number[][] {
  const rootM = rootMatrix(root);
  const out: number[][] = new Array(rig.names.length);
  for (let i = 0; i < rig.names.length; i++) {
    const local = compose(pose.t[i], pose.q[i]);
    const p = rig.parent[i];
    out[i] = mMul(p < 0 ? rootM : out[p], local);
  }
  return out;
}

/**
 * Baked poses are stored at 1/256 unit (`BAKE_QUANTUM` Q12 units): an offset
 * 10 units out along a bone lands within 0.04 units, and a pose stored on that
 * grid is far smaller than full Q12 (the bake's size budget is Task 10's to
 * measure and state, not this file's).
 *
 * `+ 0` turns the `-0` that rounding a tiny negative gives into `0`, so a pose
 * compares equal to its decoded form under `Object.is`/`toBe`.
 */
const q = (v: number): number => Math.round((v * ONE) / BAKE_QUANTUM) * BAKE_QUANTUM + 0;

/** A world matrix projected onto the side plane, quantised to the bake's precision (Q12 values). */
export function sideBonePose(m: Mat4): BonePose {
  return {
    tx: q(m[14]),
    ty: q(m[13]),
    m00: q(m[2]),
    m01: q(m[6]),
    m02: q(m[10]),
    m10: q(m[1]),
    m11: q(m[5]),
    m12: q(m[9]),
  };
}
