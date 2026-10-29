/**
 * Where in its clip a spot dodge or a roll is, on each frame of a fighter's own
 * (Plan 4, Task 9b; ruling R5).
 *
 * Both clips were drawn for Plan 1's shared timing, a 24-frame spot dodge
 * intangible on 3-20 and a 31-frame roll intangible on 4-20, and the engine's
 * dodges have been each fighter's own since Plan 3's final wave
 * (UltimateFrameData, `groundDodge.ts`): Mario's spot dodge is 25 frames,
 * intangible on `actionFrame` 2-16. Played linearly over that length the clip
 * and the intangibility drifted apart, Mario's staying crouched until about
 * frame 21 with his intangibility over on 17. The air dodge had the same
 * trouble and `airDodgeClipTime` fixed it by placing the window's end.
 *
 * These do the same for the two ground dodges, with every segment boundary
 * placed rather than just the end: each clip's startup, evasive and recovery
 * segments (`SPOT_DODGE_SEGMENTS`, `ROLL_SEGMENTS`, found in the clips' keys)
 * are played piecewise linearly over the fighter's frames before, inside and
 * after its intangible window, so
 * - the evasive segment is on exactly the intangible frames: it starts on the
 *   first and ends on the last;
 * - the clip is at its last drawn frame (`settle`) on the last frame the
 *   renderer draws, `total − 1`, and at `t` = 1 on `total`, the hand-off to
 *   the next status (`handOff`), which no frame is drawn on;
 * - the time is strictly increasing, so no pose is held or played backwards.
 *
 * Frames are `actionFrame`s, the air dodge's convention: a published frame N is
 * `actionFrame` N − 1, so a window UFD gives as a-b is `actionFrame` a − 1 to
 * b − 1 (`dodgeIntangible`). Render only: the simulation never reads this.
 */

import { ROLL_SEGMENTS } from "./roll";
import { SPOT_DODGE_SEGMENTS } from "./spotDodge";

type Anchor = readonly [frame: number, time: number];

/** Plain `frame / total`, clamped to the clip: what a window that cannot be placed plays. */
function linearTime(frame: number, total: number): number {
  return total <= 0 ? 0 : Math.min(1, Math.max(0, frame / total));
}

/**
 * Whether the window can be placed in a dodge `total` frames long: it starts after the entry frame,
 * runs forward, and ends before the last frame drawn, which has recovery frames of its own.
 */
function fits(total: number, first: number, last: number): boolean {
  return first > 0 && last > first && last < total - 1;
}

/** The clip time at `frame`, piecewise linear through `anchors` (increasing in both) and exact on each. */
function through(frame: number, total: number, anchors: readonly Anchor[]): number {
  const f = Math.min(total, Math.max(0, frame));
  for (let i = 1; i < anchors.length; i++) {
    const [f1, t1] = anchors[i];
    if (f > f1) continue;
    if (f === f1) return t1;
    const [f0, t0] = anchors[i - 1];
    return t0 + ((t1 - t0) * (f - f0)) / (f1 - f0);
  }
  return 1;
}

/**
 * Clip time for `actionFrame` `frame` of a spot dodge `total` frames long whose
 * intangibility runs `first` to `last` (`dodgeIntangible`). The clip's startup
 * (the snap down) covers the frames before the window, its evasive segment (the
 * compress to the tell) the window, and its recovery the rest, ending on the
 * last drawn frame, `total − 1`.
 */
export function spotDodgeClipTime(frame: number, total: number, first: number, last: number): number {
  if (total <= 0) return 0;
  if (!fits(total, first, last)) return linearTime(frame, total);
  const { evasive, settle } = SPOT_DODGE_SEGMENTS;
  return through(frame, total, [[0, 0], [first, evasive[0]], [last, evasive[1]], [total - 1, settle], [total, 1]]);
}

/**
 * Clip time for `actionFrame` `frame` of a roll `total` frames long whose
 * intangibility runs `first` to `last`, the same way: the duck on the frames
 * before the window, the tuck over it, the opening and the stand after.
 *
 * Inside the window the tuck closes from the duck to the ball at the speed it was
 * drawn at, `ROLL_SEGMENTS.tuckFrames` frames, and is then held shut to the
 * window's end. Playing the whole segment linearly would close the tuck in a
 * short window faster than a bone may turn in a frame (Fox's forward roll is
 * intangible on 9 frames and would turn one 37° in a frame, against the 28° the
 * clip is drawn at). Only the held part, which does not move, stretches or
 * shortens to fit.
 */
export function rollClipTime(frame: number, total: number, first: number, last: number): number {
  if (total <= 0) return 0;
  if (!fits(total, first, last)) return linearTime(frame, total);
  const { duck, ball, open, settle, tuckFrames } = ROLL_SEGMENTS;
  // A window too short to close the tuck in leaves half of it to hold.
  const closed = first + Math.min(tuckFrames, (last - first) / 2);
  return through(frame, total, [[0, 0], [first, duck], [closed, ball], [last, open], [total - 1, settle], [total, 1]]);
}

/**
 * How far round a roll's single turn has gone, 0 to 1: its own `actionFrame` over its length.
 *
 * Not the clip time. The roll's velocity is one value for every frame
 * (`applyMovement` never touches it), and a constant turn is the rate that
 * rolls without slipping, so `poseSpinFor` integrates the turn against this and
 * leaves the re-timed pose to `rollClipTime`.
 */
export function rollTurnTime(frame: number, total: number): number {
  return linearTime(frame, total);
}
