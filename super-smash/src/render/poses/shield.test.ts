/**
 * What these tests are for.
 *
 * Restating the keyframes back — `keys[1].t === 0.45` — would pass forever and
 * catch nothing, because the numbers in `shield.ts` are not the claims the clip
 * makes. The claims are that a shielding fighter is *smaller* than a standing
 * one, that his feet are on the floor on every rig and not a unit under it,
 * that a shield held for four seconds never becomes a photograph, that the
 * fighter is visibly out of the shield before the parry window closes on frame
 * 5, and that frame 10 hands over to `stand` without a cut. Each of those is
 * measured here against the geometry the renderer actually resolves.
 *
 * `idle` is the reference throughout, and deliberately so: it is what the
 * shield is compared against on screen, it is what `shieldRelease` hands over
 * to, and it is maintained by somebody else — so these tests are also what
 * notices if the seam between the two clips comes apart.
 */

import { describe, expect, it } from "vitest";

import { BASE_RIG, BONE_NAMES, DRAWN_BONES, resolve, type BoneName, type Rig } from "../skeleton";
import { getCharacterRig } from "../characterArt";
import { samplePose, type PoseSample } from "./clip";
import { idle } from "./idle";
import { shield, shieldRelease } from "./shield";

/** The three rigs that bracket the roster: average legs, longest, shortest. */
const RIGS: readonly [string, Rig][] = ["mario", "donkeykong", "kirby"].map((id) => [
  id,
  getCharacterRig(id).bones,
]);

const SHIELD_PERIOD = shield.period ?? 30;
const RELEASE_FRAMES = 11;
const PERFECT_SHIELD_WINDOW = 5;

/**
 * The frame times the renderer actually samples at.
 *
 * `poseTimeFor` gives a looping clip `wrap(actionFrame / period)` and a
 * fixed-length one `actionFrame / duration`, so these are every value either
 * clip is ever asked for — nothing in between is ever drawn.
 */
const holdFrames = Array.from({ length: SHIELD_PERIOD }, (_, f) => samplePose(shield, f / SHIELD_PERIOD));
const releaseFrames = Array.from({ length: RELEASE_FRAMES }, (_, f) =>
  samplePose(shieldRelease, f / RELEASE_FRAMES),
);
const idleFrames = Array.from({ length: idle.period ?? 30 }, (_, f) =>
  samplePose(idle, f / (idle.period ?? 30)),
);

interface Geom {
  /** Highest and lowest drawn pixel, capsule thickness included, ground line at 0. */
  readonly crown: number;
  readonly sole: number;
  readonly hip: number;
  /** Ankle and toe heights, near and far. */
  readonly ankle: readonly [number, number];
  readonly toe: readonly [number, number];
}

