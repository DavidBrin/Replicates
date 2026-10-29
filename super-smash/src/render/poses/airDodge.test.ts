/**
 * What the air dodge has to look like, stated as measurements of the drawing.
 *
 * The clip is played at every fighter's own lengths, neutral and directional
 * (`airDodgeFrames`, Plan 3 Task 20c), in two halves around the intangible
 * window (`airDodgeClipTime`), so everything here is checked against the
 * sampled skeleton at a real frame count rather than against the keyframe
 * numbers — a key at `t = 0.3` says nothing about whether the fighter is
 * actually curled up on the frames they are intangible on, and that is the only
 * interesting question.
 */

import { describe, expect, it } from "vitest";

import { airDodgeCharge, airDodgeFrames, airDodgeIntangible, airDodgeOf } from "@/engine/airDodge";
import { FIGHTERS } from "@/fighters";
import { BASE_RIG, DRAWN_BONES, resolve, type BoneName } from "../skeleton";
import { samplePose, type PoseSample } from "./clip";
import { airDodge, airDodgeClipTime } from "./airDodge";

/** One air dodge as the clip sees it: its length and its intangible window. */
interface Dodge {
  readonly name: string;
  readonly total: number;
  readonly window: readonly [number, number];
}

const DIRECTIONS: readonly [string, number, number][] = [
  ["neutral", 0, 0],
  ["side", 1, 0],
  ["up", 0, 1],
  ["down", 0, -1],
  ["diagonally up", 1, 1],
  ["diagonally down", 1, -1],
];
/** Every air dodge on the roster. */
const DODGES: readonly Dodge[] = FIGHTERS.flatMap((f) => {
  const a = airDodgeOf(f.attributes);
  return DIRECTIONS.map(([dir, x, y]) => {
    const c = airDodgeCharge(x, y);
    return { name: `${f.id} ${dir}`, total: airDodgeFrames(a, c), window: airDodgeIntangible(a, c) };
  });
});
const dodge = (name: string): Dodge => DODGES.find((d) => d.name === name)!;
/** Mario's neutral dodge, 52 frames, and the shortest, a middling and the longest directional ones. */
const NEUTRAL = dodge("mario neutral");
const DIRECTIONALS = [dodge("fox down"), dodge("mario side"), dodge("kirby up")];

/** The pose on simulation frame `frame` of `d`. */
function at(frame: number, d: Dodge): PoseSample {
  return samplePose(airDodge, airDodgeClipTime(frame, d.total, d.window[1]));
}

function skeletonOf(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
}

/**
 * How far the furthest point of the fighter is from their own pelvis.
 *
 * Measured from the pelvis rather than as a bounding box because it has to be
 * blind to the body's rotation: a curled fighter turned on their side is still
 * curled, and a bounding box would call them tall again.
 */
function reach(s: PoseSample): number {
  const sk = skeletonOf(s);
  const px = sk.hip.x0;
  const py = sk.hip.y0;
  let worst = 0;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    worst = Math.max(worst, Math.hypot(b.x1 - px, b.y1 - py), Math.hypot(b.x0 - px, b.y0 - py));
  }
  return worst;
}

const ALL_BONES = Object.keys(BASE_RIG) as BoneName[];

