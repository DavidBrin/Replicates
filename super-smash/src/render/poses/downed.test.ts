/**
 * What these two clips have to be true about.
 *
 * Angles are not asserted — a test that restates the numbers in the clip only
 * proves they were copied twice. What is asserted is what a viewer would
 * notice: that the body leaves the floor and arrives standing, that it joins
 * `idle` without a jump, that nothing travels far enough between two frames to
 * pop, and that no bone is under the stage on any of the eight rigs. The last
 * one is the reason this file resolves whole skeletons rather than reading
 * keyframes: `downed` and `getUp` are held flat by a whole-body rotation about
 * a pivot that scales with rig height, so where a limb ends up is a fact about
 * the fighter and not about the pose.
 */

import { describe, expect, it } from "vitest";
import { BONE_NAMES, DRAWN_BONES, rigHeight, resolve, type BoneName, type Rig } from "../skeleton";
import { samplePose, type PoseClip, type PoseSample } from "./clip";
import { getCharacterRig } from "../characterArt";
import { idle } from "./idle";
import { downed, getUp } from "./downed";

/** `DOWNED_FRAMES` / `GETUP_FRAMES`, and what `poseTimeFor` divides by. */
const DOWNED_FRAMES = 40;
const GETUP_FRAMES = 30;

/** Every rig `CHARACTER_RIGS` can hand out, by the ids the roster uses. */
const RIGS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"] as const;

/** The clip time the renderer asks for on simulation frame `f`. */
function at(clip: PoseClip, f: number, total: number): PoseSample {
  return samplePose(clip, Math.min(1, f / total));
}

function frames(clip: PoseClip, total: number): PoseSample[] {
  return Array.from({ length: total + 1 }, (_, f) => at(clip, f, total));
}

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function angleOf(s: PoseSample, rig: Rig, bone: BoneName): number {
  return s.angles[bone] ?? rig[bone].angle;
}

/** Largest angle any one bone moves between two samples, in degrees. */
function step(a: PoseSample, b: PoseSample, rig: Rig): number {
  let worst = 0;
  for (const n of BONE_NAMES) {
    let d = Math.abs(degrees(angleOf(b, rig, n) - angleOf(a, rig, n))) % 360;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return Math.max(worst, Math.abs(degrees(b.rotation - a.rotation)));
}

/**
 * Heights above the stage, in rig units, posed exactly as the renderer poses:
 * whole-body rotation about `rigHeight * 0.45`, `offsetY` applied outside the
 * scale. Ground is zero and up is positive, so a negative number is under the
 * stage.
 */
function heights(s: PoseSample, id: string) {
  const r = getCharacterRig(id);
  const sk = resolve(r.bones, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: rigHeight(r.bones, r.headRadius) * 0.45,
  });
  const axis = (n: BoneName) => s.offsetY + -sk[n].y1;
  let lowestAxis = Infinity;
  let where: BoneName = "root";
  for (const n of DRAWN_BONES) {
    for (const y of [sk[n].y0, sk[n].y1]) {
      const h = s.offsetY + -y;
      if (h < lowestAxis) {
        lowestAxis = h;
        where = n;
      }
    }
  }
  return { lowestAxis, where, foot: Math.min(axis("footL"), axis("footR")), crown: axis("head") };
}

/**
 * A bone axis at zero means the capsule is half in the stage — which is how
 * every standing fighter's boots are already drawn, so it is the floor this
 * animation is allowed to reach and not a hair further.
 */
const UNDERGROUND = -0.55;

describe("downed", () => {
  it("arrives with an impact and then keeps settling", () => {
    const f = frames(downed, DOWNED_FRAMES);
    const rig = getCharacterRig("mario").bones;

    // The contact frame is the lowest and the most compressed of the clip.
    const low = f.map((s) => heights(s, "mario").crown);
    expect(low[0]).toBe(Math.min(...low));
    expect(f[0].scaleY).toBeLessThan(0.96);

    // It rebounds off that frame rather than easing down onto the floor.
    expect(low[4]).toBeGreaterThan(low[0] + 0.5);

    // And it is never a held drawing: after the limbs have flopped down, the
    // body still travels several degrees before the state hands over.
    const settled = f.slice(12);
    const drift = Math.max(...settled.map((s) => step(f[12], s, rig)));
    expect(drift).toBeGreaterThan(4);
  });

  it("settles rather than acts", () => {
    const rig = getCharacterRig("mario").bones;
    const f = frames(downed, DOWNED_FRAMES);
    const steps = f.slice(1).map((s, i) => step(f[i], s, rig));
    const up = frames(getUp, GETUP_FRAMES);
    const upSteps = up.slice(1).map((s, i) => step(up[i], s, rig));

    // A body arriving on the floor and a body pushing off it are not the same
    // kind of motion, and the recoil should be visibly the slower of the two.
    expect(Math.max(...steps)).toBeLessThan(Math.max(...upSteps) * 0.75);
    // And after the settle nothing moves faster than a couple of degrees a
    // frame, which is a breath rather than an action.
    expect(Math.max(...steps.slice(12))).toBeLessThan(2.5);
  });

  it("lies down rather than standing up", () => {
    for (const id of RIGS) {
      for (const s of frames(downed, DOWNED_FRAMES)) {
        // Flat: the crown is nearer the stage than the fighter is tall.
        const r = getCharacterRig(id);
        expect(heights(s, id).crown).toBeLessThan(rigHeight(r.bones, r.headRadius) * 0.4);
      }
    }
  });
});

