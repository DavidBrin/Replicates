/**
 * The two jumps, checked at the times the renderer actually asks for.
 *
 * `jump` has no fixed duration, so `poseTimeFor` runs both clips over thirty
 * frames and then holds — which is why everything below is sampled through
 * `poseTimeFor` on frames 0..30 rather than at round numbers of `t`. A property
 * that holds at a time no simulation frame lands on is not a property of the
 * animation.
 *
 * The somersault is measured through `poseSpinFor`, not by reading `spin` off
 * the clip: the turn a player sees is the integral of that number over clip
 * time, and it is the only channel that can express a whole revolution.
 */

import { describe, expect, it } from "vitest";

import { BASE_RIG, DRAWN_BONES, resolve, type BoneName, type PoseAngles } from "../skeleton";
import { makeFighter } from "../testFixtures";
import { angleDelta, samplePose, type PoseClip, type PoseSample } from "./clip";
import { fall } from "./fall";
import { doubleJump, rise } from "./rise";
import { poseNameFor, poseSpinFor, poseTimeFor } from "./timing";

const DEG = 180 / Math.PI;

/** Every simulation frame of the clip before `poseTimeFor` starts holding. */
const FRAMES = Array.from({ length: 31 }, (_, f) => f);

function airborne(frame: number, jumpsUsed: number) {
  return makeFighter({ action: "jump", actionFrame: frame, jumpsUsed, grounded: false });
}

function drawings(clip: PoseClip, jumpsUsed: number): PoseSample[] {
  return FRAMES.map((f) => {
    const fighter = airborne(f, jumpsUsed);
    return samplePose(clip, poseTimeFor(poseNameFor(fighter), fighter, 0));
  });
}

/** Whole-body turn on each frame, in degrees, as the renderer applies it. */
function turns(jumpsUsed: number): number[] {
  return FRAMES.map((f) => poseSpinFor(airborne(f, jumpsUsed), 0) * DEG);
}

const first = drawings(rise, 1);
const second = drawings(doubleJump, 2);
const firstTurn = turns(1);
const secondTurn = turns(2);

function bones(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    facing: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
  });
}

/**
 * Head-to-toe length of the drawing, squash included and the whole-body turn
 * deliberately left out — this is how long the *body* is, not how tall it stands
 * on the screen, so it means the same thing upside down as it does upright.
 */
function bodyLength(s: PoseSample): number {
  const b = bones(s);
  let lo = Infinity;
  let hi = -Infinity;
  for (const name of DRAWN_BONES) {
    lo = Math.min(lo, b[name].y0, b[name].y1);
    hi = Math.max(hi, b[name].y0, b[name].y1);
  }
  return hi - lo;
}

/** How far the knee is folded, in degrees. Zero is a straight leg. */
function kneeBend(s: PoseSample): number {
  const b = bones(s);
  return Math.abs(b.shinR.angle - b.thighR.angle) * DEG;
}

/**
 * How far each bone turned between two drawings, in degrees, the short way
 * round — which is the way `samplePose` interpolates. Subtracting the raw
 * angles instead reports the arm that crosses straight up, from 350° to 10°, as
 * having spun 340° in one frame.
 */
function moves(a: PoseAngles, b: PoseAngles): number[] {
  const names = new Set<BoneName>([
    ...(Object.keys(a) as BoneName[]),
    ...(Object.keys(b) as BoneName[]),
  ]);
  return [...names].map((name) =>
    Math.abs(angleDelta(a[name] ?? BASE_RIG[name].angle, b[name] ?? BASE_RIG[name].angle) * DEG),
  );
}

const biggestMove = (a: PoseAngles, b: PoseAngles) => Math.max(0, ...moves(a, b));
const totalMove = (a: PoseAngles, b: PoseAngles) => moves(a, b).reduce((s, d) => s + d, 0);

describe("the second jump against the first", () => {
  it("is a different animation, not the same one played twice", () => {
    expect(doubleJump).not.toBe(rise);
    // Somewhere in the thirty frames the two have to disagree loudly, or the
    // player has no way to tell that the jump has been spent.
    const worst = Math.max(...FRAMES.map((f) => biggestMove(first[f].angles, second[f].angles)));
    expect(worst).toBeGreaterThan(45);
  });

  it("turns the body right over, where the first jump never turns at all", () => {
    expect(Math.max(...firstTurn)).toBe(0);
    expect(Math.max(...secondTurn)).toBeGreaterThanOrEqual(360);
    for (let f = 1; f < FRAMES.length; f++) {
      expect(secondTurn[f], `frame ${f}`).toBeGreaterThan(secondTurn[f - 1]);
    }
  });

  it("finishes the flip square with the world", () => {
    // A fractional turn would hand `fall` a fighter lying on their side, and
    // nothing between the two clips would ever straighten them up.
    expect(Number.isInteger(doubleJump.spin)).toBe(true);
    expect(samplePose(doubleJump, 1).rotation).toBe(0);
    expect(secondTurn[secondTurn.length - 1] % 360).toBeCloseTo(0, 6);
  });
});

