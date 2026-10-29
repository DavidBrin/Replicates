/**
 * The spot dodge and the rolls follow each fighter's own frames (Plan 4,
 * Task 9b; ruling R5).
 *
 * Both clips were drawn for Plan 1's shared timing and the engine's dodges are
 * each fighter's own now (UltimateFrameData, `groundDodge.ts`; Plan 3 final
 * wave), so a clip played linearly over a fighter's length left the drawing and
 * the intangibility apart: Mario's spot dodge stayed crouched until frame 21 of
 * 25 with his intangibility over on 17. `spotDodgeClipTime` and `rollClipTime`
 * place each clip's evasive segment over the intangible frames, the way
 * `airDodgeClipTime` places the air dodge's window end.
 *
 * Frames are `actionFrame`s throughout (a published frame N is `actionFrame`
 * N − 1; `groundDodge.ts`). Three layers are tested, the way `airDodge.test.ts`
 * does it: the clip time itself on every roster fighter, the drawing it
 * produces, and the whole thing through `step()`, where the engine says which
 * frames are intangible.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ROLL_BACK, ROLL_FORWARD, dodgeIntangible, groundDodgeOf } from "@/engine/groundDodge";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, type ActionState, type FighterDef, type FighterState, type GameState, type InputFrame, type MatchRules } from "@/engine/types";
import { FIGHTERS, getFighter } from "@/fighters";
import { STAGES } from "@/stages";
import { getCharacterRig, rotationPivot } from "../characterArt";
import { BASE_RIG, DRAWN_BONES, resolve, type BoneName } from "../skeleton";
import { makeFighter } from "../testFixtures";
import { samplePose, type PoseSample } from "./clip";
import { rollClipTime, spotDodgeClipTime } from "./groundDodgeTime";
import { roll } from "./roll";
import { spotDodge } from "./spotDodge";
import { actionDurationFor, jumpTimingFor, poseNameFor, poseSpinFor, poseTimeFor, samplePoseForFighter } from "./timing";

/**
 * Where each clip's segments fall, in clip time. Stated here, apart from the
 * clip files, so a retimed key cannot move them silently.
 * - Spot dodge (24-frame grid): the compress arrives on key 3 (`t` = 3/24) and
 *   the tell, the hips already lifting, is key 20; the standing shape is key 23.
 * - Roll (31-frame grid): the duck is key 3 (`t` = 0.097), the held ball ends
 *   where the cubic-in opening span has barely begun, at grid frame 20; the last
 *   drawn frame of the grid is 30/31.
 */
const SEGMENTS = {
  spot: { evasive: [3 / 24, 20 / 24], settle: 23 / 24 },
  roll: { evasive: [0.097, 20 / 31], settle: 30 / 31 },
} as const;

/** One spot dodge or roll as the clip sees it. */
interface Dodge {
  readonly name: string;
  readonly def: FighterDef;
  readonly kind: "spot" | "roll";
  readonly action: "spotDodge" | "roll";
  /** A roll's way, in `charge`. */
  readonly charge: number;
  readonly total: number;
  /** The intangible `actionFrame`s, first and last. */
  readonly window: readonly [number, number];
}

/** Every spot dodge and roll on the roster, from the fighters' own frame data. */
const DODGES: readonly Dodge[] = FIGHTERS.flatMap((def): Dodge[] => {
  const g = groundDodgeOf(def.attributes);
  return [
    { name: `${def.id} spot dodge`, def, kind: "spot", action: "spotDodge", charge: 0, total: g.spotDodge.frames, window: dodgeIntangible(g.spotDodge) },
    { name: `${def.id} forward roll`, def, kind: "roll", action: "roll", charge: ROLL_FORWARD, total: g.forwardRoll.frames, window: dodgeIntangible(g.forwardRoll) },
    { name: `${def.id} back roll`, def, kind: "roll", action: "roll", charge: ROLL_BACK, total: g.backRoll.frames, window: dodgeIntangible(g.backRoll) },
  ];
});
const ROLLS = DODGES.filter((d) => d.kind === "roll");
const SPOTS = DODGES.filter((d) => d.kind === "spot");

/** The fighter as the renderer is handed it on `actionFrame` `frame` of `d`. */
const fighterAt = (d: Dodge, frame: number): FighterState =>
  makeFighter({ defId: d.def.id, action: d.action, actionFrame: frame, charge: d.charge });

