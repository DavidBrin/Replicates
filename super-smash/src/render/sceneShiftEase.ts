/**
 * The release of a Final Smash's draw shift, eased (Plan 5, Task 17 fix round 3,
 * ruling R-T17o; the Task 17 re-review 2's N7; fix round 4, ruling R-T17q).
 *
 * `sceneShiftAt` says where a scene's user is drawn this paint, off where the sim
 * has it, so that it is never drawn inside the fighter it holds. Taken as it is,
 * the user lurches back to its own place, up to 13 units in one frame, the frame
 * it lets go: the victim is already clear, so nothing on screen explains the move.
 * So a release, and a part change's smaller need, close over
 * `SCENE_RELEASE_FRAMES` frames. Every value on the way keeps the user further off
 * than it needs to be, since the victim is moving away.
 *
 * A release always ends on time (R-T17q; the re-review 3's N9). It is due home
 * `SCENE_RELEASE_FRAMES` after the last paint that held, and each paint closes
 * what is left over the time left, so the rate grows when the need falls further
 * on the way: Team Star Fox's flight hold steps 8 to 7 and then to none, and a
 * launch's victim flies clear between two steps, so the need falls through the
 * paints of one step, from the first paint barely into it. It never latches a
 * rate from the first, perhaps tiny, drop. A remainder under `SCENE_SHIFT_SNAP`
 * snaps.
 *
 * A hold lands at once: the trap step's back-off lands on the hit and its freeze,
 * and easing it in would draw a body inside a body. So does a flip to the other
 * side.
 *
 * Cosmetic state, outside `GameState`, as the camera's is: the match runner keeps
 * one per match, eases once a paint, and hands the result to both drawers
 * (`RenderState.sceneShift`), so the overlay and the 3D model agree.
 *
 * Monotonic in sim time (ruling R-FW3d; the Task 17 re-review 4): online, a tick
 * the session refuses steps nothing, but the loop still takes its frame off the
 * accumulator, so the next paint's time, `state.frame - 1 + alpha`, can be earlier
 * than the last one's. Such a paint is drawn as at the last one's time. Nothing
 * else takes the time back: a rollback hands the runner the newest frame again,
 * and a new match has an ease of its own.
 */

/** Frames a release takes. Presentation choice (the re-review 2's 6 to 8). */
export const SCENE_RELEASE_FRAMES = 7;

/**
 * Units of shift a release lets go of at once: a millionth of a unit, far under a
 * pixel. Without it a float residue between two paints' needs, 1e-11 a step, made
 * a release of its own (the re-review 3's N9). Presentation choice.
 */
export const SCENE_SHIFT_SNAP = 1e-6;

export interface SceneShiftEase {
  /** The shift last drawn, per fighter. */
  shift: number[];
  /** The sim time of the last paint that held, per fighter, while a release is under way; NaN when none is. */
  since: number[];
  /** The sim time last drawn, in frames; NaN before the first paint. */
  time: number;
}

export function createSceneShiftEase(): SceneShiftEase {
  return { shift: [], since: [], time: Number.NaN };
}

/**
 * The shift to draw at sim time `time` (frames, fractional between steps), eased
 * from the last one drawn toward `target` (`sceneShiftAt`'s). A time earlier than
 * the last one drawn is read as that one; the first paint, or a different number
 * of fighters, starts over.
 */
export function easeSceneShift(ease: SceneShiftEase, target: readonly number[], at: number): number[] {
  if (Number.isNaN(ease.time) || ease.shift.length !== target.length) {
    ease.shift = [...target];
    ease.since = target.map(() => Number.NaN);
    ease.time = at;
    return [...target];
  }
  const time = Math.max(at, ease.time);
  const dt = time - ease.time;
  for (let i = 0; i < target.length; i++) {
    const was = ease.shift[i];
    const to = target[i];
    const holds = to !== 0 && (was === 0 || Math.sign(to) !== Math.sign(was) || Math.abs(to) >= Math.abs(was));
    if (holds || Math.abs(was - to) <= SCENE_SHIFT_SNAP) {
      ease.shift[i] = to;
      ease.since[i] = Number.NaN;
      continue;
    }
    // A release sets out from the last paint, which held.
    if (Number.isNaN(ease.since[i])) ease.since[i] = ease.time;
    // Frames left of it as of the last paint (always some: it ends on the paint that
    // reaches them); what is left to close, over them.
    const left = ease.since[i] + SCENE_RELEASE_FRAMES - ease.time;
    const next = dt >= left ? to : was + ((to - was) / left) * dt;
    ease.shift[i] = Math.abs(next - to) <= SCENE_SHIFT_SNAP ? to : next;
    if (ease.shift[i] === to) ease.since[i] = Number.NaN;
  }
  ease.time = time;
  return [...ease.shift];
}

/**
 * Where `easeSceneShift` would draw `target` at `time`, leaving `ease` as it is:
 * for what follows the drawn user between paints, its scene's hit sparks (fix
 * round 4, ruling R-T17s).
 */
export function peekSceneShift(ease: SceneShiftEase, target: readonly number[], time: number): number[] {
  return easeSceneShift({ shift: [...ease.shift], since: [...ease.since], time: ease.time }, target, time);
}