describe("getUp", () => {
  it("starts exactly where downed left off", () => {
    const end = at(downed, DOWNED_FRAMES, DOWNED_FRAMES);
    const start = at(getUp, 0, GETUP_FRAMES);
    const rig = getCharacterRig("mario").bones;
    expect(step(end, start, rig)).toBeLessThan(0.001);
    expect(start.offsetY).toBeCloseTo(end.offsetY, 6);
  });

  it("carries the body from flat to upright", () => {
    const f = frames(getUp, GETUP_FRAMES);
    const rot = f.map((s) => degrees(s.rotation));

    expect(rot[0]).toBeLessThan(-80);
    expect(rot[GETUP_FRAMES]).toBeCloseTo(0, 6);

    // Most of the turn is spent by the time the fighter is on their feet, and
    // what is left is an overshoot past vertical rather than more of the same.
    expect(Math.abs(rot[Math.round(GETUP_FRAMES * 0.6)])).toBeLessThan(10);
    expect(Math.max(...rot)).toBeGreaterThan(0);
    expect(Math.max(...rot)).toBeLessThan(8);

    // It rises: never turning back toward the floor by more than the overshoot.
    for (let i = 1; i <= GETUP_FRAMES; i++) expect(rot[i]).toBeGreaterThan(rot[i - 1] - 1);
  });

  it("ends standing, on every rig", () => {
    for (const id of RIGS) {
      const r = getCharacterRig(id);
      const tall = rigHeight(r.bones, r.headRadius);
      const start = heights(at(getUp, 0, GETUP_FRAMES), id);
      const end = heights(at(getUp, GETUP_FRAMES, GETUP_FRAMES), id);
      // Flat at the start — the crown is barely off the stage…
      expect(start.crown).toBeLessThan(tall * 0.4);
      // …and at the end it is where the standing rig puts it.
      expect(end.crown).toBeCloseTo(tall - r.headRadius, 1);
    }
  });

  it("joins the idle loop it hands over to", () => {
    const rig = getCharacterRig("mario").bones;
    const last = at(getUp, GETUP_FRAMES, GETUP_FRAMES);

    // `idle` runs off the global frame, so the handover can land on any phase
    // of the breath and there is no single pose to match. What matters is that
    // the whole loop is close: the worst phase has to be inside what
    // `BLEND_FRAMES` can absorb, and the nearest one all but exact.
    const loop = Array.from({ length: 108 }, (_, f) => step(last, samplePose(idle, f / 108), rig));
    expect(Math.min(...loop)).toBeLessThan(3);
    expect(Math.max(...loop)).toBeLessThan(9);

    expect(last.offsetY).toBeCloseTo(0, 6);
    expect(last.rotation).toBeCloseTo(0, 6);
    expect(last.scaleX).toBeCloseTo(1, 6);
    expect(last.scaleY).toBeCloseTo(1, 6);

    // `poseTimeFor` never reaches t = 1, so the frame actually drawn last has
    // to be close enough that the blend can absorb the rest of it too.
    const drawn = at(getUp, GETUP_FRAMES - 1, GETUP_FRAMES);
    expect(step(drawn, last, rig)).toBeLessThan(12);
  });

  it("has the shape of a push and not of a slider being dragged", () => {
    const f = frames(getUp, GETUP_FRAMES);
    const rig = getCharacterRig("mario").bones;
    const steps = f.slice(1).map((s, i) => step(f[i], s, rig));
    const fastest = steps.indexOf(Math.max(...steps));

    // Nothing crosses more of a circle between two frames than an eye can
    // follow — 30 degrees at 60Hz is already 1800 a second, a hard kick.
    expect(Math.max(...steps)).toBeLessThan(30);

    // The clip is fastest in its middle, where the coil unloads. A clip whose
    // fastest frame is at either end is a linear interpolation with keys.
    expect(fastest).toBeGreaterThan(GETUP_FRAMES * 0.15);
    expect(fastest).toBeLessThan(GETUP_FRAMES * 0.6);

    // And it starts from a held drawing: two frames of still floor is the beat
    // that says the fighter has not moved yet, and it is an order of magnitude
    // stiller than the push it turns into.
    const held = Math.max(...steps.slice(0, 2));
    expect(held).toBeLessThan(2);
    expect(Math.max(...steps)).toBeGreaterThan(10 * held);
  });
});

describe("the stage is solid", () => {
  it("holds every bone above it, on every rig, in both clips", () => {
    for (const id of RIGS) {
      for (const [clip, total] of [
        [downed, DOWNED_FRAMES],
        [getUp, GETUP_FRAMES],
      ] as const) {
        for (const [i, s] of frames(clip, total).entries()) {
          const { lowestAxis, where } = heights(s, id);
          expect(`${id} f${i} ${where} ${lowestAxis.toFixed(2)}`).toBe(
            `${id} f${i} ${where} ${Math.max(lowestAxis, UNDERGROUND).toFixed(2)}`,
          );
        }
      }
    }
  });

  it("plants the feet for the whole standing half of getUp", () => {
    for (const id of RIGS) {
      for (let f = Math.round(GETUP_FRAMES * 0.55); f <= GETUP_FRAMES; f++) {
        const { foot } = heights(at(getUp, f, GETUP_FRAMES), id);
        expect(Math.abs(foot)).toBeLessThan(0.6);
      }
    }
  });
});
