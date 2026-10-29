/**
 * Which of a skeleton's bones our clips put somewhere on purpose (Plan 4,
 * Task 13 fix round 1), and so which bones a script's hitbox may hang off once
 * the bake places it.
 *
 * The bake moves a bone only through the 2D clip: `RETARGET` turns the bones it
 * drives, everything else keeps its bind pose relative to its parent and rides
 * along (`map.ts`). So a bone below a driven bone (a sword on the hand, a toe on
 * the foot) goes where the clip's limb goes, and the root goes where the
 * fighter goes. A bone whose nearest driven-or-root ancestor is the root, but
 * which is not the root itself, is one Ultimate animates on its own and our
 * clips never do: Samus's grapple claw (`throw`, on `rot`) sits at her feet on
 * every frame. A box on such a bone would be placed somewhere no animation put
 * it, so it is not placeable.
 */

import { BONE_NAMES } from "@/render/skeleton";
import type { SkeletonFile } from "../skeleton/skeleton";
import { driveFor } from "./map";

/** The script's root bone, which `LEGACY_BONE_TABLE` places, whatever the skeleton calls its root. */
const SCRIPT_ROOT = "top";

/**
 * How the bake places a bone (names in lower case, as scripts spell them):
 * - `root`: the script's `top`, or the skeleton's root (`trans`);
 * - `driven`: turned by a clip through `RETARGET`;
 * - `rides`: kept rigid under the nearest driven ancestor, named;
 * - `unanimated`: under the root with no driven bone between, never moved by a clip;
 * - `missing`: not in the skeleton.
 */
export type BoneRole =
  | { readonly kind: "root" | "driven" | "unanimated" | "missing" }
  | { readonly kind: "rides"; readonly on: string };

/** The bones the fighter's drives (`driveFor`) turn, lower case. */
export function drivenBones(fighterId: string): Set<string> {
  return new Set(BONE_NAMES.flatMap((n) => driveFor(fighterId, n)?.bones.map((b) => b.toLowerCase()) ?? []));
}

export function boneRole(skeleton: SkeletonFile, bone: string): BoneRole {
  if (bone === SCRIPT_ROOT) return { kind: "root" };
  const byLower = new Map(skeleton.bones.map((b) => [b.name.toLowerCase(), b]));
  const driven = drivenBones(skeleton.fighter);
  let b = byLower.get(bone);
  if (b === undefined) return { kind: "missing" };
  if (b.parent === null) return { kind: "root" };
  if (driven.has(bone)) return { kind: "driven" };
  while (b.parent !== null) {
    const parent = b.parent.toLowerCase();
    if (driven.has(parent)) return { kind: "rides", on: parent };
    b = byLower.get(parent);
    if (b === undefined) return { kind: "missing" };
  }
  return { kind: "unanimated" };
}

/** A box on `bone` goes where our clip (or the fighter) puts it: the root, a driven bone, or one riding a driven bone. */
export function placeableBone(skeleton: SkeletonFile, bone: string): boolean {
  const role = boneRole(skeleton, bone).kind;
  return role === "root" || role === "driven" || role === "rides";
}
