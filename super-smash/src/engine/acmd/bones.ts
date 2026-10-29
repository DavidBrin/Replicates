/**
 * BoneTable — where a fighter's bones are, per motion and frame, as integers.
 *
 * A hitbox in a `game_` script hangs off a bone (`ATTACK(Bone=hash40("kneer"), X, Y, Z)`):
 * its centre is the bone's world transform applied to the offset. The sim may
 * not evaluate animation (it is float and non-deterministic across engines),
 * so Plan 4 bakes every bone's transform for every frame of every motion into
 * integer tables at build time, and the sim reads them through this interface.
 *
 * What a pose means:
 * - **Plane.** The bone's transform projected onto the sim's side plane: a 2×3
 *   matrix plus a translation, all Q12. A bone-local point (lx, ly, lz) lands at
 *
 *     x = (m00·lx + m01·ly + m02·lz) / ONE + tx
 *     y = (m10·lx + m11·ly + m12·lz) / ONE + ty
 *
 * - **Facing.** Facing-relative: +x is the way the fighter faces, +y is up,
 *   the origin is the fighter's feet (`FighterState.x/y`). A pose never depends
 *   on facing; the sim mirrors x by `facing` afterwards, as it does for every
 *   `Hitbox` (`hitboxWorldPos`).
 * - **Scale.** World units at the fighter's in-game size: the bake folds the
 *   model's own scale and `FighterParams.scale` into the matrix and the
 *   translation, so a script offset is scaled exactly as the bone carries it.
 *   A hitbox's `size` is a radius and is not transformed by the pose.
 *
 * Until Plan 4 the only bone the sim uses is `top`, the root, whose forward
 * axis is the script's Z (DECISIONS D17), so `LEGACY_BONE_TABLE` answers for
 * `top` alone and every hitbox keeps exactly the position it has today.
 *
 * The table reaches the sim through `SimContext.bones` (Task 15), never a
 * module global, and its `fingerprint` is what two online peers compare before
 * a match (Task 27): a different bake is a different game.
 */

import { ONE } from "../fixed";
import { FNV_OFFSET, mixInt, mixString } from "../hash";
import type { BoneName, MotionKind } from "./types";

