// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE, layeredBoneTable, type BoneTable } from "@/engine/acmd/bones";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import type { MotionKind } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { P, swapLimbSides, type PoseClip } from "@/render/poses/clip";
import type { BoneName } from "@/render/skeleton";
import { clipFor } from "@/render/chars";
import { SLOT_POSE } from "@/render/poses/timing";
import { fighterPoser, moveSamplers, poseWorld, sampleAt, type MotionSampler } from "@/render3d/bake/bake";
import { sideBonePose } from "@/render3d/bake/fk";
import { driveFor } from "@/render3d/retarget/map";
import { boneRole } from "@/render3d/retarget/placeable";
import { accumulatedAngles } from "@/render3d/retarget/retarget";
import { SKELETONS } from "@/render3d/skeletons";
import { FIGHTERS } from "../index";
import { withReferenceScripts } from "./active";
import { DIRECTION, along, dirOf, type Dir } from "./hitDirection";
import { REFERENCE_SCRIPTS } from "./index";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * The limb a hitbox rides is the limb that strikes (Plan 4, Task 13b).
 *
 * Since Task 13 a limb-bone script's box hangs off the SSBU bone its script
 * names, and our 2D clip, retargeted, puts that bone somewhere. A clip that
 * strikes with the other limb, or swings the right limb the wrong way, leaves
 * the box on a limb that is not swinging: Donkey Kong's back air kicking behind
 * him with its box in front, Mario's overhand with its box on the arm hanging at
 * his side. The reach ratchet (`reach.test.ts`) measures how far a box reaches
 * the way the move hits, and cannot see a box that reaches far enough on the
 * wrong limb; this test can.
 *
 * The rule, for every limb slot the game runs that is not a sweep, on every
 * game frame it has a live box: every box riding a driven arm or leg rides a
 * **leading** limb in the move's direction (`DIRECTION`). A leading limb's far joint — the hand, the foot, or
 * the sword's tip for a sword-carrying arm — lies within 2 units of the furthest
 * far joint that way among the two arms and the two legs. A box on the root or
 * on the trunk or head (a bone riding the hip or the chest: a tail, a clavicle)
 * is exempt. A box the published move puts on a trailing limb on purpose is an
 * exception below, with its reason.
 *
 * Where the bones are is computed from the clips, the scripts and the committed
 * skeletons, the bake's own input (`bakeRoster`), not read from the bake: the
 * bake keeps only the bones the sim reads, and a hand need not be one of them.
 * `roster.test.ts` holds the bake to exactly this.
 */

/** How far, in world units, a limb's far joint may trail the furthest one and still lead. */
const LEAD = 2.0;

type Limb = "arm L" | "arm R" | "leg L" | "leg R";
const LIMBS: readonly Limb[] = ["arm L", "arm R", "leg L", "leg R"];

/** The 2D bones of each limb, the last one at its far end (`render/skeleton.ts`). */
const CHAIN: Readonly<Record<Limb, readonly BoneName[]>> = {
  "arm L": ["upperArmL", "forearmL", "handL"],
  "arm R": ["upperArmR", "forearmR", "handR"],
  "leg L": ["thighL", "shinL", "footL"],
  "leg R": ["thighR", "shinR", "footR"],
};

/** The SSBU bones a 2D bone turns, for this fighter (`driveFor`, with its overrides). */
function drives(id: string, bone: BoneName): string[] {
  return driveFor(id, bone)?.bones.map((b) => b.toLowerCase()) ?? [];
}

/**
 * The limb a script bone belongs to: a bone a limb's drive turns, or one riding
 * such a bone rigidly (a toe on a foot, a sword on a hand). Null for the root,
 * the trunk and the head, and anything riding them.
 */
function limbOf(id: string, bone: string): Limb | null {
  const role = boneRole(SKELETONS[id], bone);
  const driven = role.kind === "driven" ? bone : role.kind === "rides" ? role.on : null;
  if (driven === null) return null;
  return LIMBS.find((l) => CHAIN[l].some((b) => drives(id, b).includes(driven))) ?? null;
}