/** Resolve a sampled pose on a rig and measure what the eye can see of it. */
function geom(s: PoseSample, rig: Rig): Geom {
  const sk = resolve(rig, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  let crown = -Infinity;
  let sole = Infinity;
  for (const n of DRAWN_BONES) {
    const b = sk[n];
    const r = b.thickness / 2;
    for (const y of [-b.y0, -b.y1]) {
      crown = Math.max(crown, y + s.offsetY + r);
      sole = Math.min(sole, y + s.offsetY - r);
    }
  }
  return {
    crown,
    sole,
    hip: s.offsetY + -sk.hip.y1,
    ankle: [s.offsetY + -sk.shinR.y1, s.offsetY + -sk.shinL.y1],
    toe: [s.offsetY + -sk.footR.y1, s.offsetY + -sk.footL.y1],
  };
}

/** A bone's angle in degrees, falling back to the rest angle as `resolve` does. */
function angle(s: PoseSample, bone: BoneName): number {
  return ((s.angles[bone] ?? BASE_RIG[bone].angle) * 180) / Math.PI;
}

/** Total angular change across the whole body between two poses, in degrees. */
function travel(a: PoseSample, b: PoseSample): number {
  return BONE_NAMES.reduce((sum, n) => sum + Math.abs(angle(b, n) - angle(a, n)), 0);
}

function biggestJoint(a: PoseSample, b: PoseSample): number {
  return Math.max(...BONE_NAMES.map((n) => Math.abs(angle(b, n) - angle(a, n))));
}

const clips: readonly [string, PoseSample[]][] = [
  ["shield", holdFrames],
  ["shieldRelease", releaseFrames],
];

describe("the guard", () => {
  it("is smaller than standing — the one thing the bubble does not cover", () => {
    for (const [id, rig] of RIGS) {
      const standing = Math.min(...idleFrames.map((s) => geom(s, rig).crown));
      const tallest = Math.max(...holdFrames.map((s) => geom(s, rig).crown));
      // A shielding fighter is gathered, not merely bent — and as a fraction,
      // because Kirby is half Mario's height and an absolute margin would be a
      // different claim on each rig.
      expect((standing - tallest) / standing, id).toBeGreaterThan(0.08);
      const lowestHip = Math.min(...idleFrames.map((s) => geom(s, rig).hip));
      expect(Math.max(...holdFrames.map((s) => geom(s, rig).hip)), id).toBeLessThan(lowestHip - 0.6);
    }
  });

  it("never freezes, however long the shield is held", () => {
    // Four seconds of holding, which is most of a full shield's 5.6-second
    // life. `actionFrame` runs unbounded and the clip loops, so this walks the
    // cycle round nearly six times.
    const held = Array.from({ length: 240 }, (_, f) => samplePose(shield, f / SHIELD_PERIOD));
    for (let f = 0; f + 20 < held.length; f++) {
      // No twenty-frame window anywhere in the hold is a still drawing.
      expect(travel(held[f], held[f + 20]), `frames ${f}..${f + 20}`).toBeGreaterThan(2);
    }
  });

  it("is at its most compressed on the frame a hit lands", () => {
    // `shieldStart` and `shieldStun` both restart `actionFrame` at 0, so t = 0
    // is the drawing a raised shield snaps to and the one every hit on the
    // shield returns it to. It has to be the brace, not an arbitrary phase.
    for (const [id, rig] of RIGS) {
      const crowns = holdFrames.map((s) => geom(s, rig).crown);
      expect(crowns[0], id).toBeCloseTo(Math.min(...crowns), 5);
      // And it is a brace worth seeing: the cycle has real amplitude rather
      // than a jitter that reads as a static pose.
      expect(Math.max(...crowns) - crowns[0], id).toBeGreaterThan(0.25);
    }
  });
});

describe("planting", () => {
  it.each(clips)("keeps %s's soles on the floor on every rig", (_name, frames) => {
    for (const [id, rig] of RIGS) {
      const planted = geom(idleFrames[0], rig).sole;
      for (const [f, s] of frames.entries()) {
        // One shared clip cannot land three different leg lengths on the same
        // line exactly; a fifth of a unit is under a pixel at match zoom, where
        // the shield pose it replaced was a whole unit under the floor.
        expect(geom(s, rig).sole - planted, `${id} frame ${f}`).toBeGreaterThan(-0.2);
        expect(geom(s, rig).sole - planted, `${id} frame ${f}`).toBeLessThan(0.2);
      }
    }
  });

  it.each(clips)("keeps %s's soles flat, so shoe length costs no depth", (_name, frames) => {
    for (const [id, rig] of RIGS) {
      for (const [f, s] of frames.entries()) {
        const g = geom(s, rig);
        // A flat foot puts the toe at the ankle's height whatever the foot bone
        // is long, which is what stops one set of angles burying Donkey Kong
        // and floating Kirby.
        expect(Math.abs(g.toe[0] - g.ankle[0]), `${id} near foot, frame ${f}`).toBeLessThan(0.25);
        expect(Math.abs(g.toe[1] - g.ankle[1]), `${id} far foot, frame ${f}`).toBeLessThan(0.25);
      }
    }
  });
});

describe("dropping shield", () => {
  it("starts from where the hold left off, so the cut is invisible", () => {
    // Frame 0 is drawn a frame after `shield`'s clip was, at whatever phase of
    // the cycle the button came up on. Every joint has to be inside the range
    // the guard occupies or the drop begins with a pop.
    for (const n of BONE_NAMES) {
      const held = holdFrames.map((s) => angle(s, n));
      const a = angle(releaseFrames[0], n);
      expect(a, n).toBeGreaterThan(Math.min(...held) - 3);
      expect(a, n).toBeLessThan(Math.max(...held) + 3);
    }
  });

  it("is out of the shield before the parry window closes", () => {
    for (const [id, rig] of RIGS) {
      const guard = Math.max(...holdFrames.map((s) => geom(s, rig).crown));
      // The bottom of `idle`'s breath — the height the clip's own comment calls
      // the height a fighter always is.
      const standing = Math.min(...idleFrames.map((s) => geom(s, rig).crown));
      const lastParryFrame = geom(releaseFrames[PERFECT_SHIELD_WINDOW - 1], rig);
      // The fighter has grown clear out of the guard's silhouette...
      expect((lastParryFrame.crown - guard) / guard, id).toBeGreaterThan(0.1);
      // ...and is past standing height, which is the overshoot that says the
      // shield was dropped on purpose rather than allowed to expire.
      expect(lastParryFrame.crown, id).toBeGreaterThan(standing);
    }
  });

  it("commits in the parry window rather than ambling through it", () => {
    const step = releaseFrames.slice(1).map((s, i) => travel(releaseFrames[i], s));
    const window = step.slice(0, PERFECT_SHIELD_WINDOW - 1);
    const tail = step.slice(PERFECT_SHIELD_WINDOW - 1);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Frames 0–4 are the five that parry; 5–10 are drop lag the fighter cannot
    // act out of. The body should be moving markedly harder in the first.
    expect(mean(window)).toBeGreaterThan(mean(tail) * 1.5);
    // And the single busiest frame of the clip belongs to the window.
    expect(Math.max(...window)).toBeGreaterThan(Math.max(...tail));
  });

  it("never whips a joint", () => {
    // Arms throwing a guard open are allowed to be quick; nothing is allowed to
    // be quicker than an arm.
    for (let f = 1; f < releaseFrames.length; f++) {
      expect(biggestJoint(releaseFrames[f - 1], releaseFrames[f]), `frame ${f}`).toBeLessThan(75);
    }
    // The feet are the specific trap. They are the only bones the guard could
    // plausibly want turned a long way from where standing leaves them, and a
    // clip that does that has to spend the drop unwinding it — so they start
    // within half a right angle of `idle` and stay there.
    for (const foot of ["footR", "footL"] as BoneName[]) {
      const rest = angle(idleFrames[0], foot);
      for (const [f, s] of releaseFrames.entries()) {
        expect(Math.abs(angle(s, foot) - rest), `${foot} frame ${f}`).toBeLessThan(90);
      }
      for (const [f, s] of holdFrames.entries()) {
        expect(Math.abs(angle(s, foot) - rest), `${foot} hold frame ${f}`).toBeLessThan(90);
      }
    }
  });

  it("hands over to stand without a cut", () => {
    const last = releaseFrames[releaseFrames.length - 1];
    // `poseTimeFor` divides by SHIELD_RELEASE_FRAMES, so frame 10 is the last
    // drawing this clip ever produces — the next one belongs to `idle`, at
    // whatever phase of the breath the global frame happens to be at.
    for (const n of BONE_NAMES) {
      const worst = Math.max(...idleFrames.map((s) => Math.abs(angle(s, n) - angle(last, n))));
      expect(worst, n).toBeLessThan(6);
    }
    for (const [id, rig] of RIGS) {
      const g = geom(last, rig);
      expect(Math.abs(g.sole - geom(idleFrames[0], rig).sole), id).toBeLessThan(0.05);
      expect(Math.abs(g.crown - geom(idleFrames[0], rig).crown), id).toBeLessThan(0.05);
    }
  });
});
