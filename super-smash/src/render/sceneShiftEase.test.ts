/**
 * The release of a Final Smash's draw shift, eased (Plan 5, Task 17 fix round 3,
 * ruling R-T17o; the re-review 2's N7). A hold lands at once; a release closes
 * over `SCENE_RELEASE_FRAMES` frames instead of in one, and always ends then,
 * however its need falls on the way (fix round 4, ruling R-T17q; the re-review
 * 3's N9).
 */
import { describe, expect, it } from "vitest";
import { SCENE_RELEASE_FRAMES, createSceneShiftEase, easeSceneShift, peekSceneShift } from "./sceneShiftEase";

describe("easing a scene's draw shift (rulings R-T17o and R-T17q)", () => {
  it("takes 6 to 8 frames to let go", () => {
    expect(SCENE_RELEASE_FRAMES).toBeGreaterThanOrEqual(6);
    expect(SCENE_RELEASE_FRAMES).toBeLessThanOrEqual(8);
  });

  it("holds at once: the trap step's back-off, a larger need, and a flip to the other side", () => {
    const e = createSceneShiftEase();
    expect(easeSceneShift(e, [0, 0], 10)).toEqual([0, 0]);
    expect(easeSceneShift(e, [-17, 0], 11)).toEqual([-17, 0]);
    expect(easeSceneShift(e, [-19, 0], 12)).toEqual([-19, 0]);
    expect(easeSceneShift(e, [9, 0], 13)).toEqual([9, 0]);
  });

  it("lets go evenly over its frames, never past the target, whatever the paints' spacing", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-14, 0], 100);
    const seen: number[] = [];
    for (let k = 1; k <= 10; k++) seen.push(easeSceneShift(e, [0, 0], 100 + k)[0]);
    const step = 14 / SCENE_RELEASE_FRAMES;
    seen.forEach((v, k) => expect(v, `frame ${k + 1}`).toBeCloseTo(Math.min(0, -14 + step * (k + 1)), 9));
    // Half-frame paints land on the same path.
    const h = createSceneShiftEase();
    easeSceneShift(h, [-14, 0], 100);
    expect(easeSceneShift(h, [0, 0], 100.5)[0]).toBeCloseTo(-14 + step / 2, 9);
    expect(easeSceneShift(h, [0, 0], 101)[0]).toBeCloseTo(-14 + step, 9);
    // A repaint of the same instant moves nothing.
    expect(easeSceneShift(h, [0, 0], 101)[0]).toBeCloseTo(-14 + step, 9);
  });

  it("eases a part change's smaller need the same way, and a release into a new hold holds at once", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-17, 0], 0);
    expect(easeSceneShift(e, [-10, 0], 1)[0]).toBeCloseTo(-17 + 7 / SCENE_RELEASE_FRAMES, 9);
    expect(easeSceneShift(e, [-16.5, 0], 2)[0]).toBe(-16.5);
  });

  /**
   * A release always ends (fix round 4, ruling R-T17q; the re-review 3's N9): within
   * `SCENE_RELEASE_FRAMES` of the last paint that held, however its target falls on
   * the way. Paints `hz` times a second from `start`, phase `phase` of a paint
   * interval in, each to the target `need(time)`; returns every paint.
   */
  function paintAt(hz: number, phase: number, start: number, end: number, need: (time: number) => number) {
    const e = createSceneShiftEase();
    const out: { time: number; target: number; drawn: number }[] = [];
    for (let k = 0; ; k++) {
      const time = start + (k + phase) * (60 / hz);
      if (time > end) break;
      const target = need(time);
      out.push({ time, target, drawn: easeSceneShift(e, [target, 0], time)[0] });
    }
    return out;
  }
  /** Frames from the last paint that held a shift to the first paint from which it is drawn at home for good; Infinity if it never is. */
  function letGo(paints: ReturnType<typeof paintAt>) {
    const held = paints.filter((p) => p.target !== 0 && p.drawn === p.target).at(-1)!;
    const home = paints.find((p, i) => paints.slice(i).every((q) => q.drawn === 0));
    return home === undefined ? Infinity : home.time - held.time;
  }
  const RATES = [60, 75, 120, 144];
  const PHASES = [0, 1e-9, 0.5];

  it("lets go of a need that falls again on the way, -8 to -7 to 0, 7 frames from its last hold (N9's Team Star Fox)", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-8, 0], 0);
    easeSceneShift(e, [-7, 0], 1);
    const drawn = [2, 3, 4, 5, 6, 7, 8].map((t) => easeSceneShift(e, [0, 0], t)[0]);
    expect(drawn[4], "frame 6").toBeLessThan(0);
    expect(drawn.slice(5), "frames 7 and 8").toEqual([0, 0]);
    // At any refresh rate, the -7 held for two frames first, as Fox's flight hold is.
    for (const hz of RATES) {
      for (const phase of PHASES) {
        const paints = paintAt(hz, phase, 0, 40, (t) => (t < 4 ? -8 : t < 6.3 ? -7 : 0));
        expect(letGo(paints), `${hz} Hz, phase ${phase}`).toBeLessThanOrEqual(SCENE_RELEASE_FRAMES + 60 / hz);
        // Never drawn nearer than the need: it comes back as the victim goes, not before.
        for (const p of paints) expect(Math.abs(p.drawn), `${hz} Hz at ${p.time}`).toBeGreaterThanOrEqual(Math.abs(p.target));
      }
    }
  });

  it("lets go of a need that falls through a step from a first paint barely into it, as a launch's interpolated release does (N9's Kirby and Pikachu)", () => {
    // Held at -6 to frame 100, then falling to 0 across the step to 101, as
    // `sceneShiftAt` measures a victim flying clear between two steps.
    const need = (t: number) => (t <= 100 ? -6 : t >= 101 ? 0 : -6 * (101 - t));
    for (const hz of RATES) {
      for (const phase of PHASES) {
        const paints = paintAt(hz, phase, 90, 400, need);
        expect(letGo(paints), `${hz} Hz, phase ${phase}`).toBeLessThanOrEqual(SCENE_RELEASE_FRAMES + 60 / hz);
        expect(paints.at(-1)!.drawn, `${hz} Hz, phase ${phase}`).toBe(0);
      }
    }
  });

  it("snaps the last small remainder: a need a hair under the shift drawn is drawn as it is", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-6, 0], 0);
    expect(easeSceneShift(e, [-6 + 1e-9, 0], 0.5)[0]).toBe(-6 + 1e-9);
  });

  it("peeks where a release will be drawn, without moving it: for the user's hit sparks (ruling R-T17s)", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-14, 0], 100);
    easeSceneShift(e, [0, 0], 101);
    const step = 14 / SCENE_RELEASE_FRAMES;
    expect(peekSceneShift(e, [0, 0], 103)[0]).toBeCloseTo(-14 + 3 * step, 9);
    // The ease is where it was: the next paint goes on from 101.
    expect(easeSceneShift(e, [0, 0], 102)[0]).toBeCloseTo(-14 + 2 * step, 9);
  });

  it("starts over when the fighters change, and reads a time gone back as the last one: an online stall (R-FW3d)", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-14, 0], 50);
    // As at 50: the release sets out from there, and has not moved yet.
    expect(easeSceneShift(e, [0, 0], 49.5)).toEqual([-14, 0]);
    // A frame past 50, a seventh of the way.
    expect(easeSceneShift(e, [0, 0], 51)[0]).toBeCloseTo(-12, 9);
    expect(easeSceneShift(e, [0, 0, 0], 52)).toEqual([0, 0, 0]);
  });
});