function degreesBetween(a: number, b: number): number {
  let d = Math.abs(((b - a) * 180) / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function angleOf(s: PoseSample, bone: BoneName): number {
  return s.angles[bone] ?? BASE_RIG[bone].angle;
}

/** The largest angle any single bone turns between two poses, in degrees. */
function maxBoneStep(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const n of ALL_BONES) worst = Math.max(worst, degreesBetween(angleOf(a, n), angleOf(b, n)));
  return worst;
}

/** How different two drawings are: the mean bone-angle difference, in degrees. */
function poseDistance(a: PoseSample, b: PoseSample): number {
  let sum = 0;
  for (const n of ALL_BONES) sum += degreesBetween(angleOf(a, n), angleOf(b, n));
  return sum / ALL_BONES.length + degreesBetween(a.rotation, b.rotation);
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Every frame of a dodge, as sampled poses. */
function everyFrame(d: Dodge): PoseSample[] {
  return Array.from({ length: d.total + 1 }, (_, f) => at(f, d));
}

describe("the air dodge", () => {
  it("covers the roster: 48 dodges, each with its window inside it", () => {
    expect(DODGES.length).toBe(48);
    for (const d of DODGES) expect(d.window[1], d.name).toBeLessThan(d.total);
  });

  it("is at its most compact while it is intangible, at every length on the roster", () => {
    for (const { name, total, window } of DODGES) {
      const frames = everyFrame({ name, total, window });
      const reaches = frames.map(reach);
      const tightest = reaches.indexOf(Math.min(...reaches));
      expect(tightest, `${name} (${total} frames) peaks its curl on frame ${tightest}`).toBeGreaterThanOrEqual(
        window[0],
      );
      expect(tightest).toBeLessThanOrEqual(window[1]);

      // Curled for the rest of the window rather than at one instant in it. The
      // opening frames are excluded on purpose: intangibility starts on frame 3
      // and the fighter is still winding up, which is true of the real move —
      // being safe and looking safe are a few frames apart.
      const settled = reaches[total];
      for (let f = Math.round((window[0] + window[1]) / 2); f <= window[1]; f++) {
        expect(reaches[f] / settled, `${name}: frame ${f} of ${total} is not curled up`).toBeLessThan(0.8);
      }
    }
  });

  it("opens out through the back half and finishes wider than it started", () => {
    const N = NEUTRAL.total;
    const reaches = everyFrame(NEUTRAL).map(reach);
    const tightest = Math.min(...reaches);

    // Nothing re-compacts once the fighter has begun to uncurl: from halfway to
    // the flail the silhouette only ever grows.
    for (let f = Math.round(N * 0.5); f < Math.round(N * 0.78); f++) {
      expect(reaches[f + 1], `frame ${f + 1} tucked back in`).toBeGreaterThanOrEqual(reaches[f] - 1e-9);
    }

    // The limbs are flung well past where they settle — the uncurl throws them.
    const widest = Math.max(...reaches);
    expect(widest).toBeGreaterThan(reaches[N] * 1.05);
    expect(reaches[N]).toBeGreaterThan(tightest * 1.5);
    expect(reaches[Math.round(N * 0.9)]).toBeGreaterThan(tightest * 1.4);
  });

  it.each(DIRECTIONALS)("turns the body away and brings it all the way back ($name, $total frames)", (d) => {
    const D = d.total;
    const frames = everyFrame(d);
    const turns = frames.map((s) => degrees(s.rotation));
    expect(Math.max(...turns)).toBeGreaterThan(40);

    // The windup goes the other way first — the anticipation the real move has.
    expect(Math.min(...turns.slice(0, Math.round(d.window[1] * 0.3)))).toBeLessThan(-6);

    // And the turn is spent by the end: the clip cuts straight into `fall`, so a
    // fighter still tilted on the last frame snaps upright on the next one.
    expect(Math.abs(turns[D])).toBeLessThan(3);
    expect(Math.abs(turns[Math.round(D * 0.9)])).toBeLessThan(12);
  });

  it("ends in a fall and not in a dodge", () => {
    const N = NEUTRAL.total;
    const end = at(N, NEUTRAL);
    const reaches = everyFrame(NEUTRAL).map(reach);
    const tuck = at(reaches.indexOf(Math.min(...reaches)), NEUTRAL);
    const late = at(Math.round(N * 0.9), NEUTRAL);

    // Nine tenths of the way through, the fighter is already almost the drawing
    // they will be handed off to `fall` as, and nothing like the dodge shape.
    expect(poseDistance(late, end)).toBeLessThan(poseDistance(late, tuck) / 3);

    // Legs hanging rather than gathered, and the body its own size again.
    for (const [thigh, shin] of [
      ["thighR", "shinR"],
      ["thighL", "shinL"],
    ] as const) {
      expect(Math.abs(degrees(angleOf(end, thigh)) - 180)).toBeLessThan(20);
      expect(Math.abs(degrees(angleOf(end, shin)))).toBeLessThan(45);
    }
    expect(Math.abs(end.scaleX - 1)).toBeLessThan(0.08);
    expect(Math.abs(end.scaleY - 1)).toBeLessThan(0.08);
  });

  it.each(DIRECTIONALS)("snaps into the tuck and drifts out of the recovery ($name, $total frames)", (d) => {
    const D = d.total;
    const frames = everyFrame(d);
    const steps = frames.slice(0, -1).map((s, i) => maxBoneStep(s, frames[i + 1]));

    // The fastest frame in the animation is the whip into the tuck, and it is a
    // whip: everything after it is slower, which is the difference between a
    // dodge and its recovery stated as a number.
    const fastest = steps.indexOf(Math.max(...steps));
    expect(fastest, `fastest frame is ${fastest} of ${D}`).toBeLessThan(d.window[1] / 2);
    expect(steps[fastest], "nothing in this clip is fast enough to be a tuck").toBeGreaterThan(12);

    // And once the limbs have been flung out, the last fifth only drifts.
    for (let f = Math.round(D * 0.8); f < D; f++) {
      expect(steps[f], `frame ${f} is still being animated at speed`).toBeLessThan(8);
    }

    // Fast, but never a teleport: no bone crosses a third of a turn in a frame
    // at 60Hz, or the fighter reads as replaced rather than moved.
    expect(Math.max(...steps)).toBeLessThan(32);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(degreesBetween(frames[i].rotation, frames[i + 1].rotation)).toBeLessThan(26);
    }
  });

  // Fast, but never a teleport, at every length (Task 20c fix round: Fox's 38-frame
  // neutral dodge, whose window leaves 12 frames for the recovery, turned a bone 40.9
  // degrees in a frame under plain timing; `airDodgeClipTime` paces it by its motion).
  it("never teleports, at any length on the roster", () => {
    for (const d of DODGES) {
      const frames = everyFrame(d);
      for (let f = 0; f < d.total; f++) {
        expect(maxBoneStep(frames[f], frames[f + 1]), `${d.name}: frame ${f}`).toBeLessThan(32);
        expect(degreesBetween(frames[f].rotation, frames[f + 1].rotation), `${d.name}: frame ${f}`).toBeLessThan(26);
      }
    }
  });

  it("plays Mario's neutral dodge linearly, as it was drawn", () => {
    for (let f = 0; f <= NEUTRAL.total; f++) {
      expect(airDodgeClipTime(f, NEUTRAL.total, NEUTRAL.window[1])).toBeCloseTo(f / NEUTRAL.total, 12);
    }
  });

  it("never stands still for long, at any length on the roster", () => {
    // The bug this replaces was a single frozen pose held for fifty frames. Any
    // stretch of the clip where nothing at all moves is that bug coming back.
    for (const d of DODGES) {
      const { total } = d;
      const frames = everyFrame(d);
      let stillFor = 0;
      let longest = 0;
      for (let f = 0; f < total; f++) {
        const moved =
          maxBoneStep(frames[f], frames[f + 1]) > 0.15 ||
          Math.abs(reach(frames[f]) - reach(frames[f + 1])) > 0.01;
        stillFor = moved ? 0 : stillFor + 1;
        longest = Math.max(longest, stillFor);
      }
      expect(longest, `${d.name} (${total} frames) freezes for ${longest} frames`).toBeLessThan(6);
    }
  });
});
