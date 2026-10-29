/**
 * Which bones carry each fighter's hurt capsules, and which of them is the
 * head (Plan 4). One table, read by both sides: `skeleton_from_blend.py` fits
 * a capsule per listed bone from the vertices weighted to it, and the overlay
 * anchors port tags and dizzy stars above the head capsule.
 */

import table from "./hurtBones.json";

export interface HurtBones {
  /** The bone whose capsule is the fighter's head (Kirby's is his whole body). */
  readonly head: string;
  readonly bones: readonly string[];
}

const TABLE = table as unknown as Readonly<Record<string, HurtBones>>;

export function hurtBonesFor(fighterId: string): HurtBones {
  return TABLE[fighterId] ?? TABLE.default;
}