/** The clip time the renderer uses on `actionFrame` `frame` of `d`. */
function clipTime(d: Dodge, frame: number): number {
  const f = fighterAt(d, frame);
  return poseTimeFor(poseNameFor(f), f, 0, undefined, jumpTimingFor(d.def));
}

/** The pose and whole-body turn the renderer draws, the way `drawOneFighter` builds them. */
function drawn(d: Dodge, frame: number): PoseSample {
  const f = fighterAt(d, frame);
  const jump = jumpTimingFor(d.def);
  const s = samplePoseForFighter(f, 0, undefined, jump);
  return { ...s, rotation: s.rotation + poseSpinFor(f, 0, undefined, jump) };
}

const frames = (d: Dodge): number[] => Array.from({ length: d.total }, (_, i) => i);

describe("every spot dodge and roll plays its evasive segment on exactly its intangible frames", () => {
  it.each(DODGES.map((d) => [d.name, d] as const))("%s", (_name, d) => {
    const [from, to] = SEGMENTS[d.kind].evasive;
    const [first, last] = d.window;
    for (const f of frames(d)) {
      const t = clipTime(d, f);
      const intangible = f >= first && f <= last;
      expect(t >= from && t <= to, `${d.name}: actionFrame ${f} is at clip time ${t.toFixed(4)}`).toBe(intangible);
      if (f < first) expect(t, `${d.name}: actionFrame ${f}, before the window`).toBeLessThan(from);
      if (f > last) expect(t, `${d.name}: actionFrame ${f}, after the window`).toBeGreaterThan(to);
    }
    // The window's own ends are the segment's ends: the shape arrives on the first
    // intangible frame and the tell, the first sign of recovery, is on the last.
    expect(clipTime(d, first)).toBeCloseTo(from, 12);
    expect(clipTime(d, last)).toBeCloseTo(to, 12);
  });
});

describe("the clip time is monotonic, covers the whole clip and ends on the last frame", () => {
  it.each(DODGES.map((d) => [d.name, d] as const))("%s", (_name, d) => {
    const times = frames(d).map((f) => clipTime(d, f));
    expect(times[0]).toBe(0);
    for (let f = 1; f < times.length; f++) expect(times[f], `${d.name}: actionFrame ${f}`).toBeGreaterThan(times[f - 1]);
    // The last frame the renderer draws, `total − 1`, is the last drawing of the clip's own grid
    // (a clip's t = 1 is the hand-off, which no drawing is made on).
    expect(times.at(-1)).toBeCloseTo(SEGMENTS[d.kind].settle, 12);
    expect(clipTime(d, d.total)).toBe(1);
  });

  it("is the pure function's time too, and clamps outside the dodge", () => {
    const fn = { spot: spotDodgeClipTime, roll: rollClipTime };
    for (const d of DODGES) {
      for (const f of [0, 1, d.window[0], d.window[1], d.total - 1, d.total]) {
        expect(fn[d.kind](f, d.total, d.window[0], d.window[1]), `${d.name}: actionFrame ${f}`).toBe(clipTime(d, f));
      }
      expect(fn[d.kind](-3, d.total, ...d.window)).toBe(0);
      expect(fn[d.kind](d.total + 9, d.total, ...d.window)).toBe(1);
    }
  });

  it("plays straight through when the window does not fit the dodge", () => {
    // No window (or one that runs to the end) has nothing to anchor on: plain `frame / total`.
    for (const fn of [spotDodgeClipTime, rollClipTime]) {
      for (const [first, last] of [[0, 0], [-1, -1], [2, 40], [10, 5]] as const) {
        for (let f = 0; f <= 30; f++) expect(fn(f, 30, first, last)).toBeCloseTo(f / 30, 12);
      }
      expect(fn(7, 0, 2, 9)).toBe(0);
    }
  });
});

describe("the segment boundaries are where the clips' own keys put them", () => {
  const keyTimes = (clip: typeof roll) => clip.keys.map((k) => k.t);

  it("puts the spot dodge's evasive segment from the compress to the tell, and its settle on the standing key", () => {
    expect(keyTimes(spotDodge)).toEqual(expect.arrayContaining([SEGMENTS.spot.evasive[0], SEGMENTS.spot.evasive[1], SEGMENTS.spot.settle]));
  });

  it("starts the roll's evasive segment on its duck key and closes the tuck on its ball key", () => {
    expect(keyTimes(roll)).toEqual(expect.arrayContaining([SEGMENTS.roll.evasive[0], 0.226]));
    // The segment ends between the last of the held ball (key 18, t = 0.58) and the key where the tuck
    // has opened (t = 0.71): at grid frame 20, where the cubic-in span out of the ball has barely begun.
    // `roll.test.ts` holds that to the drawing on every rig.
    expect(SEGMENTS.roll.evasive[1]).toBeGreaterThan(0.58);
    expect(SEGMENTS.roll.evasive[1]).toBeLessThan(0.71);
  });
});