describe("the rise", () => {
  it("spends its whole extension in the first few frames", () => {
    // Ultimate's full hop climbs fastest over its opening frames and coasts
    // afterwards; the drawing has to be at its tallest while that is happening.
    const lengths = first.map(bodyLength);
    expect(lengths.indexOf(Math.max(...lengths))).toBeLessThanOrEqual(6);
    // And not merely tallest at one instant: every drawing of the launch is
    // taller than every drawing of the coast.
    expect(Math.min(...lengths.slice(0, 6))).toBeGreaterThan(Math.max(...lengths.slice(15)));
  });

  it("settles out of the stretch and never stretches again", () => {
    const lengths = first.map(bodyLength);
    const peakAt = lengths.indexOf(Math.max(...lengths));
    for (let f = peakAt + 1; f < lengths.length; f++) {
      expect(lengths[f], `frame ${f}`).toBeLessThanOrEqual(lengths[f - 1] + 1e-9);
    }
    expect(lengths[lengths.length - 1]).toBeLessThan(Math.max(...lengths) * 0.9);
  });

  it("has straighter legs at the launch than at the top of the jump", () => {
    const launch = Math.min(...first.slice(0, 8).map(kneeBend));
    expect(launch).toBeLessThan(15);
    expect(kneeBend(first[first.length - 1])).toBeGreaterThan(launch + 20);
  });

  it("never curls up — it is an extension, not a tuck", () => {
    const lengths = first.map(bodyLength);
    for (const [f, len] of lengths.entries()) {
      expect(len, `frame ${f}`).toBeGreaterThanOrEqual(lengths[lengths.length - 1] - 1e-9);
    }
  });
});

describe("the somersault", () => {
  /** Frames between a quarter turn and the start of the kick-out. */
  const inverted = FRAMES.filter((f) => secondTurn[f] > 90 && secondTurn[f] < 210);

  it("is balled up for the whole inverted half of the turn", () => {
    expect(inverted.length).toBeGreaterThan(8);
    const upright = bodyLength(second[second.length - 1]);
    for (const f of inverted) {
      expect(bodyLength(second[f]) / upright, `frame ${f}`).toBeLessThan(0.85);
    }
  });

  it("kicks out on the way back round rather than while still upside down", () => {
    const lengths = second.map(bodyLength);
    const longest = lengths.indexOf(Math.max(...lengths));
    expect(secondTurn[longest]).toBeGreaterThan(240);
    expect(lengths[longest] / Math.min(...lengths)).toBeGreaterThan(1.3);
  });
});

describe("both clips", () => {
  const clips = [
    ["rise", first, firstTurn],
    ["doubleJump", second, secondTurn],
  ] as const;

  it("never teleport a limb between two consecutive frames", () => {
    for (const [name, frames] of clips) {
      for (let f = 1; f < frames.length; f++) {
        expect(
          biggestMove(frames[f - 1].angles, frames[f].angles),
          `${name} frames ${f - 1} to ${f}`,
        ).toBeLessThan(45);
      }
    }
  });

  it("never stop moving", () => {
    // Seventeen of the twenty-one movement clips used to be one frozen pose.
    // Counting the body's own turn is what lets the somersault hold its ball.
    for (const [name, frames, turn] of clips) {
      for (let f = 1; f < frames.length; f++) {
        const moved =
          totalMove(frames[f - 1].angles, frames[f].angles) + Math.abs(turn[f] - turn[f - 1]);
        expect(moved, `${name} frames ${f - 1} to ${f}`).toBeGreaterThan(2);
      }
    }
  });

  it("hand the rise over to the fall wherever the apex lands", () => {
    // Nothing blends between clips: the frame vertical speed crosses zero, the
    // renderer simply starts drawing `fall` instead, and whatever gap is left
    // here is drawn as a jolt. Which frame that is, is the fighter's own
    // `fullHopVelocity / gravity` — frame 18 for Fox and frame 31 for Samus —
    // so the whole tail has to sit near `fall`'s opening drawing, not just the
    // last key.
    const falling = samplePose(fall, 0);
    for (let f = 18; f <= 30; f++) {
      expect(biggestMove(first[f].angles, falling.angles), `frame ${f}`).toBeLessThan(15);
    }
    expect(biggestMove(first[30].angles, falling.angles)).toBeLessThan(6);
    expect(Math.abs(first[30].offsetY - falling.offsetY)).toBeLessThan(0.12);
    expect(Math.abs(first[30].scaleX - falling.scaleX)).toBeLessThan(0.06);
    expect(Math.abs(first[30].scaleY - falling.scaleY)).toBeLessThan(0.06);
  });

  it("land the somersault on that same drawing, once the turn has finished", () => {
    // The flip has to be over before it can match anything, and being over is
    // what the last quarter of the clip is for. A fighter whose air jump runs
    // shorter than the clip is cut off mid-turn and hands `fall` a ball; that
    // is not fixable here, because `poseSpinFor` divides by a flat thirty
    // frames rather than by the rise the fighter actually has.
    const falling = samplePose(fall, 0);
    for (let f = 28; f <= 30; f++) {
      expect(biggestMove(second[f].angles, falling.angles), `frame ${f}`).toBeLessThan(20);
    }
    expect(biggestMove(second[30].angles, falling.angles)).toBeLessThan(6);
    expect(Math.abs(second[30].offsetY - falling.offsetY)).toBeLessThan(0.12);
    expect(Math.abs(second[30].scaleX - falling.scaleX)).toBeLessThan(0.06);
    expect(Math.abs(second[30].scaleY - falling.scaleY)).toBeLessThan(0.06);
  });
});
