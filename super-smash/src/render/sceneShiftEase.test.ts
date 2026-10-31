/**
 * The release of a Final Smash's draw shift, eased (Plan 5, Task 17 fix round 3,
 * ruling R-T17o; the re-review 2's N7). A hold lands at once; a release closes
 * over `SCENE_RELEASE_FRAMES` frames instead of in one.
 */
import { describe, expect, it } from "vitest";
import { SCENE_RELEASE_FRAMES, createSceneShiftEase, easeSceneShift } from "./sceneShiftEase";

describe("easing a scene's draw shift (ruling R-T17o)", () => {
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

  it("starts over when time goes back or the fighters change: a rollback or a new match", () => {
    const e = createSceneShiftEase();
    easeSceneShift(e, [-14, 0], 50);
    expect(easeSceneShift(e, [0, 0], 40)).toEqual([0, 0]);
    easeSceneShift(e, [-14, 0], 41);
    expect(easeSceneShift(e, [0, 0, 0], 42)).toEqual([0, 0, 0]);
  });
});