describe("Mario's spot dodge reaches its recovery pose by his intangibility end", () => {
  const mario = getFighter("mario")!;
  const jump = jumpTimingFor(mario);
  /** Mario's spot dodge on published frame `n`: 25 frames, intangible on 3-17. */
  const on = (n: number): PoseSample =>
    samplePoseForFighter(makeFighter({ action: "spotDodge", actionFrame: n - 1 }), 0, undefined, jump);

  it("is on the tell, the first pose of the recovery, on frame 17", () => {
    expect(groundDodgeOf(mario.attributes).spotDodge).toEqual({ frames: 25, intangible: [3, 17] });
    expect(on(17)).toEqual(samplePose(spotDodge, 20 / 24));
  });

  it("is still compressed on frame 16 and standing back up from frame 18", () => {
    const crown = (s: PoseSample): number => shapeOf(s).height;
    expect(poseTimeFor("spotDodge", makeFighter({ action: "spotDodge", actionFrame: 15 }), 0, undefined, jump)).toBeLessThan(20 / 24);
    expect(crown(on(16))).toBeLessThan(crown(on(17)));
    // The old linear timing was still in its crouch here and did not start standing until about frame 21.
    expect(crown(on(18))).toBeGreaterThan(crown(on(17)));
    expect(crown(on(19))).toBeGreaterThan(crown(on(18)));
  });
});

describe("a roll's turn stays constant, so it still rolls without slipping", () => {
  it.each(ROLLS.map((d) => [d.name, d] as const))("%s", (_name, d) => {
    // The roll's velocity is one value for all its frames, so the body turns at one rate:
    // the turn follows the roll's length, not the retimed clip (`poseSpinFor`).
    const jump = jumpTimingFor(d.def);
    for (const f of frames(d)) {
      const spin = poseSpinFor(fighterAt(d, f), 0, undefined, jump);
      expect(spin, `${d.name}: actionFrame ${f}`).toBeCloseTo((f / d.total) * Math.PI * 2, 12);
    }
  });
});

describe("the other rolls keep their own plain timing", () => {
  it.each(["ledgeRoll", "techRoll"] as const satisfies readonly ActionState[])("%s plays the roll clip over its own length", (action) => {
    const mario = getFighter("mario")!;
    const jump = jumpTimingFor(mario);
    for (const af of [0, 3, 9]) {
      const f = makeFighter({ action, actionFrame: af });
      const length = actionDurationFor(f, jump)!;
      expect(poseTimeFor("roll", f, 0, undefined, jump)).toBeCloseTo(af / length, 12);
      expect(poseSpinFor(f, 0, undefined, jump)).toBeCloseTo((af / length) * Math.PI * 2, 12);
    }
  });
});

/* --------------------------------------------------------- the drawing -- */

/** A spot dodge's shape on the reference rig, as `spotDodge.test.ts` measures it. */
function shapeOf(s: PoseSample): { readonly height: number; readonly pelvis: number } {
  const sk = resolve(BASE_RIG, s.angles, { x: 0, y: 0, scale: 1, scaleX: s.scaleX, scaleY: s.scaleY, facing: 1 });
  let crown = -Infinity;
  for (const name of DRAWN_BONES) crown = Math.max(crown, -sk[name].y0, -sk[name].y1);
  return { height: crown + s.offsetY, pelvis: -sk.hip.y0 + s.offsetY };
}

/** A roll's silhouette on the fighter's own rig, turn included, the way `roll.test.ts` measures it: its height and lowest point. */
function rollShape(rigId: string, s: PoseSample): { readonly height: number; readonly sole: number } {
  const rig = getCharacterRig(rigId);
  const sk = resolve(rig.bones, s.angles, {
    x: 0,
    y: -s.offsetY,
    scale: 1,
    facing: 1,
    pivot: rotationPivot(rig),
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    rotation: s.rotation,
  });
  let low = -Infinity;
  let high = Infinity;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    const half = b.thickness / 2;
    low = Math.max(low, b.y0 + half, b.y1 + half);
    high = Math.min(high, b.y0 - half, b.y1 - half);
  }
  const r = rig.headRadius * s.scaleX;
  low = Math.max(low, sk.head.y1 + r);
  high = Math.min(high, sk.head.y1 - r);
  return { height: low - high, sole: low };
}

