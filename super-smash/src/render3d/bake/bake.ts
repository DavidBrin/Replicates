/**
 * The bone bake: every motion the sim can be in, every frame, every bone the sim
 * reads, as Q12 integers (spec §3.1, research R§2 "root-cause fix").
 *
 * For each fighter:
 * - each move slot plays its active `game_` script's motion for as many motion
 *   frames as the move lasts; the clip is the slot's (`SLOT_POSE`, with the
 *   fighter's own override), timed so its strike key lands on the script's
 *   first active motion frame (`attackClipTime`, DECISIONS D34);
 * - each status plays `status_<action>` on the clock `statusClock` picks, at
 *   the fighter's own length (`statusDuration` with the fighter's def). The
 *   dodges are a motion per direction (ruling R4) and play their clips on the
 *   2D renderer's own re-timed clip time (`dodgeTiming`), not linearly;
 * - each frame's 2D pose sample is retargeted onto the fighter's SSBU skeleton
 *   (`retarget.ts`), run through forward kinematics (`fk.ts`) and projected onto
 *   the side plane.
 *
 * The renderer evaluates exactly the same functions for the frame it draws
 * (`render3d/fighterPose.ts`), so a hitbox hangs off the limb the player sees.
 * Float maths happens here, at build time; the sim only ever reads the integers.
 *
 * Inputs: the committed skeletons (`src/render3d/skeletons/`), the clips, and
 * the fighters' moves and scripts. Nothing here reads the model cache.
 *
 * One known difference from the 2D renderer, accepted (DISPATCH-NOTES 10.6): a
 * charging smash parks 2D's clip at 0.55 of its strike (`poseTimeFor`); the bake
 * has no such state, so a held charge shows the pose of the motion frame the
 * hold pins.
 */

import { airDodgeCharge, airDodgeIntangible, airDodgeOf } from "@/engine/airDodge";
import { BONE_POSE_STRIDE, type BakedMotion } from "@/engine/acmd/bones";
import type { BakedFighter, BoneHurtbox } from "@/engine/acmd/bakeCodec";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import {
  OPEN_ENDED_FRAMES,
  SCALED_FRAMES,
  VARIABLE_LENGTH_ACTIONS,
  clipTimeOfFrame,
  statusDuration,
  statusMotion,
  type MotionClock,
} from "@/engine/acmd/poseClock";
import type { AcmdScript, MotionKind } from "@/engine/acmd/types";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { ONE, toFloat } from "@/engine/fixed";
import { dodgeIntangible, groundDodgeOf, ROLL_BACK, ROLL_FORWARD, rollOf } from "@/engine/groundDodge";
import { fighterParams } from "@/engine/params";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import type { ActionState, FighterDef, MoveSlot } from "@/engine/types";
import { clipFor, getCharacterRig } from "@/render/chars";
import { airDodgeClipTime } from "@/render/poses/airDodge";
import { samplePose, type PoseClip, type PoseSample } from "@/render/poses/clip";
import { rollClipTime, rollTurnTime, spotDodgeClipTime } from "@/render/poses/groundDodgeTime";
import type { PoseName } from "@/render/poses/library";
import { PACED_BY_SPEED, SLOT_POSE, poseNameFor } from "@/render/poses/timing";
import type { Rig } from "@/render/skeleton";
import { buildRig, type Rig3, type SkeletonFile } from "../skeleton/skeleton";
import { calibrate, retarget, type Calibration } from "../retarget/retarget";
import { sideBonePose, worldMatrices, type RootXform } from "./fk";

/* --------------------------------------------------------- clip timing -- */

/**
 * Normalised clip time on motion frame `k` (1-based) of a move lasting `frames`
 * motion frames whose first hitbox is live on motion frame `firstActive` — the
 * two-piece map of `poseTimeFor` (D34), in motion frames.
 */
export function attackClipTime(strike: number | undefined, firstActive: number, frames: number, k: number): number {
  const f = k - 1;
  const first = firstActive - 1;
  if (strike !== undefined && first > 0 && first < frames) {
    return f <= first ? (strike * f) / first : Math.min(1, strike + ((1 - strike) * (f - first)) / (frames - first));
  }
  return frames <= 0 ? 0 : Math.min(1, f / frames);
}

export interface ScriptTiming {
  /** Motion frames the move lasts. */
  readonly frames: number;
  /** First motion frame with a live ATTACK or CATCH, or −1. */
  readonly firstActive: number;
}

