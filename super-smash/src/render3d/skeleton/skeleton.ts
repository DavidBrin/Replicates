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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A fighter id names `src/render3d/skeletons/<fighterId>.json` and keys the
 * retarget lookup, so it must be a plain identifier: a letter, then letters,
 * digits and underscores (every id in `FIGHTER_IDS` is camelCase). This module
 * stays free of the fighter roster, which `scripts/models` also loads, so the
 * format is checked here and `skeleton.test.ts` checks the roster against it.
 */
const FIGHTER_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * How far a bind frame may miss rigid: axis lengths from 1 and axis dot products
 * from 0 (which together hold the determinant within 3e-4 of ±1; its sign is
 * checked on its own). The dump rounds every entry to five decimals (error at
 * most 5e-6), which moves a rigid frame's lengths and dot products by under
 * 2e-5, so 1e-4 passes a rounded rigid frame with margin and rejects any real
 * scale or shear.
 */
export const RIGID_TOLERANCE = 1e-4;

/** Why a bind matrix is not a rigid transform, or `null` if it is one. */
function notRigid(m: readonly number[]): string | null {
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return "has a bottom row other than 0 0 0 1";
  const axes: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const [i, axis] of axes.entries()) {
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    if (!(Math.abs(length - 1) <= RIGID_TOLERANCE)) return `is scaled: its ${"XYZ"[i]} axis has length ${length}`;
  }
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
    if (!(Math.abs(dot(axes[i], axes[j])) <= RIGID_TOLERANCE)) return `is sheared: its ${"XYZ"[i]} and ${"XYZ"[j]} axes are not perpendicular`;
  }
  const [x, y, z] = axes;
  const det = dot(x, [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]);
  if (!(det > 0)) return `is a mirror image (determinant ${det})`;
  return null;
}

/**
 * Validate a skeleton file and return a clean copy of it.
 *
 * Every reference is resolved to the bone's own spelling. Scripts name bones in
 * lower case ("kneer") and the files keep SSBU's case (`KneeR`), so `parent` and
 * a hurt capsule's `bone` may be written either way here; the copy that comes
 * back always spells them exactly as the bone is named, and everything after
 * this (`buildRig`, `trimSkeleton`, the bake) compares names exactly. Two bones
 * that differ only by case are refused as ambiguous.
 */
export function parseSkeletonFile(json: unknown): SkeletonFile {
  const o: Record<string, unknown> | null = isRecord(json) ? json : null;
  const fighter = typeof o?.fighter === "string" && o.fighter !== "" ? o.fighter : "?";
  if (o === null) fail(fighter, "not an object");
  if (typeof o.fighter !== "string" || !FIGHTER_ID.test(o.fighter)) {
    fail(fighter, `fighter ${JSON.stringify(o.fighter)} is not an identifier (letters, digits, underscores; starts with a letter)`);
  }
  if (o.schema !== SKELETON_SCHEMA) fail(fighter, `schema ${String(o.schema)}, expected ${SKELETON_SCHEMA}`);
  if (!Array.isArray(o.bones) || o.bones.length === 0) fail(fighter, "no bones");

  // Pass 1: names, and each bone's matrix. `canonical` maps lower case to the file's spelling.
  const canonical = new Map<string, string>();
  for (const b of o.bones as unknown[]) {
    if (!isRecord(b)) fail(fighter, "a bone is not an object");
    if (typeof b.name !== "string" || b.name.length === 0) fail(fighter, "a bone has no name");
    if (canonical.has(b.name.toLowerCase())) fail(fighter, `two bones are called "${b.name}" (case-insensitively)`);
    canonical.set(b.name.toLowerCase(), b.name);
    const world = b.world;
    if (!Array.isArray(world) || world.length !== 16) fail(fighter, `bone "${b.name}" has no 16-number world matrix`);
    for (let k = 0; k < 16; k++) {
      if (typeof world[k] !== "number" || !Number.isFinite(world[k])) fail(fighter, `bone "${b.name}" has no 16-number world matrix`);
    }
    const why = notRigid(world as number[]);
    if (why !== null) fail(fighter, `bone "${b.name}" world matrix ${why}`);
  }

  // Pass 2: parents, now that every name is known.
  const bones: SkeletonBone[] = (o.bones as Record<string, unknown>[]).map((b) => {
    const name = b.name as string;
    let parent: string | null = null;
    if (b.parent !== null) {
      if (typeof b.parent !== "string") fail(fighter, `bone "${name}" has no parent field (a bone name, or null for a root)`);
      const found = canonical.get(b.parent.toLowerCase());
      if (found === undefined) fail(fighter, `bone "${name}" names missing parent "${b.parent}"`);
      parent = found;
    }
    return { name, parent, world: [...(b.world as number[])] };
  });

  // A chain of parents that comes back to where it started never reaches a root.
  const parentOf = new Map(bones.map((b) => [b.name, b.parent]));
  for (const b of bones) {
    let at = parentOf.get(b.name) ?? null;
    for (let steps = 0; at !== null && steps < bones.length; steps++) {
      if (at === b.name) fail(fighter, `bone "${b.name}" is its own ancestor`);
      at = parentOf.get(at) ?? null;
    }
  }

  if (!Array.isArray(o.hurt)) fail(fighter, "no hurt list");
  const hurt: HurtCapsule[] = (o.hurt as unknown[]).map((h) => {
    if (!isRecord(h) || typeof h.bone !== "string") fail(fighter, "a hurt capsule has no bone name");
    const bone = canonical.get(h.bone.toLowerCase());
    if (bone === undefined) fail(fighter, `hurt capsule on missing bone "${h.bone}"`);
    const { x1, x2, r } = h;
    if (typeof x1 !== "number" || typeof x2 !== "number" || typeof r !== "number" || !Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(r) || !(r > 0)) {
      fail(fighter, `hurt capsule on "${bone}" is malformed`);
    }
    return { bone, x1, x2, r };
  });

  return { schema: SKELETON_SCHEMA, fighter: o.fighter, bones, hurt };
}