/**
 * How far the furthest point of the fighter is from their own pelvis: the tuck's size. Blind to the
 * whole-body turn, which a bounding box is not (a turning ball's swells and shrinks with the angle),
 * and to how a rig's head or ears stick out of the ball, which hides the opening in its height.
 */
function reachOf(rigId: string, s: PoseSample): number {
  const rig = getCharacterRig(rigId);
  const sk = resolve(rig.bones, s.angles, { x: 0, y: 0, scale: 1, facing: 1, pivot: rotationPivot(rig), scaleX: s.scaleX, scaleY: s.scaleY });
  const px = sk.hip.x0;
  const py = sk.hip.y0;
  let worst = Math.hypot(sk.head.x1 - px, sk.head.y1 - py) + rig.headRadius * s.scaleX;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    const half = b.thickness / 2;
    worst = Math.max(worst, Math.hypot(b.x0 - px, b.y0 - py) + half, Math.hypot(b.x1 - px, b.y1 - py) + half);
  }
  return worst;
}

/** The largest angle any one bone turns between two samples, in degrees. */
function maxBoneStep(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const name of Object.keys(b.angles) as BoneName[]) {
    const x = a.angles[name];
    const y = b.angles[name];
    if (x === undefined || y === undefined) continue;
    worst = Math.max(worst, Math.abs(((y - x) * 180) / Math.PI));
  }
  return worst;
}

describe("each fighter's spot dodge is drawn as one against its own frames", () => {
  it.each(SPOTS.map((d) => [d.name, d] as const))("%s", (_name, d) => {
    const shape = frames(d).map((f) => shapeOf(drawn(d, f)));
    const [first, last] = d.window;
    const tallest = Math.max(...shape.map((s) => s.height));
    const shortest = Math.min(...shape.map((s) => s.height));
    const end = shape.length - 1;

    // Crouched on every intangible frame, and the compress is done by the first.
    for (let f = first; f <= last; f++) {
      expect(shape[f].height, `${d.name}: actionFrame ${f}`).toBeLessThan(tallest * 0.9);
      expect(shape[f].pelvis, `${d.name}: actionFrame ${f}`).toBeLessThan(shape[end].pelvis * 0.85);
    }
    expect((shape[0].height - shape[first].height) / (shape[0].height - shortest)).toBeGreaterThan(0.85);

    // Standing back up from the last intangible frame to the last drawn one, which is the standing shape.
    for (let f = last; f < end; f++) expect(shape[f + 1].height, `${d.name}: actionFrame ${f + 1}`).toBeGreaterThan(shape[f].height);
    expect(shape[end].height).toBeCloseTo(tallest, 9);
    expect((shape[end].height - shape[last].height) / (shape[end].height - shortest)).toBeGreaterThan(0.6);

    // Never leaves the spot, and never snaps a limb the long way round.
    for (let f = 0; f <= end; f++) expect(Math.abs(drawn(d, f).offsetX)).toBeLessThan(tallest / 20);
    for (let f = 1; f <= end; f++) expect(maxBoneStep(drawn(d, f - 1), drawn(d, f)), `${d.name}: into actionFrame ${f}`).toBeLessThan(130);
  });
});