/** The SSBU bone at a limb's far end: the hand or the foot. */
const distalBone = (id: string, limb: Limb): string => drives(id, CHAIN[limb][2])[0];

/** A box the published move hangs on a limb that does not lead, on purpose. */
interface Exception {
  /** Game frames the exception covers, inclusive; every live frame when absent. */
  readonly frames?: readonly [number, number];
  readonly reason: string;
}

/**
 * Boxes the published moves hang on a trailing limb, keyed `fighter slot bone`.
 * Entries leave this list when a clip changes so the limb leads; a new one is a
 * reviewed decision, never a way to quiet the test.
 */
const EXCEPTIONS: Readonly<Record<string, Exception>> = {
  "mario nair kneer": {
    frames: [3, 5],
    reason:
      "a sex kick with a box on each leg (game_attackairn: kneer and kneel at 0.8) that launches by position (ATTACK_LR_CHECK_POS): the left leg kicks and leads, the right knee trails behind him",
  },
  "mario nair legr": {
    frames: [6, 27],
    reason: "the same kick's late hit: the kicking shin (kneel) and the trailing thigh (legr), so the box on the thigh sits by his hip, behind the kick",
  },
  "donkeyKong nair arml": {
    frames: [10, 18],
    reason:
      "Donkey Lariat spins with 'discus clotheslines with both arms' (SmashWiki): the script hangs a box on each outstretched arm, so whichever arm is behind him as he turns carries one; here the left",
  },
  "donkeyKong nair armr": {
    frames: [20, 26],
    reason: "the same spin's second half, after the turn: the right arm is the one behind him, its box with it",
  },
  "link nair kneel": {
    reason:
      "a sex kick on the right leg (both kneer boxes: the clean foot at 3.5 and the leg at -2) that launches by position; the script also hangs a small box (size 3) on the left knee, the leg swung back behind him",
  },
  "marth nair sword1": {
    frames: [15, 21],
    reason:
      "Double Slash's second hit is 'a full 360° outward spin' (SmashWiki): on frames 15 to 21 the blade is behind him, where the legacy box sat too (x -3.2), and the move launches by position",
  },
  "marth nair armr": {
    frames: [15, 21],
    reason: "the sword arm's own box during the same spin, behind him with the blade",
  },
};

/** A world matrix's origin, or a bone-local point, on the side plane (x forward, y up). */
function side(m: readonly number[], l: readonly [number, number, number] = [0, 0, 0]): [number, number] {
  return [m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13]];
}

/** A bone-local point in model space. */
function point3(m: readonly number[], l: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((r) => m[r] * l[0] + m[4 + r] * l[1] + m[8 + r] * l[2] + m[12 + r]) as [number, number, number];
}

/** One fighter's bones, posed from its clips: world matrices per motion frame, and a bone table over them. */
interface Posed {
  readonly world: (motion: MotionKind, frame: number) => number[][];
  /** The 2D hand's accumulated angle on a motion frame, radians: where the 2D rig draws a blade. */
  readonly drawnHandR: (motion: MotionKind, frame: number) => number;
  readonly index: (bone: string) => number;
  /** The script's bones placed as the bake would, over the root bone `top`. */
  readonly bones: BoneTable;
}

/** `def`'s bones posed from its clips, with `motion`'s clip replaced by `clip` when given. */
function posed(def: FighterDef, swap?: { motion: MotionKind; clip: PoseClip }): Posed {
  const p = fighterPoser(def, SKELETONS[def.id]);
  const samplers = new Map<MotionKind, MotionSampler>(moveSamplers(def));
  if (swap !== undefined) samplers.set(swap.motion, { ...samplers.get(swap.motion)!, clip: swap.clip });
  const cache = new Map<string, number[][]>();
  const sampled = (motion: MotionKind, frame: number) => {
    const s = samplers.get(motion)!;
    return sampleAt(s, Math.min(Math.max(frame, 1), s.clock.frames));
  };
  const world = (motion: MotionKind, frame: number): number[][] => {
    const key = `${motion} ${frame}`;
    let w = cache.get(key);
    if (w === undefined) {
      const { sample, spin } = sampled(motion, frame);
      w = poseWorld(p, sample, spin);
      cache.set(key, w);
    }
    return w;
  };
  const drawnHandR = (motion: MotionKind, frame: number): number => {
    const { sample, spin } = sampled(motion, frame);
    return accumulatedAngles(p.rig2d, sample.angles, sample.rotation + spin).handR;
  };
  const index = (bone: string): number => p.rig3.byLower.get(bone)!;
  const own: BoneTable = {
    fingerprint: "posed",
    pose(fighterId, motion, frame, bone, out) {
      const i = p.rig3.byLower.get(bone);
      if (fighterId !== def.id || !samplers.has(motion) || i === undefined) return false;
      Object.assign(out, sideBonePose(world(motion, frame)[i] as never));
      return true;
    },
  };
  return { world, drawnHandR, index, bones: layeredBoneTable(own, LEGACY_BONE_TABLE) };
}

