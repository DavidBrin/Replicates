/**
 * The pose the renderer draws for a fighter this frame — through the same
 * clock, samplers, retargeter and root transform the bake used, so the limb on
 * screen is the limb the sim's hitboxes and hurtboxes hang off (Plan 4).
 *
 * One deliberate difference, inherited from DECISIONS D42: a change of clip
 * fades over `BLEND_FRAMES` (`blend.ts`) except into an attack or an imposed
 * state. The sim has no fade, so during those four frames a hurtbox can lead the
 * drawn body slightly; hitboxes never can, because attacks never fade.
 *
 * Nothing here knows a fighter by name: every fighter's pose, a sword arm's
 * included, is read off its clips and its skeleton the way the bake read it.
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { poseIndexOf, type PoseIndex } from "@/engine/acmd/poseClock";
import type { MotionKind } from "@/engine/acmd/types";
import type { FighterDef, FighterState } from "@/engine/types";
import { blendedPose, clipFrameFor, type PoseBlend } from "@/render/blend";
import { REST_SAMPLE } from "@/render/characterArt";
import type { PoseSample } from "@/render/poses/clip";
import { poseNameFor } from "@/render/poses/timing";
import { motionSamplers, rootXformInto, rootXformOf, sampleAt, type FighterPoser, type MotionSampler, type RootXformOut } from "./bake/bake";
import { IDENTITY_ROOT, type RootXform } from "./bake/fk";
import { newPoseBuffer, retarget, retargetInto, type LocalPose, type PoseBuffer } from "./retarget/retarget";

export interface DrawnPose {
  readonly index: PoseIndex | null;
  readonly sample: PoseSample;
  readonly local: LocalPose;
  readonly root: RootXform;
}

/** The pose `drawnPose` writes into and returns: one per fighter, refilled every frame. */
export interface DrawnPoseBuffer extends DrawnPose {
  index: PoseIndex | null;
  sample: PoseSample;
  readonly local: PoseBuffer;
  readonly root: RootXformOut;
}

export interface FighterPoseInputs {
  readonly poser: FighterPoser;
  readonly samplers: ReadonlyMap<MotionKind, MotionSampler>;
  readonly def: FighterDef;
  readonly bake: BakeTables;
  /**
   * `drawnPose`'s output, reused frame after frame: the drawn pose is written
   * here, not made anew. The clip sample it is drawn from still is, each frame
   * (`fighter3d.ts` lists what an update allocates).
   */
  readonly drawn: DrawnPoseBuffer;
}

export function poseInputs(poser: FighterPoser, def: FighterDef, bake: BakeTables): FighterPoseInputs {
  return {
    poser,
    def,
    bake,
    samplers: motionSamplers(def),
    drawn: { index: null, sample: REST_SAMPLE, local: newPoseBuffer(poser.rig3), root: { ...IDENTITY_ROOT } },
  };
}

/**
 * The clip sample a baked (motion, frame) plays, its spin folded into its
 * rotation exactly as the bake adds it (`poseWorld`), so a blend fades the
 * turned body and not the unturned one. A new sample, like the one it copies:
 * `blendedPose` keeps the last one drawn to fade from.
 */
function sampleOf(p: FighterPoseInputs, index: PoseIndex): PoseSample {
  const sampler = p.samplers.get(index.motion);
  if (sampler === undefined) return REST_SAMPLE;
  const { sample, spin } = sampleAt(sampler, index.frame);
  return { ...sample, rotation: sample.rotation + spin };
}

/** The unblended pose on a baked (motion, frame) — exactly what the bake stored. A fresh pose, for tests and tools. */
export function bakedPoseAt(p: FighterPoseInputs, index: PoseIndex): DrawnPose {
  const sample = sampleOf(p, index);
  return {
    index,
    sample,
    local: retarget(p.poser.cal, p.poser.rig2d, sample.angles, sample.rotation),
    root: rootXformOf(p.poser, sample),
  };
}

/**
 * The pose a match draws for `f` on sim frame `frame`, faded per D42. Returns
 * the inputs' own `drawn`, overwritten by the next call: read it, don't keep it.
 */
export function drawnPose(p: FighterPoseInputs, f: FighterState, frame: number, blends: PoseBlend[] | null): DrawnPose {
  const name = poseNameFor(f);
  // Registers a change of clip so `blendedPose` fades it (D42), but its frame
  // is not used: the 2D renderer restarts a clip the action did not restart
  // (fast-falling twenty frames into a fall), while the sim's hurtboxes stay on
  // the action's clock. In 3D the limbs are the hurtboxes, so they follow the
  // sim's clock — the dive is entered where the sim has it, not at its frame 0.
  if (blends) clipFrameFor(blends, f, name, frame);
  const index = poseIndexOf(p.def, f, frame, p.bake.clock);
  const sample = index === null ? REST_SAMPLE : sampleOf(p, index);
  const shown = blends ? blendedPose(blends, f, name, sample, frame) : sample;
  const out = p.drawn;
  out.index = index;
  out.sample = shown;
  retargetInto(p.poser.cal, p.poser.rig2d, shown.angles, shown.rotation, out.local);
  rootXformInto(p.poser, shown, out.root);
  return out;
}