describe("each fighter's rolls are drawn as rolls against their own frames", () => {
  it.each(ROLLS.map((d) => [d.name, d] as const))("%s", (_name, d) => {
    const samples = frames(d).map((f) => drawn(d, f));
    const reach = samples.map((s) => reachOf(d.def.id, s));
    // The roll as it is drawn, turn and all, for the floor.
    const shape = samples.map((s) => rollShape(d.def.id, s));
    const [first, last] = d.window;
    const end = reach.length - 1;
    // The tightest the roll gets anywhere in the clip, which is the shut ball (`roll.test.ts`).
    const tightest = Math.min(...Array.from({ length: 311 }, (_, i) => reachOf(d.def.id, samplePose(roll, i / 310))));

    // The ball is shut inside the window and held there once it has closed (four frames after the
    // duck on the first intangible frame, as it was drawn), so the whole window is a tuck.
    expect(Math.min(...reach.slice(first, last + 1)) / tightest, `${d.name}: the tuck inside the window`).toBeLessThan(1.03);
    for (let f = first + 4; f <= last; f++) expect(reach[f] / tightest, `${d.name}: actionFrame ${f}`).toBeLessThan(1.06);

    // Opening soon after the window, so being vulnerable is visible: three frames on it is open
    // (the old linear timing was still a shut ball there), it never closes back up by more than a
    // percent a frame, and it finishes wider than the ball.
    expect(reach[last + 3] / tightest, `${d.name}: three frames after the window`).toBeGreaterThan(1.05);
    for (let f = last + 1; f <= end; f++) expect(reach[f] / reach[f - 1], `${d.name}: actionFrame ${f}`).toBeGreaterThan(0.99);
    expect(reach[end] / tightest).toBeGreaterThan(1.25);

    // Planted on the floor and never snapping: nothing turns over thirty degrees in a frame,
    // the soles never move more than an eighth of the fighter's height in one, and never leave
    // the floor by more than a quarter of it. (A fifth on the grid it was drawn on, where the turn
    // and the pose run together; the turn is constant here, `rollTurnTime`, so the pair meets at
    // other phases: the worst is Marth's back roll, mid-recovery, at 0.225.)
    const standing = shape[0].height;
    const floor = rollShape(d.def.id, { angles: {}, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1 }).sole;
    for (let f = 0; f <= end; f++) {
      expect(Math.abs(shape[f].sole - floor), `${d.name}: actionFrame ${f} off the floor`).toBeLessThan(standing * 0.25);
      if (f === 0) continue;
      expect(maxBoneStep(samples[f - 1], samples[f]), `${d.name}: into actionFrame ${f}`).toBeLessThan(30);
      expect(Math.abs(shape[f].sole - shape[f - 1].sole), `${d.name}: into actionFrame ${f}`).toBeLessThan(standing * 0.12);
    }
  });

  it("closes the tuck at the speed it was drawn at, at every window on the roster", () => {
    // The ball is shut four frames after the duck wherever the window is; only the held part of it
    // stretches or shortens to fit. `roll.test.ts` pins the drawing itself on its own grid.
    for (const d of ROLLS) {
      const duck = clipTime(d, d.window[0]);
      expect(clipTime(d, d.window[0] + 4) - duck, d.name).toBeCloseTo(0.226 - 0.097, 12);
    }
  });
});

/* -------------------------------------------------------- through step() -- */

describe("through step(), the clip is evasive on exactly the frames the engine makes the fighter intangible", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
  const IDS = FIGHTERS.map((f) => f.id);

  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  const hold = (input: InputFrame, n: number): InputFrame[] => Array.from({ length: n }, () => input);

  /** One fighter standing still on Final Destination, actionable. */
  function standing(id: string): GameState {
    let s = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
    for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
    return s;
  }

  /** The fighter on each frame of a dodge out of a held shield: down for the spot dodge, with or against its facing for a roll. */
  function dodgeFrom(id: string, kind: "spot" | "forward" | "back"): FighterState[] {
    let s = standing(id);
    const facing = s.fighters[0].facing;
    const key = kind === "spot" ? Btn.Down : (kind === "forward") === facing > 0 ? Btn.Right : Btn.Left;
    let prev: InputFrame = 0;
    const out: FighterState[] = [];
    for (const input of [...hold(Btn.Shield, 4), Btn.Shield | key, ...hold(0, 50)]) {
      s = step(s, [input], { prevInputs: [prev] }).state;
      prev = input;
      out.push(s.fighters[0]);
    }
    return out.slice(4);
  }

  it.each(IDS)("%s: spot dodge, forward roll and back roll", (id) => {
    const jump = jumpTimingFor(getFighter(id)!);
    const dodges = [
      ["spot", "spotDodge", SEGMENTS.spot],
      ["forward", "roll", SEGMENTS.roll],
      ["back", "roll", SEGMENTS.roll],
    ] as const;
    for (const [kind, action, seg] of dodges) {
      const played = dodgeFrom(id, kind);
      const total = played.findIndex((f) => f.action !== action);
      expect(total, `${id} ${kind}: the dodge ran`).toBeGreaterThan(20);
      let intangible = 0;
      for (const [i, f] of played.slice(0, total).entries()) {
        const t = poseTimeFor(poseNameFor(f), f, i, undefined, jump);
        const evasive = t >= seg.evasive[0] && t <= seg.evasive[1];
        expect(evasive, `${id} ${kind}: frame ${i + 1}, intangible ${f.intangible}, clip time ${t.toFixed(4)}`).toBe(f.intangible > 0);
        if (evasive) intangible++;
      }
      expect(intangible, `${id} ${kind}: some frames were intangible`).toBeGreaterThan(5);
    }
  });
});