/** One bone's pose; `BoneTable.pose` writes into one, so it is mutable on purpose. */
export interface BonePose {
  tx: number;
  ty: number;
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface BoneTable {
  /**
   * A stable hash of everything the table can answer: FNV-1a over its
   * contents, as 8 lowercase hex digits. Equal tables have equal fingerprints.
   */
  readonly fingerprint: string;
  /**
   * Write the pose of `bone` on motion frame `frame` (1-based, integer — the
   * interpreter's floored `motionFrame`) of `motion`, for `fighterId`, into
   * `out` and return true. A true return must write all eight fields of `out`:
   * a caller reuses one `BonePose`, so a field left unwritten is a stale value
   * from the last lookup. Frames outside the motion clamp to its first or
   * last. Return false, leaving `out` untouched, when the table does not know
   * that fighter, motion or bone. Allocates nothing.
   */
  pose(fighterId: string, motion: MotionKind, frame: number, bone: BoneName, out: BonePose): boolean;
}

/** A pose to write into. */
export function newBonePose(): BonePose {
  return { tx: 0, ty: 0, m00: 0, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 };
}

/** Int32s per pose, in the order tx, ty, m00, m01, m02, m10, m11, m12. */
export const BONE_POSE_STRIDE = 8;

/** One motion's bake: `frames × bones.length × BONE_POSE_STRIDE` Int32s, frame-major. */
export interface BakedMotion {
  readonly frames: number;
  readonly data: Int32Array;
}

/** What Plan 4's bake produces per fighter. */
export interface BakedFighterBones {
  readonly fighter: string;
  readonly bones: readonly BoneName[];
  readonly motions: Readonly<Record<MotionKind, BakedMotion>>;
}

/** Index of a pose's first Int32 in `BakedMotion.data`. */
export function bakedPoseIndex(frame: number, boneIndex: number, boneCount: number): number {
  return ((frame - 1) * boneCount + boneIndex) * BONE_POSE_STRIDE;
}

function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The fingerprint of a bake: every fighter, bone name, motion and Int32, in a fixed order. */
function bakeFingerprint(fighters: readonly BakedFighterBones[]): string {
  let h = FNV_OFFSET;
  for (const f of [...fighters].sort((a, b) => (a.fighter < b.fighter ? -1 : a.fighter > b.fighter ? 1 : 0))) {
    h = mixString(h, f.fighter);
    h = mixInt(h, f.bones.length);
    for (const b of f.bones) h = mixString(h, b);
    const names = Object.keys(f.motions).sort();
    h = mixInt(h, names.length);
    for (const name of names) {
      const m = f.motions[name];
      h = mixString(h, name);
      h = mixInt(h, m.frames);
      h = mixInt(h, m.data.length);
      for (let i = 0; i < m.data.length; i++) h = mixInt(h, m.data[i]);
    }
  }
  return hex(h);
}

/**
 * Refuse a bake that cannot be indexed, once, where it is built: a short or
 * oddly-sized `data` would otherwise answer `pose()` with `undefined` writes,
 * `bonePoint` would return NaN and the hitbox would silently never connect.
 */
function assertWellFormed(f: BakedFighterBones): void {
  if (f.bones.length === 0) throw new Error(`bone bake for "${f.fighter}": no bones`);
  if (new Set(f.bones).size !== f.bones.length) {
    throw new Error(`bone bake for "${f.fighter}": a bone is listed twice`);
  }
  for (const [name, m] of Object.entries(f.motions)) {
    if (!Number.isInteger(m.frames) || m.frames < 1) {
      throw new Error(`bone bake for "${f.fighter}/${name}": frames must be a whole number of at least 1, got ${m.frames}`);
    }
    const want = m.frames * f.bones.length * BONE_POSE_STRIDE;
    if (m.data.length !== want) {
      throw new Error(
        `bone bake for "${f.fighter}/${name}": ${m.frames} frames × ${f.bones.length} bones × ${BONE_POSE_STRIDE} needs ${want} Int32s, got ${m.data.length}`,
      );
    }
  }
}

/**
 * A `BoneTable` over Plan 4's baked data. Throws on a malformed bake (see
 * `assertWellFormed`) or a fighter listed twice.
 */
export function bakedBoneTable(fighters: readonly BakedFighterBones[]): BoneTable {
  const byId = new Map<string, { f: BakedFighterBones; index: Map<BoneName, number>; motions: Map<string, BakedMotion> }>();
  for (const f of fighters) {
    if (byId.has(f.fighter)) throw new Error(`bone bake: fighter "${f.fighter}" is listed twice`);
    assertWellFormed(f);
    byId.set(f.fighter, {
      f,
      index: new Map(f.bones.map((b, i) => [b, i])),
      motions: new Map(Object.entries(f.motions)),
    });
  }
  return {
    fingerprint: bakeFingerprint(fighters),
    pose(fighterId, motion, frame, bone, out) {
      const entry = byId.get(fighterId);
      if (entry === undefined) return false;
      const m = entry.motions.get(motion);
      const b = entry.index.get(bone);
      if (m === undefined || b === undefined) return false;
      const fr = frame < 1 ? 1 : frame > m.frames ? m.frames : frame;
      const i = bakedPoseIndex(fr, b, entry.f.bones.length);
      const d = m.data;
      out.tx = d[i];
      out.ty = d[i + 1];
      out.m00 = d[i + 2];
      out.m01 = d[i + 3];
      out.m02 = d[i + 4];
      out.m10 = d[i + 5];
      out.m11 = d[i + 6];
      out.m12 = d[i + 7];
      return true;
    },
  };
}

/** The root bone: script Z is forward, script Y is up, script X is depth (dropped). */
export const TOP_POSE: Readonly<BonePose> = { tx: 0, ty: 0, m00: 0, m01: 0, m02: ONE, m10: 0, m11: ONE, m12: 0 };

/** The label and the eight pose Int32s, so a changed `TOP_POSE` is a changed table. */
function legacyFingerprint(): string {
  let h = mixString(FNV_OFFSET, "legacy:top");
  for (const v of [TOP_POSE.tx, TOP_POSE.ty, TOP_POSE.m00, TOP_POSE.m01, TOP_POSE.m02, TOP_POSE.m10, TOP_POSE.m11, TOP_POSE.m12]) {
    h = mixInt(h, v);
  }
  return hex(h);
}

/** Plan 2's provider: the root bone only, identical on every frame of every motion. */
export const LEGACY_BONE_TABLE: BoneTable = {
  fingerprint: legacyFingerprint(),
  pose(_fighterId, _motion, _frame, bone, out) {
    if (bone !== "top") return false;
    Object.assign(out, TOP_POSE);
    return true;
  },
};

/**
 * A table that asks `primary` first and `fallback` second — so Plan 4 can
 * supply a bake for some fighters and keep the root bone for the rest.
 */
export function layeredBoneTable(primary: BoneTable, fallback: BoneTable): BoneTable {
  return {
    fingerprint: hex(mixString(mixString(FNV_OFFSET, primary.fingerprint), fallback.fingerprint)),
    pose(fighterId, motion, frame, bone, out) {
      return primary.pose(fighterId, motion, frame, bone, out) || fallback.pose(fighterId, motion, frame, bone, out);
    },
  };
}

/** A bone-local point, in the fighter's facing-relative frame. */
export function bonePoint(p: Readonly<BonePose>, lx: number, ly: number, lz: number): { x: number; y: number } {
  return {
    x: Math.trunc((p.m00 * lx + p.m01 * ly + p.m02 * lz) / ONE) + p.tx,
    y: Math.trunc((p.m10 * lx + p.m11 * ly + p.m12 * lz) / ONE) + p.ty,
  };
}