/** A move's length and contact frame in motion frames, read off its script over its game frames. */
export function scriptTiming(script: AcmdScript, totalGameFrames: number): ScriptTiming {
  let frames = 1;
  let firstActive = -1;
  for (let g = 1; g <= Math.max(1, totalGameFrames); g++) {
    const st = runScript(script, g);
    if (st.motionFrame > frames) frames = st.motionFrame;
    if (firstActive < 0 && st.attacks.length + st.catches.length > 0) firstActive = st.motionFrame;
  }
  return { frames, firstActive };
}

/** One status motion: which action (and variant) it stands for. */
export interface StatusMotionSpec {
  readonly motion: MotionKind;
  readonly action: ActionState;
  readonly jumpsUsed: number;
  readonly fastFalling: boolean;
  /**
   * The `charge` the motion is baked at. It names a dodge's direction (ruling
   * R4): an air dodge's stick direction (`airDodgeCharge`), a roll's way
   * (`ROLL_FORWARD`/`ROLL_BACK`). 0 for every other status.
   */
  readonly charge: number;
}

/**
 * The clock a status motion is baked on, from its clip and the state's length
 * for this fighter: `statusDuration` with the fighter's own def and the spec's
 * `charge`, because the dodges' lengths are each fighter's own and per
 * direction (Plan 3; DISPATCH-NOTES 10.1).
 */
export function statusClock(clip: PoseClip, poseName: PoseName, spec: StatusMotionSpec, def: FighterDef): MotionClock {
  if (clip.loop) {
    // `timing.ts`'s DEFAULT_PERIOD for a clip that names none.
    const frames = clip.period ?? 30;
    if (poseName === "idle") return { kind: "idle", frames };
    if (PACED_BY_SPEED[poseName]) return { kind: "paced", frames };
    return { kind: "loop", frames };
  }
  if (VARIABLE_LENGTH_ACTIONS.has(spec.action)) return { kind: "scaled", frames: SCALED_FRAMES };
  const d = statusDuration(
    { action: spec.action, actionFrame: 0, charge: spec.charge, hitstun: 0, jumpsUsed: spec.jumpsUsed, shortHop: false, vy: 0 },
    def,
  );
  return { kind: "once", frames: d ?? OPEN_ENDED_FRAMES };
}

/**
 * The charges each dodge is baked at: one stick direction per air-dodge class
 * (neutral, sideways, up, down, diagonally up, diagonally down) and both ways
 * of a roll. Each is a charge the sim gives (`airDodgeCharge`, `rollCharge`),
 * and every charge `statusMotion` sends to the same motion lasts as long and is
 * intangible on the same frames (a left and a right diagonal are equal in
 * `airDodgeFrames`), so one charge stands for its whole motion. `bake.test.ts`
 * holds both to that.
 */
const DODGE_CHARGES: Readonly<Partial<Record<ActionState, readonly number[]>>> = {
  airDodge: [
    airDodgeCharge(0, 0),
    airDodgeCharge(1, 0),
    airDodgeCharge(0, 1),
    airDodgeCharge(0, -1),
    airDodgeCharge(1, 1),
    airDodgeCharge(1, -1),
  ],
  roll: [ROLL_FORWARD, ROLL_BACK],
};

/** The second jump and the fast fall: the variants `statusMotion` names apart. */
const VARIANTS = [
  { jumpsUsed: 1, fastFalling: false },
  { jumpsUsed: 2, fastFalling: false },
  { jumpsUsed: 1, fastFalling: true },
] as const;