/**
 * Where a sword-carrying arm's far end is, when the move hangs boxes on the
 * sword: the box centre on a `sword*` bone furthest from the hand (the blade is
 * rigid on the hand, so one frame tells). A capsule's second end is not a
 * candidate: Marth's up tilt draws its capsules from the blade out across the
 * swing (`x2` 6 off a blade that runs along `z`), not along it. Null for a move
 * with no sword box.
 */
function swordTip(def: FighterDef, slot: MoveSlot, at: Posed): { bone: string; local: [number, number, number] } | null {
  const script = gameScriptFor(def, slot)!;
  const w = at.world(script.motion, 1);
  let best: { bone: string; local: [number, number, number]; d: number } | null = null;
  for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) {
    for (const a of runScript(script, g).attacks) {
      if (!a.bone.startsWith("sword")) continue;
      const hand = point3(w[at.index(distalBone(def.id, limbOf(def.id, a.bone)!))], [0, 0, 0]);
      const local = [a.x, a.y, a.z].map(toFloat) as [number, number, number];
      const p = point3(w[at.index(a.bone)], local);
      const d = Math.hypot(p[0] - hand[0], p[1] - hand[1], p[2] - hand[2]);
      if (best === null || d > best.d) best = { bone: a.bone, local, d };
    }
  }
  return best;
}

/** A box on a limb that trails, on one frame. */
interface Fault {
  readonly key: string;
  readonly g: number;
  readonly text: string;
}

/** Every box of `slot` on a trailing limb, frame by frame, in direction `d`. */
function faultsOf(def: FighterDef, slot: MoveSlot, d: Dir, at: Posed = posed(def)): Fault[] {
  const id = def.id;
  const script = gameScriptFor(def, slot)!;
  const tip = swordTip(def, slot, at);
  const tipArm = tip === null ? null : limbOf(id, tip.bone);
  const out: Fault[] = [];
  for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) {
    const st = runScript(script, g);
    const named = [...st.attacks.map((a) => a.bone), ...st.catches.map((c) => c.bone)];
    if (named.length === 0) continue;
    const boxes = scriptHitboxes(st, id, script.motion, g, at.bones);
    const w = at.world(script.motion, st.motionFrame);
    const reach = Object.fromEntries(
      LIMBS.map((l) => [l, along(d, ...(l === tipArm ? side(w[at.index(tip!.bone)], tip!.local) : side(w[at.index(distalBone(id, l))])))]),
    ) as Record<Limb, number>;
    const best = Math.max(...LIMBS.map((l) => reach[l]));
    boxes.forEach((h, i) => {
      const limb = limbOf(id, named[i]);
      // Along the move's direction only: a limb moved across it, still the furthest that way, passes (D57).
      if (limb === null || reach[limb] >= best - LEAD) return;
      const lead = LIMBS.find((l) => reach[l] === best)!;
      out.push({
        key: `${id} ${slot} ${named[i]}`,
        g,
        text: `${id} ${slot} g${g} ${named[i]} on ${limb}: its far joint at ${reach[limb].toFixed(1)} ${d}, ${(best - reach[limb]).toFixed(1)} behind ${lead} (box at ${toFloat(h.x).toFixed(1)}, ${toFloat(h.y).toFixed(1)})`,
      });
    });
  }
  return out;
}