/**
 * Rebuild a bind frame from its X and Y axes (Gram-Schmidt), so the frames the
 * rig keeps are orthonormal to rounding error. The dump rounds to five decimals
 * and `parseSkeletonFile` accepts a frame within `RIGID_TOLERANCE` of rigid;
 * this removes that residue before anything inverts a frame as rigid. A parsed
 * frame has determinant +1, so the rebuilt one never flips handedness.
 */
function orthonormal(m: readonly number[]): number[] {
  const x = normalize([m[0], m[1], m[2]]);
  const y0: Vec3 = [m[4], m[5], m[6]];
  const z = normalize([x[1] * y0[2] - x[2] * y0[1], x[2] * y0[0] - x[0] * y0[2], x[0] * y0[1] - x[1] * y0[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [...x, 0, ...y, 0, ...z, 0, m[12], m[13], m[14], 1];
}

/**
 * Order parents before children, split each bind matrix into a local translation
 * and rotation. The file must have been through `parseSkeletonFile`: this
 * trusts its names, and only still refuses what it cannot walk (a missing
 * parent, a cycle).
 *
 * Every local is formed from the rig's own orthonormalised frames, so composing a
 * bone's local onto its parent's `restWorld` gives back that bone's `restWorld`
 * to rounding error, however the dump was rounded.
 */
export function buildRig(file: SkeletonFile): Rig3 {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const ordered: SkeletonBone[] = [];
  const placed = new Set<string>();
  const visit = (b: SkeletonBone, depth: number): void => {
    if (placed.has(b.name)) return;
    if (depth > file.bones.length) fail(file.fighter, `bone "${b.name}" is its own ancestor`);
    if (b.parent !== null) {
      const above = byName.get(b.parent);
      if (above === undefined) fail(file.fighter, `bone "${b.name}" names missing parent "${b.parent}"`);
      visit(above, depth + 1);
    }
    placed.add(b.name);
    ordered.push(b);
  };
  for (const b of file.bones) visit(b, 0);

  const index = new Map(ordered.map((b, i) => [b.name, i]));
  const parent = ordered.map((b) => (b.parent === null ? -1 : index.get(b.parent)!));
  const restWorld = ordered.map((b) => orthonormal(b.world));
  const restLocalT: Vec3[] = [];
  const restLocalQ: Quat[] = [];
  ordered.forEach((_, i) => {
    const local = parent[i] < 0 ? restWorld[i] : mMul(mInvertRigid(restWorld[parent[i]]), restWorld[i]);
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
 * order — so the trimmed skeleton poses exactly like the full one. The file is
 * expected to be parsed (names exact, parents present); `keep` gets lower-case
 * names.
 */
export function trimSkeleton(file: SkeletonFile, keep: (lowerName: string) => boolean): SkeletonFile {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const wanted = new Set<string>();
  for (const b of file.bones) {
    if (!keep(b.name.toLowerCase())) continue;
    // Stop at a bone already kept: its ancestors were kept with it, and a cycle in a file that skipped `parseSkeletonFile` ends here instead of looping.
    for (let at: SkeletonBone | undefined = b; at !== undefined && !wanted.has(at.name); at = at.parent === null ? undefined : byName.get(at.parent)) {
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