/** Every status motion `statusMotion` can return, each once, with the state it is baked for. */
export function statusMotionSpecs(): StatusMotionSpec[] {
  const out: StatusMotionSpec[] = [];
  const seen = new Set<MotionKind>();
  for (const action of Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]) {
    for (const charge of DODGE_CHARGES[action] ?? [0]) {
      for (const v of VARIANTS) {
        const motion = statusMotion({ action, charge, ...v });
        if (seen.has(motion)) continue;
        seen.add(motion);
        out.push({ motion, action, charge, ...v });
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- input -- */

export interface FighterBakeInput {
  readonly def: FighterDef;
  readonly skeleton: SkeletonFile;
  /** Lower-case bones scripts may name for this fighter (active and reference scripts). */
  readonly scriptBones: ReadonlySet<string>;
}

/** Everything one fighter's poses depend on, prepared once. */
export interface FighterPoser {
  readonly fighterId: string;
  readonly rig3: Rig3;
  readonly cal: Calibration;
  readonly rig2d: Rig;
  /** 2D rig units → world units, for clip offsets. */
  readonly rigScale2d: number;
  /** `FighterParams.scale` as a float. */
  readonly scale: number;
}

export function fighterPoser(def: FighterDef, skeleton: SkeletonFile): FighterPoser {
  const rig3 = buildRig(skeleton);
  const character = getCharacterRig(def.id);
  return {
    fighterId: def.id,
    rig3,
    cal: calibrate(rig3, character.bones),
    rig2d: character.bones,
    rigScale2d: character.scale,
    scale: toFloat(fighterParams(def).scale),
  };
}

/** The root transform a pose sample asks for (offsets and squash), at the fighter's size. */
export function rootXformOf(p: FighterPoser, s: PoseSample): RootXform {
  return {
    forward: s.offsetX * p.rigScale2d,
    up: s.offsetY * p.rigScale2d,
    squashForward: s.scaleX,
    squashUp: s.scaleY,
    scale: p.scale,
  };
}

/** World matrices of every bone for a pose sample plus a clip spin (radians). */
export function poseWorld(p: FighterPoser, s: PoseSample, spin: number): number[][] {
  return worldMatrices(p.rig3, retarget(p.cal, p.rig2d, s.angles, s.rotation + spin), rootXformOf(p, s));
}

/** The clip sample and spin a motion plays on its baked frame `k`. */
export interface MotionSampler {
  readonly clip: PoseClip;
  readonly clock: MotionClock;
  /** Normalised clip time on baked frame `k` (1-based). */
  readonly time: (k: number) => number;
  /**
   * How far the clip's `spin` has turned on frame `k`, 0 to 1, where that is
   * not the clip time: a roll turns at one constant rate however its clip is
   * re-timed (`rollTurnTime`). Absent: the clip time.
   */
  readonly turn?: (k: number) => number;
}

/** The sampler for each slot's active script motion. */
export function moveSamplers(def: FighterDef): Map<MotionKind, MotionSampler & { slot: MoveSlot }> {
  const out = new Map<MotionKind, MotionSampler & { slot: MoveSlot }>();
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const move = def.moves[slot];
    const script = gameScriptFor(def, slot);
    if (move === undefined || script === null) continue;
    if (out.has(script.motion)) throw new Error(`bake ${def.id}: slots ${out.get(script.motion)!.slot} and ${slot} share motion ${script.motion}`);
    const clip = clipFor(def.id, SLOT_POSE[slot]);
    const timing = scriptTiming(script, move.totalFrames);
    out.set(script.motion, {
      slot,
      clip,
      clock: { kind: "script", frames: timing.frames },
      time: (k) => attackClipTime(clip.strike, timing.firstActive, timing.frames, k),
    });
  }
  return out;
}

/**
 * A dodge's clip time on its baked frame `k`, and a roll's turn: the 2D
 * renderer's own (`poseTimeFor`, `poseSpinFor`) on `actionFrame` k − 1, where
 * the once clock puts that frame. So the 3D draws, and the hurtboxes follow,
 * exactly what the 2D draws (DISPATCH-NOTES 10.2):
 * - the air dodge in two halves around its intangibility's end
 *   (`airDodgeClipTime`, Plan 3 Task 20c);
 * - the spot dodge and the roll with their evasive segment on the fighter's
 *   own intangible frames (`spotDodgeClipTime`, `rollClipTime`; Task 9b);
 * - the roll's turn at one constant rate (`rollTurnTime`), not its clip time.
 *
 * Only for the dodge itself and only as 2D does it: the ledge and tech rolls
 * borrow the roll clip and play it linearly, and a looping clip loops. Null
 * for everything else, which plays linearly (`clipTimeOfFrame`).
 */
function dodgeTiming(spec: StatusMotionSpec, poseName: PoseName, def: FighterDef, clock: MotionClock): Pick<MotionSampler, "time" | "turn"> | null {
  if (clock.kind !== "once") return null;
  const total = clock.frames;
  if (spec.action === "airDodge" && poseName === "airDodge") {
    const last = airDodgeIntangible(airDodgeOf(def.attributes), spec.charge)[1];
    return { time: (k) => airDodgeClipTime(k - 1, total, last) };
  }
  if (spec.action === "spotDodge" && poseName === "spotDodge") {
    const [first, last] = dodgeIntangible(groundDodgeOf(def.attributes).spotDodge);
    return { time: (k) => spotDodgeClipTime(k - 1, total, first, last) };
  }
  if (spec.action === "roll" && poseName === "roll") {
    const [first, last] = dodgeIntangible(rollOf(groundDodgeOf(def.attributes), spec.charge));
    return { time: (k) => rollClipTime(k - 1, total, first, last), turn: (k) => rollTurnTime(k - 1, total) };
  }
  return null;
}

/** The sampler for each status motion. */
export function statusSamplers(def: FighterDef): Map<MotionKind, MotionSampler> {
  const out = new Map<MotionKind, MotionSampler>();
  for (const spec of statusMotionSpecs()) {
    const poseName = poseNameFor({ action: spec.action, move: null, jumpsUsed: spec.jumpsUsed, fastFalling: spec.fastFalling });
    const clip = clipFor(def.id, poseName);
    const clock = statusClock(clip, poseName, spec, def);
    out.set(spec.motion, { clip, clock, ...(dodgeTiming(spec, poseName, def, clock) ?? { time: (k) => clipTimeOfFrame(clock, k) }) });
  }
  return out;
}

/** Every motion's sampler, moves first (a move motion never collides with `status_*`). */
export function motionSamplers(def: FighterDef): Map<MotionKind, MotionSampler> {
  return new Map<MotionKind, MotionSampler>([...moveSamplers(def), ...statusSamplers(def)]);
}

/** Clip sample and spin for a sampler's frame, in `poseSpinFor`'s own arithmetic. */
export function sampleAt(s: MotionSampler, k: number): { sample: PoseSample; spin: number } {
  const t = s.time(k);
  const spin = s.clip.spin;
  return { sample: samplePose(s.clip, t), spin: spin ? (s.turn?.(k) ?? t) * spin * Math.PI * 2 : 0 };
}

/* ---------------------------------------------------------------- bake -- */

const q12 = (v: number): number => Math.round(v * ONE);

export function bakeFighter(input: FighterBakeInput): BakedFighter {
  const { def, skeleton } = input;
  const p = fighterPoser(def, skeleton);
  const lowerOf = (i: number) => p.rig3.names[i].toLowerCase();

  // The bones the sim reads: hurtbox bones and every bone a script names that
  // this skeleton has. A bone an *active* script names but the skeleton lacks is
  // an error: `scriptHitboxes` would throw mid-match.
  const wanted = new Set<string>(skeleton.hurt.map((h) => h.bone.toLowerCase()));
  for (const b of input.scriptBones) if (p.rig3.byLower.has(b)) wanted.add(b);
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const script = gameScriptFor(def, slot);
    if (script === null) continue;
    for (const bone of scriptBoneNames(script.commands)) {
      if (!p.rig3.byLower.has(bone)) throw new Error(`bake ${def.id}: ${script.name} uses bone "${bone}", which the skeleton lacks`);
      wanted.add(bone);
    }
  }
  const boneIdx = [...wanted].map((b) => p.rig3.byLower.get(b)!).sort((a, b) => a - b);
  const bones = boneIdx.map(lowerOf);

  const motions: Record<MotionKind, BakedMotion> = {};
  const clocks: Record<MotionKind, MotionClock> = {};
  for (const [motion, sampler] of motionSamplers(def)) {
    const frames = sampler.clock.frames;
    const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
    for (let k = 1; k <= frames; k++) {
      const { sample, spin } = sampleAt(sampler, k);
      const world = poseWorld(p, sample, spin);
      boneIdx.forEach((bi, j) => {
        const pose = sideBonePose(world[bi]);
        data.set([pose.tx, pose.ty, pose.m00, pose.m01, pose.m02, pose.m10, pose.m11, pose.m12], ((k - 1) * bones.length + j) * BONE_POSE_STRIDE);
      });
    }
    motions[motion] = { frames, data };
    clocks[motion] = sampler.clock;
  }

  const hurt: BoneHurtbox[] = skeleton.hurt.map((h) => ({
    bone: h.bone.toLowerCase(),
    x1: q12(h.x1),
    x2: q12(h.x2),
    r: q12(h.r * p.scale),
  }));

  return { bones: { fighter: def.id, bones, motions }, clocks, hurt };
}
