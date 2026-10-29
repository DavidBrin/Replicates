/**
 * The bone dump's schema, written by `scripts/models/skeleton_from_blend.py`
 * (no Blender) and by `scripts/models/export_gltf.py` (Blender), and checked
 * here so a bad file fails before it reaches a skeleton or the bake.
 *
 * `.model-cache/dumps/<fighterId>.json` (Blender, Task 8) and
 * `.model-cache/dumps/<fighterId>.sdna.json` (`skeleton_from_blend.py`, no
 * Blender, Task 6 — the one the committed skeletons are trimmed from), schema 1:
 *
 * ```json
 * {
 *   "schema": 1, "fighter": "mario", "code": "mario", "blender": "5.2.2",
 *   "blend": "mario-c00.blend",
 *   "space": "ssbu-model",                 // +Y up, +Z the fighter's forward, +X their left
 *   "bones": [{ "name": "Trans", "parent": null, "world": [16 numbers, column-major] }, …],
 *   "meshes": [{ "name": "Mario_FaceN_VIS_O_OBJShape", "kept": true, "verts": 209, "polys": 302 }, …],
 *   "materials": [{ "name": "skin_mario_001", "image": "skin_mario_001_col.png" }, …],
 *   "hurt": [{ "bone": "Head", "x1": 0.4, "x2": 2.6, "r": 2.1 }, …]
 * }
 * ```
 *
 * Verified on all eight real .blend files (Plan 4 Task 6): limb bones' local +X
 * runs along the limb; the armature object is the importer's +90° X turn, so
 * `C · matrix_world · matrix_local` with C the Z-up→Y-up turn is the bone's
 * SSBU bind matrix; toes at +Z (forward). Mario: 98 bones from `Trans`, the hat
 * at y = 13.18.
 */

import { SKELETON_SCHEMA, parseSkeletonFile, trimSkeleton, type SkeletonFile } from "../skeleton/skeleton";

export const DUMP_SCHEMA = 1;

/**
 * How far a raw dump's bind frame may miss rigid. The committed skeletons use
 * `RIGID_TOLERANCE` (2e-3), but a dump holds every bone in the .blend, including
 * helper bones that SSBU authors with a little scale. Measured on the eight files
 * (Plan 4 Task 6): Mario's `H_LegL` X axis is 4.28e-3 long and his `H_LegR` 5.3e-4
 * short; Pikachu's `H_LegL`/`H_LegL2` are 7.0e-4 long. That residue is in SSBU's
 * stored bind matrices, not reader error.
 *
 * `skeletonFromDump` trims all of those bones, and a committed skeleton is held to
 * `RIGID_TOLERANCE` again when it is read. 5e-3 admits the measured maximum with
 * 0.7e-3 to spare. A mirror, or a bottom row other than 0 0 0 1, is refused here
 * as everywhere.
 */
export const RIGID_TOLERANCE_DUMP = 5e-3;

export interface DumpMesh {
  readonly name: string;
  /** Listed under `keep` in `scripts/models/meshes.json` (and parented to the armature). */
  readonly kept: boolean;
  readonly verts: number;
  readonly polys: number;
}

export interface BoneDump extends SkeletonFile {
  readonly code: string;
  readonly blender: string;
  readonly blend: string;
  readonly space: "ssbu-model";
  readonly meshes: readonly DumpMesh[];
  readonly materials: readonly { readonly name: string; readonly image: string }[];
}

function fail(fighter: string, why: string): never {
  throw new Error(`bone dump ${fighter}: ${why}`);
}

/**
 * Validate a dump, loudly. Besides the shape (bind frames rigid within
 * `RIGID_TOLERANCE_DUMP`), checks the two facts every later step leans on: up
 * is +Y (the head is above the hips) and forward is +Z (the toes are in front
 * of the ankles) — a dump in Blender's Z-up space, or a mirrored one, fails here
 * rather than as hitboxes behind the fighter.
 */
export function parseBoneDump(json: unknown): BoneDump {
  const d = json as Partial<BoneDump> | null;
  const fighter = typeof d?.fighter === "string" ? d.fighter : "?";
  if (d === null || typeof d !== "object") fail(fighter, "not an object");
  if (d.schema !== DUMP_SCHEMA) fail(fighter, `schema ${String(d.schema)}, expected ${DUMP_SCHEMA}`);
  if (d.space !== "ssbu-model") fail(fighter, `space "${String(d.space)}", expected "ssbu-model"`);
  parseSkeletonFile({ schema: SKELETON_SCHEMA, fighter, bones: d.bones, hurt: d.hurt }, { rigidTolerance: RIGID_TOLERANCE_DUMP });
  const at = (name: string) => {
    const b = d.bones!.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return b === undefined ? null : [b.world[12], b.world[13], b.world[14]];
  };
  const head = at("Head");
  const hip = at("Hip");
  if (head === null || hip === null) fail(fighter, "no Head or Hip bone");
  if (!(head[1] > hip[1] && hip[1] > 0)) fail(fighter, `up is not +Y (Head y ${head[1]}, Hip y ${hip[1]})`);
  for (const side of ["L", "R"]) {
    const foot = at(`Foot${side}`);
    const toe = at(`Toe${side}`);
    if (foot !== null && toe !== null && !(toe[2] > foot[2])) fail(fighter, `forward is not +Z (Toe${side} z ${toe[2]} ≤ Foot${side} z ${foot[2]})`);
  }
  if (!Array.isArray(d.meshes) || !d.meshes.some((m) => m.kept)) fail(fighter, "no mesh kept");
  if (!Array.isArray(d.materials) || d.materials.length === 0) fail(fighter, "no materials");
  if (d.hurt!.length < 7) fail(fighter, `only ${d.hurt!.length} hurt capsules`);
  return d as BoneDump;
}

/** The committed skeleton: the bones `needed` names (lower case) and their ancestors, plus the hurt capsules. */
export function skeletonFromDump(dump: BoneDump, needed: ReadonlySet<string>): SkeletonFile {
  const trimmed = trimSkeleton({ schema: SKELETON_SCHEMA, fighter: dump.fighter, bones: dump.bones, hurt: dump.hurt }, (n) => needed.has(n));
  const round = (v: number) => Math.round(v * 1e5) / 1e5 + 0;
  return {
    ...trimmed,
    bones: trimmed.bones.map((b) => ({ name: b.name, parent: b.parent, world: b.world.map(round) })),
    hurt: trimmed.hurt.map((h) => ({ bone: h.bone, x1: round(h.x1), x2: round(h.x2), r: round(h.r) })),
  };
}
