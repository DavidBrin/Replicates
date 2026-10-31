/**
 * The release of a Final Smash's draw shift, eased (Plan 5, Task 17 fix round 3,
 * ruling R-T17o; the Task 17 re-review 2's N7).
 *
 * `sceneShiftAt` says where a scene's user is drawn this paint, off where the sim
 * has it, so that it is never drawn inside the fighter it holds. Taken as it is,
 * the user lurches back to its own place, up to 13 units in one frame, the frame
 * it lets go: the victim is already clear, so nothing on screen explains the move.
 * So a release, and a part change's smaller need, close over
 * `SCENE_RELEASE_FRAMES` frames. Every value on the way keeps the user further off
 * than it needs to be, since the victim is moving away.
 *
 * A hold lands at once: the trap step's back-off lands on the hit and its freeze,
 * and easing it in would draw a body inside a body. So does a flip to the other
 * side.
 *
 * Cosmetic state, outside `GameState`, as the camera's is: the match runner keeps
 * one per match, eases once a paint, and hands the result to both drawers
 * (`RenderState.sceneShift`), so the overlay and the 3D model agree.
 */

/** Frames a release takes. Presentation choice (the re-review 2's 6 to 8). */
export const SCENE_RELEASE_FRAMES = 7;

export interface SceneShiftEase {
  /** The shift last drawn, per fighter. */
  shift: number[];
  /** Units a frame the release under way closes at, per fighter; 0 when none is. */
  rate: number[];
  /** The sim time last drawn, in frames; NaN before the first paint. */
  time: number;
}

export function createSceneShiftEase(): SceneShiftEase {
  return { shift: [], rate: [], time: Number.NaN };
}

/**
 * The shift to draw at sim time `time` (frames, fractional between steps), eased
 * from the last one drawn toward `target` (`sceneShiftAt`'s). Time going back, a
 * rollback or a new match, or a different number of fighters starts over.
 */
export function easeSceneShift(ease: SceneShiftEase, target: readonly number[], time: number): number[] {
  const dt = time - ease.time;
  if (!(dt >= 0) || ease.shift.length !== target.length) {
    ease.shift = [...target];
    ease.rate = target.map(() => 0);
    ease.time = time;
    return [...target];
  }
  for (let i = 0; i < target.length; i++) {
    const was = ease.shift[i];
    const to = target[i];
    const holds = to !== 0 && (was === 0 || Math.sign(to) !== Math.sign(was) || Math.abs(to) >= Math.abs(was));
    if (holds || was === to) {
      ease.shift[i] = to;
      ease.rate[i] = 0;
      continue;
    }
    if (ease.rate[i] === 0) ease.rate[i] = Math.abs(was - to) / SCENE_RELEASE_FRAMES;
    const step = ease.rate[i] * dt;
    const next = Math.abs(to - was) <= step ? to : was + Math.sign(to - was) * step;
    ease.shift[i] = next;
    if (next === to) ease.rate[i] = 0;
  }
  ease.time = time;
  return [...ease.shift];
}