const excepted = (f: Fault): boolean => {
  const e = EXCEPTIONS[f.key];
  return e !== undefined && (e.frames === undefined || (f.g >= e.frames[0] && f.g <= e.frames[1]));
};

/**
 * Every limb slot the game runs, in the form the bake is made from (its script
 * and published length). A held slot (`limb.hold.json`) keeps its legacy table,
 * so its clip is judged when its hold is lifted, not before.
 */
function judged(): { def: FighterDef; slot: MoveSlot; d: Dir }[] {
  const out: { def: FighterDef; slot: MoveSlot; d: Dir }[] = [];
  for (const legacy of FIGHTERS) {
    const slots = LIMB_SCRIPT_SLOTS[legacy.id] ?? [];
    if (slots.length === 0) continue;
    const def = withLimbScripts(legacy, null);
    for (const slot of slots) {
      const klass = DIRECTION[`${legacy.id} ${slot}`];
      if (klass !== undefined && klass === dirOf(klass)) out.push({ def, slot, d: klass });
    }
  }
  return out;
}

describe("the limb a box rides is the limb that strikes (Plan 4, Task 13b)", () => {
  const faults = judged().flatMap(({ def, slot, d }) => faultsOf(def, slot, d));

  it("on every live frame of every limb slot, a box on an arm or a leg rides a leading limb", () => {
    expect(faults.filter((f) => !excepted(f)).map((f) => f.text)).toEqual([]);
  });

  it("needs every exception it lists: one that no longer fires is stale", () => {
    const fired = new Set(faults.filter(excepted).map((f) => f.key));
    expect(Object.keys(EXCEPTIONS).filter((k) => !fired.has(k))).toEqual([]);
    for (const [key, e] of Object.entries(EXCEPTIONS)) expect(e.reason.length, key).toBeGreaterThan(40);
  });
});

describe("which limb a box rides", () => {
  it.each([
    ["mario", "arml", "arm L"],
    ["mario", "shoulderr", "arm R"],
    ["donkeyKong", "footl", "leg L"],
    ["mario", "toel", "leg L"],
    ["link", "sword2", "arm R"],
    ["marth", "sword1", "arm R"],
    ["fox", "kneer", "leg R"],
  ] as const)("%s %s is on %s", (id, bone, limb) => {
    expect(limbOf(id, bone)).toBe(limb);
  });

  it.each([
    ["mario", "top"],
    ["pikachu", "trans"],
    ["mario", "hip"],
    ["mario", "bust"],
    ["link", "claviclel"],
    ["fox", "tail1"],
    ["pikachu", "neck"],
  ] as const)("%s %s is on no limb (exempt)", (id, bone) => {
    expect(limbOf(id, bone)).toBeNull();
  });

  it("measures a sword-carrying arm at the blade's furthest box, not the hand", () => {
    const marth = FIGHTERS.find((f) => f.id === "marth")!;
    const def = withReferenceScripts(marth, REFERENCE_SCRIPTS.marth, ["fair"], null);
    const tip = swordTip(def, "fair", posed(def))!;
    expect(tip.bone).toBe("sword1");
    // The tipper's offset along the blade (game_attackairf: z 7.7).
    expect(Math.hypot(...tip.local)).toBeGreaterThan(7);
  });
});

/*
 * The rule's own cases: a clip that strikes with the other limb, and one whose
 * striking limb is moved off the line of the move. Each runs the real script
 * and skeleton with one clip replaced.
 */
