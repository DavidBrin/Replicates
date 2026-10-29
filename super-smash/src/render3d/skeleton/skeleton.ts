/**
 * A fighter's SSBU skeleton, as the bake and the renderer read it.
 *
 * The numbers come from the Blender spike (`scripts/models/export_gltf.py`):
 * every bone's bind-pose world matrix in **SSBU model space** — +Y up, +Z the
 * fighter's forward, +X the fighter's left, one unit = one simulation unit —
 * column-major. `scripts/models/skeleton.mjs` trims that dump to the bones the
 * sim and the retargeter use (and their ancestors) and commits it as
 * `src/render3d/skeletons/<fighterId>.json`: derived numbers, never a mesh or a
 * texture (spec §3.1).
 *
 * `parseSkeletonFile` refuses anything that is not that shape, loudly, because a
 * skeleton that is quietly wrong produces hitboxes that are quietly wrong.
 */

import { mInvertRigid, mMul, mRotation, mTranslation, normalize, type Mat4, type Quat, type Vec3 } from "../math/rigid";

export const SKELETON_SCHEMA = 1;

export interface SkeletonBone {
  readonly name: string;
  readonly parent: string | null;
  /** Bind-pose world matrix, SSBU model space, column-major. */
  readonly world: readonly number[];
}

/** A hurtbox capsule along a bone's local +X, bone-local units. UNVERIFIED: derived from mesh weights. */
export interface HurtCapsule {
  readonly bone: string;
  readonly x1: number;
  readonly x2: number;
  readonly r: number;
}

export interface SkeletonFile {
  readonly schema: typeof SKELETON_SCHEMA;
  readonly fighter: string;
  readonly bones: readonly SkeletonBone[];
  readonly hurt: readonly HurtCapsule[];
}

/** A skeleton ready to pose: parents before children, rest transforms split. */
export interface Rig3 {
  readonly fighter: string;
  readonly names: readonly string[];
  /** Parent index, −1 for a root. Always less than the bone's own index. */
  readonly parent: readonly number[];
  readonly restWorld: readonly Mat4[];
  readonly restLocalT: readonly Vec3[];
  readonly restLocalQ: readonly Quat[];
  /** Lower-case name → index (scripts spell bones in lower case: "kneer"). */
  readonly byLower: ReadonlyMap<string, number>;
  readonly hurt: readonly HurtCapsule[];
}

function fail(fighter: string, why: string): never {
  throw new Error(`skeleton ${fighter}: ${why}`);
}

export function parseSkeletonFile(json: unknown): SkeletonFile {
  const o = json as Partial<SkeletonFile> | null;
  const fighter = typeof o?.fighter === "string" ? o.fighter : "?";
  if (o === null || typeof o !== "object") fail(fighter, "not an object");
  if (o.schema !== SKELETON_SCHEMA) fail(fighter, `schema ${String(o.schema)}, expected ${SKELETON_SCHEMA}`);
  if (!Array.isArray(o.bones) || o.bones.length === 0) fail(fighter, "no bones");
  const seen = new Set<string>();
  for (const b of o.bones) {
    if (typeof b.name !== "string" || b.name.length === 0) fail(fighter, "a bone has no name");
    if (seen.has(b.name.toLowerCase())) fail(fighter, `two bones are called "${b.name}" (case-insensitively)`);
    seen.add(b.name.toLowerCase());
    if (!Array.isArray(b.world) || b.world.length !== 16 || b.world.some((v: number) => !Number.isFinite(v))) {
      fail(fighter, `bone "${b.name}" has no 16-number world matrix`);
    }
  }
  for (const b of o.bones) {
    if (b.parent !== null && !seen.has(b.parent.toLowerCase())) fail(fighter, `bone "${b.name}" names missing parent "${b.parent}"`);
  }
  if (!Array.isArray(o.hurt)) fail(fighter, "no hurt list");
  for (const h of o.hurt) {
    if (!seen.has(h.bone.toLowerCase())) fail(fighter, `hurt capsule on missing bone "${h.bone}"`);
    if (!(h.r > 0) || !Number.isFinite(h.x1) || !Number.isFinite(h.x2)) fail(fighter, `hurt capsule on "${h.bone}" is malformed`);
  }
  return o as SkeletonFile;
}

/**
 * The dump rounds to five decimals, which leaves a bind rotation a hair off
 * orthonormal; inverting it as rigid would then leak ~1e-4 into every local
 * transform. Rebuild the frame from its X and Y axes (Gram–Schmidt) first.
 */
function orthonormal(m: readonly number[]): number[] {
  const x = normalize([m[0], m[1], m[2]]);
  const y0: Vec3 = [m[4], m[5], m[6]];
  const z = normalize([x[1] * y0[2] - x[2] * y0[1], x[2] * y0[0] - x[0] * y0[2], x[0] * y0[1] - x[1] * y0[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [...x, 0, ...y, 0, ...z, 0, m[12], m[13], m[14], 1];
}

/** Order parents before children, split each bind matrix into a local translation and rotation. */
export function buildRig(file: SkeletonFile): Rig3 {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const ordered: SkeletonBone[] = [];
  const placed = new Set<string>();
  const visit = (b: SkeletonBone, depth: number): void => {
    if (placed.has(b.name)) return;
    if (depth > file.bones.length) fail(file.fighter, `bone "${b.name}" is its own ancestor`);
    if (b.parent !== null) visit(byName.get(b.parent)!, depth + 1);
    placed.add(b.name);
    ordered.push(b);
  };
  for (const b of file.bones) visit(b, 0);

  const index = new Map(ordered.map((b, i) => [b.name, i]));
  const parent = ordered.map((b) => (b.parent === null ? -1 : index.get(b.parent)!));
  const restWorld = ordered.map((b) => orthonormal(b.world));
  const restLocalT: Vec3[] = [];
  const restLocalQ: Quat[] = [];
  ordered.forEach((b, i) => {
    const local = parent[i] < 0 ? b.world : mMul(mInvertRigid(restWorld[parent[i]]), b.world);
    restLocalT.push(mTranslation(local));
    restLocalQ.push(mRotation(local));
  });
  return {
    fighter: file.fighter,
    names: ordered.map((b) => b.name),
    parent,
    restWorld,
    restLocalT,
    restLocalQ,
    byLower: new Map(ordered.map((b, i) => [b.name.toLowerCase(), i])),
    hurt: file.hurt,
  };
}

/**
 * Keep the bones `keep` asks for and every ancestor of them, in their original
 * order — so the trimmed skeleton poses exactly like the full one.
 */
export function trimSkeleton(file: SkeletonFile, keep: (lowerName: string) => boolean): SkeletonFile {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const wanted = new Set<string>();
  for (const b of file.bones) {
    if (!keep(b.name.toLowerCase())) continue;
    for (let at: SkeletonBone | undefined = b; at !== undefined; at = at.parent === null ? undefined : byName.get(at.parent)) {
      wanted.add(at.name);
    }
  }
  return {
    schema: SKELETON_SCHEMA,
    fighter: file.fighter,
    bones: file.bones.filter((b) => wanted.has(b.name)),
    hurt: file.hurt.filter((h) => wanted.has(h.bone)),
  };
}
