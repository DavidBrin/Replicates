import { P, type PoseClip } from "./clip";

/**
 * The clip's segments, in clip time, for `rollClipTime` (`groundDodgeTime.ts`),
 * which plays them over each fighter's own frames (Plan 4, Task 9b). Read off
 * the keys below and checked against the sampled drawing on every rig
 * (`roll.test.ts`, on the grid it is drawn on): the furthest point of the
 * fighter from their pelvis is within 1.5% of its smallest from key 7 to grid
 * frame 19, within 3% on frame 20, and over 7% larger by frame 22.
 *
 * - **Startup**, 0 to `duck`: standing out of the shield stance, down to key 3,
 *   the duck, where the fighter is committed and off their feet.
 * - **Evasive**, `duck` to `open`: the tuck. It closes from the duck to the ball
 *   (key 7, `ball`) in `tuckFrames` frames, which `rollClipTime` plays at the
 *   speed it was drawn at whatever the window, and holds shut to `open`, grid
 *   frame 20: the last frame before the opening shows. Key 18 (`t` = 0.58) is
 *   the last of the held ball, but the span out of it is cubic-in, so the ball
 *   is still shut on frame 19 and 20 and is visibly opening by 22. Plan 1's own
 *   window ended there too (4-20).
 * - **Recovery**, `open` to `settle`: the tuck opens, the legs reach for the
 *   floor, the fighter plants and stands, ending on grid frame 30, the last
 *   frame the grid draws (`t` = 1 is the hand-off, never drawn).
 *
 * The evasive segment starts on the duck and not on the ball, where the tuck is
 * shut, or on Plan 1's window start, grid frame 4. Every forward roll's window
 * opens on `actionFrame` 3, and closing the ball in those three frames turns a
 * bone 44.6° in one (Mario's; Plan 1's start, 4, is worse for Fox, 47°; the
 * clip is drawn at 28° at most): the strobe the note on the intangible window
 * below warns about. The duck is the next key back, and on the same footing as
 * the spot dodge's first key: the fighter is committed, and the tuck closes
 * inside the window, as it did in Plan 1's, instead of before it.
 */
export const ROLL_SEGMENTS = {
  duck: 0.097,
  ball: 0.226,
  open: 20 / 31,
  settle: 30 / 31,
  /** Grid frames the tuck takes to close, duck to ball (31 × the keys' distance). */
  tuckFrames: 4,
} as const;

/**
 * Roll — drawn on a 31-frame grid, intangible on 4-20 (Plan 1's shared roll).
 * The engine's rolls are each fighter's own now, forward and back
 * (UltimateFrameData, `groundDodge.ts`; Plan 3 final wave): Mario's are 29 and
 * 34, intangible on `actionFrame` 3-14 and 4-15. `rollClipTime` plays the clip's
 * segments (`ROLL_SEGMENTS`) over the fighter's own frames, the evasive one over
 * exactly its intangible ones, so the keys below are still the grid's and are
 * named by their frames on it.
 *
 * Three beats, because that is what Ultimate shows and because the player on the
 * other side has to be able to read them: a few frames of ducking that are still
 * on the fighter's feet, a tuck held through the intangible window, and ten
 * frames of getting back up. The last of those is the point of the animation.
 * Rolls are punished by watching for the fighter to come apart rather than by
 * watching where they land — the intangibility is long gone before the animation
 * is, and Ultimate widens that gap the more you lean on it, a stale roll running
 * some eight frames longer with its intangibility starting four frames later.
 * Staling is not modelled, so the silhouette carries the whole read: on the
 * grid the ball is shut by frame 6 and visibly opening by frame 22, and 21-30 is
 * a fighter standing up in front of you. Intangibility arriving on 4, two
 * frames before the tuck does, is not a mistake — the fighter is committed and
 * off their feet by then, and closing the tuck any faster costs a bone well
 * over thirty degrees in a single frame, which strobes.
 *
 * The turn is `spin` and not a rotation key, because angles interpolate the
 * short way round and a key at 0 and a key at 360° are the same key. One turn,
 * because it has to be a whole number — anything else leaves the fighter lying
 * down when the state ends — and two turns in half a second is a wheel rather
 * than a somersault.
 *
 * It turns at a constant rate, and both halves of that are worth saying.
 * Easing the keys cannot change it, and neither can the re-timing:
 * `poseSpinFor` integrates `spin` against the roll's own `actionFrame` over its
 * length (`rollTurnTime`), not against the clip time `rollClipTime` makes, so
 * an ease or a re-time moves the pose and leaves the turn exactly where it was.
 * And it should not be changed — the roll's status gives it one velocity for
 * all its frames and `applyMovement` never touches it again, so a constant turn
 * is the rate that rolls without slipping. (The turn and the pose now meet at
 * other phases than on the grid, so the soles stray from the floor a little
 * further, up to a quarter of the fighter's height against a fifth, in the
 * recovery; that is the price of keeping the turn constant, and
 * `groundDodgeTime.test.ts` bounds it.) Redistributing it with a keyframe
 * `rotation` on top would buy a slower commit at the price of a ball skidding
 * over ground it is crossing at a fixed speed. The slow-in and the slow-out
 * are in the pose instead, which is where they belong: what changes at the ends
 * of a roll is the fighter's shape, not how fast they are going round.
 *
 * `offsetY` running out to -2.9 is deliberate and load-bearing. The body turns
 * about `rotationPivot`, 0.45 of a rig height, which is chest height on a
 * standing fighter and nowhere near the middle of a tucked one — so a tuck whose
 * mass sits off that point orbits it instead of rolling along the floor, and the
 * single-key pose this replaced swung its feet through the stage. The tuck is
 * therefore posed onto the pivot (pelvis tipped back, torso folded over it, head
 * curled back down, knees up to meet it) and `offsetY` carries the remainder.
 * What it cannot carry is the rigs disagreeing: the pivot is a fraction of a
 * height that includes the head, so Mario's tuck wants `offsetY` near -2.7 and
 * Kirby's, whose head circle is already centred on his own pivot, wants nearly
 * zero. These numbers split that difference, which is why they are not the ones
 * any single fighter would pick.
 */