describe("the rule catches", () => {
  const formOf = (id: string, slot: MoveSlot): FighterDef =>
    withReferenceScripts(FIGHTERS.find((f) => f.id === id)!, REFERENCE_SCRIPTS[id], [slot], null);

  it.each([
    ["mario", "fair", "an overhand thrown with the right arm, the boxes on the left (arml, shoulderl)", "F"],
    ["donkeyKong", "bair", "a back kick with the right leg, the boxes on the left (footl, kneel)", "B"],
    ["fox", "nair", "a flying kick with the right leg, the box on the left knee (kneel)", "F"],
  ] as const)("%s %s with its limbs traded back: %s", (id, slot, _what, d) => {
    const def = formOf(id, slot);
    const motion = gameScriptFor(def, slot)!.motion;
    expect(faultsOf(def, slot, d)).toEqual([]);
    expect(faultsOf(def, slot, d, posed(def, { motion, clip: swapLimbSides(clipFor(id, SLOT_POSE[slot])) })).length).toBeGreaterThan(0);
  });

  it("Marth's forward air with the sword arm dropped straight down", () => {
    const def = formOf("marth", "fair");
    const motion = gameScriptFor(def, "fair")!.motion;
    const clip = clipFor("marth", "fair");
    // Every key's sword arm hangs plumb (the upper arm turned against the spine's
    // lean, the elbow and wrist straight), so the blade along it points at the floor.
    const dropped: PoseClip = {
      ...clip,
      keys: clip.keys.map((k) => {
        const lean = (k.pose.hip ?? 0) + (k.pose.torso ?? 0) + (k.rotation ?? 0);
        return { ...k, pose: { ...k.pose, ...P({ forearmR: 0, handR: 0 }), upperArmR: Math.PI - lean } };
      }),
    };
    expect(faultsOf(def, "fair", "F")).toEqual([]);
    expect(faultsOf(def, "fair", "F", posed(def, { motion, clip: dropped })).length).toBeGreaterThan(0);
  });
});

/*
 * The swordsmen's grip (`retarget/map.ts`, Task 13b fix round 1): the 2D rig
 * draws the blade along the hand, and the model's fist holds it across, so the
 * hand is turned a further quarter. Here, on every live frame of every Link and
 * Marth slot whose boxes ride the sword, the blade the skeleton holds lies
 * within 10° of the blade the clip draws, in the side plane. (It measured 82–92°
 * off before the turn, and −6° to +4° after; Marth's down tilt squashes.)
 */
describe("the sword the skeleton holds is the sword the clip draws", () => {
  /** The bone each swordsman's blade runs along, and its local axis: the committed skeletons'. */
  const BLADE: Readonly<Record<string, { readonly bone: string; readonly axis: 0 | 1 | 2 }>> = {
    link: { bone: "sword2", axis: 0 },
    marth: { bone: "sword1", axis: 2 },
  };
  /** Side-plane angle of a world matrix's local axis: 0 up, 90° forward, as the 2D rig's angles are. */
  const sideAngle = (m: readonly number[], axis: number): number => Math.atan2(m[axis * 4 + 2], m[axis * 4 + 1]);
  const wrapDeg = (r: number): number => {
    const d = ((r * 180) / Math.PI) % 360;
    return d > 180 ? d - 360 : d <= -180 ? d + 360 : d;
  };

  it.each(Object.entries(BLADE))("%s's blade lies forward in the bind pose, along the axis named", (id, blade) => {
    const rig = fighterPoser(FIGHTERS.find((f) => f.id === id)!, SKELETONS[id]).rig3;
    const m = rig.restWorld[rig.byLower.get(blade.bone)!];
    expect(m[blade.axis * 4 + 2], `${id} ${blade.bone} axis ${blade.axis}`).toBeGreaterThan(0.95);
  });

  it("holds the blade within 10° of the drawn one, on every live frame of every sword slot", () => {
    const off: string[] = [];
    let frames = 0;
    for (const [id, blade] of Object.entries(BLADE)) {
      const def = withLimbScripts(FIGHTERS.find((f) => f.id === id)!, null);
      const at = posed(def);
      for (const slot of LIMB_SCRIPT_SLOTS[id] ?? []) {
        const script = gameScriptFor(def, slot)!;
        for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) {
          const st = runScript(script, g);
          if (!st.attacks.some((a) => a.bone.startsWith("sword"))) continue;
          frames++;
          const held = sideAngle(at.world(script.motion, st.motionFrame)[at.index(blade.bone)], blade.axis);
          const err = wrapDeg(held - at.drawnHandR(script.motion, st.motionFrame));
          if (Math.abs(err) > 10) off.push(`${id} ${slot} g${g}: the held blade is ${err.toFixed(1)}° off the drawn one`);
        }
      }
    }
    expect(off).toEqual([]);
    expect(frames, "sword frames judged").toBeGreaterThan(40);
  });
});
