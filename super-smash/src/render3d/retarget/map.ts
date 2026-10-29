/**
 * Which SSBU bones each of the replica's sixteen 2D bones drives.
 *
 * The 2D rig (`render/skeleton.ts`) is a chain of angles in the screen plane;
 * an SSBU skeleton is ~100 bones in 3D. Only the bones a pose clip names are
 * driven: each listed SSBU bone is turned so that its **along-axis** — the
 * vector from the bone to `tip` (or its local +X when there is no tip) — points
 * where the 2D bone points, in the side (sagittal) plane. Every other bone keeps
 * its bind pose relative to its parent and rides along.
 *
 * Bone names are SSBU's, as the importer writes them into the .blend
 * (verified on the Mario dump: `Hip`, `Waist`, `Bust`, `Neck`, `Head`,
 * `ClavicleL`, `ShoulderL`, `ArmL`, `HandL`, `HaveL`, `LegL`, `KneeL`, `FootL`,
 * `ToeL`; ACMD scripts spell the same bones in lower case: `kneer`, `arml`).
 * `ShoulderL` is the upper arm, `ArmL` the forearm, `LegL` the thigh and
 * `KneeL` the shin: SSBU names a limb segment after the joint it starts at.
 *
 * `rest` is how the 2D rest pose meets the SSBU bind pose:
 * - "bind": the 2D bone's rest angle reproduces the SSBU bind direction (in the
 *   side plane), and a clip turns the bone by its angle *relative to rest*. Used
 *   for the spine, head, legs and feet, whose bind directions already lie in the
 *   side plane — so a fighter at rest stands exactly in SSBU's own stance, feet
 *   flat and spine at its own tilt. (A "down" foot was tried on the real Mario
 *   dump first: the 2D foot's horizontal rest lifted his toes 0.7 units.)
 * - "down": the bone is first laid straight down, then turned to the 2D
 *   angle. Used for the arms, whose T-pose bind direction is sideways and has no
 *   side-plane angle to keep.
 */

import type { BoneName } from "@/render/skeleton";

export interface Drive {
  /** SSBU bones turned together to this 2D bone's direction; every present one is driven. */
  readonly bones: readonly string[];
  /** Child bone defining the along-axis; absent means local +X. Must share the order of `bones`. */
  readonly tips?: readonly (string | null)[];
  readonly rest: "bind" | "down";
  /** True when a skeleton may lack every listed bone (the drive is skipped). */
  readonly optional?: boolean;
}

export const RETARGET: Readonly<Partial<Record<BoneName, Drive>>> = {
  hip: { bones: ["Hip"], rest: "bind" },
  torso: { bones: ["Waist", "Bust"], rest: "bind" },
  head: { bones: ["Neck", "Head"], rest: "bind" },
  thighL: { bones: ["LegL"], tips: ["KneeL"], rest: "bind" },
  shinL: { bones: ["KneeL"], tips: ["FootL"], rest: "bind" },
  footL: { bones: ["FootL"], tips: ["ToeL"], rest: "bind" },
  thighR: { bones: ["LegR"], tips: ["KneeR"], rest: "bind" },
  shinR: { bones: ["KneeR"], tips: ["FootR"], rest: "bind" },
  footR: { bones: ["FootR"], tips: ["ToeR"], rest: "bind" },
  upperArmL: { bones: ["ShoulderL"], tips: ["ArmL"], rest: "down" },
  forearmL: { bones: ["ArmL"], tips: ["HandL"], rest: "down" },
  handL: { bones: ["HandL"], tips: ["HaveL"], rest: "down" },
  upperArmR: { bones: ["ShoulderR"], tips: ["ArmR"], rest: "down" },
  forearmR: { bones: ["ArmR"], tips: ["HandR"], rest: "down" },
  handR: { bones: ["HandR"], tips: ["HaveR"], rest: "down" },
};

/**
 * Per-fighter replacements for `RETARGET` entries, for skeletons that do not
 * follow the humanoid naming. Empty until the spike's dumps say otherwise:
 * `retarget.test.ts` runs every committed skeleton through `calibrate`, which
 * names the missing bone, so an entry here is added only against that failure.
 */
export const RETARGET_OVERRIDES: Readonly<Record<string, Readonly<Partial<Record<BoneName, Drive>>>>> = {};

/** The bone whose bind height is the whole-body rotation pivot (the 2D rig pivots at the pelvis). */
export const PIVOT_BONE = "Hip";