export const roll: PoseClip = {
  loop: false,
  spin: 1,
  keys: [
    // f0 — still standing, out of the shield stance.
    {
      t: 0,
      pose: P({
        hip: -4, torso: 18, head: 20,
        thighR: 156, shinR: 54, footR: -84,
        thighL: 188, shinL: 50, footL: -82,
        upperArmR: 116, forearmR: -40,
        upperArmL: 124, forearmL: -44,
      }),
      offsetY: 0.3,
      scaleY: 0.96,
      ease: "in",
    },
    // f3 — the duck.
    {
      t: ROLL_SEGMENTS.duck,
      pose: P({
        hip: -28, torso: 56, head: 56,
        thighR: 124, shinR: 90, footR: -78,
        thighL: 152, shinL: 86, footL: -76,
        upperArmR: 118, forearmR: 0,
        upperArmL: 126, forearmL: -4,
      }),
      offsetY: -0.4,
      scaleX: 1.02,
      scaleY: 0.9,
    },
    // f7 — the ball.
    {
      t: ROLL_SEGMENTS.ball,
      pose: P({
        hip: -60, torso: 105, head: 124,
        thighR: 80, shinR: 156, footR: -70,
        thighL: 88, shinL: 152, footL: -68,
        upperArmR: 125, forearmR: 60,
        upperArmL: 133, forearmL: 56,
      }),
      offsetY: -1.85,
      scaleX: 0.88,
      scaleY: 0.88,
    },
    // f18 — the ball, held.
    {
      t: 0.58,
      pose: P({
        hip: -62, torso: 100, head: 130,
        thighR: 74, shinR: 162, footR: -66,
        thighL: 82, shinL: 158, footL: -64,
        upperArmR: 121, forearmR: 64,
        upperArmL: 129, forearmL: 60,
      }),
      offsetY: -2.9,
      scaleX: 0.87,
      scaleY: 0.87,
      ease: "in",
    },
    // f22 — the tuck opens.
    {
      t: 0.71,
      pose: P({
        hip: -48, torso: 82, head: 100,
        thighR: 100, shinR: 120, footR: -74,
        thighL: 110, shinL: 116, footL: -72,
        upperArmR: 128, forearmR: 40,
        upperArmL: 140, forearmL: 34,
      }),
      offsetY: -2.9,
      scaleX: 0.91,
      scaleY: 0.91,
      ease: "out",
    },
    // f25 — the legs reach out for the floor.
    {
      t: 0.806,
      pose: P({
        hip: -30, torso: 56, head: 66,
        thighR: 120, shinR: 84, footR: -78,
        thighL: 136, shinL: 80, footL: -76,
        upperArmR: 136, forearmR: 4,
        upperArmL: 162, forearmL: -2,
      }),
      offsetY: -2.75,
      scaleX: 0.96,
      scaleY: 0.96,
    },
    // f28 — planted, absorbing.
    {
      t: 0.903,
      pose: P({
        hip: -8, torso: 22, head: 12,
        thighR: 142, shinR: 52, footR: -84,
        thighL: 168, shinL: 48, footL: -80,
        upperArmR: 146, forearmR: -24,
        upperArmL: 186, forearmL: -28,
      }),
      offsetY: -1.1,
      scaleX: 1.05,
      scaleY: 0.94,
      ease: "out",
    },
    // f30 — standing.
    {
      t: 1,
      pose: P({
        hip: 0, torso: 10, head: -6,
        thighR: 170, shinR: 16, footR: -86,
        thighL: 190, shinL: 14, footL: -84,
        upperArmR: 156, forearmR: -22,
        upperArmL: 202, forearmL: -24,
      }),
      offsetY: 0.3,
    },
  ],
};
