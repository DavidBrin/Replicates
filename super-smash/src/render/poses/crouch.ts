import { P, type PoseClip } from "./clip";

/**
 * Crouching: the settle, the descent into it, and the rise back out.
 *
 * Crouching in Ultimate is a defensive option and not just a smaller hurtbox.
 * A crouched fighter crouch-cancels: the hit lands for 0.85x knockback and
 * 0.67x hitlag — `HITLAG_CROUCH_CANCEL` is that 0.67 — and Ultimate's change
 * from every earlier Smash is that the *attacker's* hitlag is cut by the same
 * factor. The defender no longer leaves hitlag first, which is exactly the
 * frame advantage the technique was famous for in Melee, and is why it is now
 * situational rather than universal. What that means for the drawing: whether
 * the opponent is crouched changes what both players should do next, so the
 * crouched shape has to be legible in a single frame at 1/12th of the screen,
 * not merely a bit shorter.
 *
 * ## Why the fold has to pay for the drop
 *
 * `root` is a rigid strut from the feet to the pelvis, so no pose can lower the
 * hips. Only `offsetY` can, and `offsetY` slides the feet down with everything
 * else. The placeholder spent 1.55 units of it against a fold worth about half
 * that, and stood every fighter about four fifths of a unit into the stage —
 * for as long as the player held down.
 *
 * `scaleY` is the lever that does not have this problem, and it is the reason
 * the numbers below look the way they do. Squash scales about the feet, so the
 * soles stay where they are and only the body above them compresses: a crouch
 * built out of squash costs nothing in ground contact, where the same depth
 * bought with `offsetY` has to be repaid by folding the legs, and the fold
 * repays it *in proportion to leg length*. Since `offsetY` is an absolute
 * number shared by rigs whose legs run from Pikachu's 2.3 units to Marth's
 * 4.76, every unit of it spreads the roster's feet apart by about a third of a
 * unit. So the depth here comes from 0.80 squash and a 46-degree fold, and only
 * 0.77 units of translation — a quarter of what a squash-free version of the
 * same crouch would need, and the roster lands within a third of a unit of
 * where standing leaves it instead of within two thirds.
 *
 * The feet are flat for the same reason, and flat here means a *constant
 * accumulated* angle: both boots hold the ~92 degrees that rests them on the
 * stage, which is why `footR` and `footL` swing by more than a hundred degrees
 * across these clips while never leaving the floor. A pointed foot instead
 * spends the difference between Kirby's 1.6-unit boot and the reference 1.0 on
 * depth; a flat one spends it on shoe length, where nobody can see it.
 *
 * Depth itself is a compromise the real game does not have to make. Ultimate
 * gives every fighter their own crouch and they differ enormously — Kirby and
 * Sheik are on the floor, Bowser and Meta Knight barely move — but eight rigs
 * share this clip, so it is tuned to about 77% of standing height on the middle
 * of the roster. Kirby comes out shallowest at 81% because four fifths of his
 * height is a head circle that cannot compress.
 */

/** Frames in the crouch's breathing cycle. */
const BREATH = 84;

/**
 * The settled crouch, and it loops — a held crouch is not a held drawing.
 *
 * Every fighter in Ultimate has a crouch idle of their own that replays for as
 * long as the crouch is held; Dedede rests a hand on his head. It has to loop
 * here for a plainer reason: crouch is the one state a player can sit in
 * indefinitely — waiting out an approach, holding for the crouch cancel — so it
 * is the state where a single frozen drawing is exposed for longest.
 *
 * 1.4 seconds against idle's 1.8, so a fighter who crouches never falls into
 * step with one who is standing. The amplitude is tiny and the two arms drift
 * against each other rather than together, which is idle's trick and the reason
 * a two-key breath does not read as a pulse. Small also because `crouchEnd`
 * cuts in from whatever phase the player happens to release down on, and
 * nothing interpolates between clips.
 */
export const crouch: PoseClip = {
  loop: true,
  period: BREATH,
  keys: [
    {
      t: 0,
      pose: P({
        hip: -3.4, torso: 13.8, head: -11.1,
        thighR: 131.8, shinR: 91, footR: -126.8,
        thighL: 140.5, shinL: 85, footL: -129.5,
        upperArmR: 159.9, forearmR: -7.5,
        upperArmL: 197.8, forearmL: -23.4,
      }),
      offsetY: -0.77, scaleX: 1.1, scaleY: 0.8,
    },
    // The chest opens, the knees give back three degrees and the weight comes
    // up six hundredths of a unit. Read against the key above, one breath.
    {
      t: 0.5,
      pose: P({
        hip: -3, torso: 12.9, head: -10.4,
        thighR: 133.5, shinR: 87.6, footR: -125.2,
        thighL: 142.2, shinL: 81.6, footL: -127.8,
        upperArmR: 161.4, forearmR: -10,
        upperArmL: 196.6, forearmL: -21.5,
      }),
      offsetY: -0.72, scaleX: 1.096, scaleY: 0.808,
    },
  ],
};

/**
 * The descent, five frames.
 *
 * `poseTimeFor` divides `actionFrame` by `CROUCH_START_FRAMES`, so the renderer
 * only ever asks for 0, 0.2, 0.4, 0.6 and 0.8. It never asks for 1: on the
 * frame that would reach it the fighter is already in `crouch`. Hence keys at
 * 0, 0.4 and 0.8 — three of the five frames are keys and the other two are the
 * eased midpoints between them.
 *
 * Dropping into a crouch is a release rather than a push: the knees give and
 * gravity does the work. So the middle key is already 10% past where the crouch
 * settles and the clip comes back up to it, which is the difference between a
 * fighter arriving with weight and a slider being dragged. Frame 0 is not the
 * standing pose — five frames cannot spare one repeating the frame before it —
 * it is the knees unlocking, which is all the anticipation there is room for.
 *
 * The three groups run on their own schedules, and that is what makes this read
 * as a body rather than as a shape being scaled: the legs go first and
 * overshoot, the spine folds a beat behind them, and the arms are last and are
 * still catching up on the final frame.
 */
export const crouchStart: PoseClip = {
  loop: false,
  keys: [
    // The break. Knees unlocked, weight already off the heels, everything above
    // the hips still standing.
    {
      t: 0,
      pose: P({
        hip: -0.1, torso: 5.3, head: -5.2,
        thighR: 168.1, shinR: 19.6, footR: -93.4,
        thighL: 176.2, shinL: 11.9, footL: -93.8,
        upperArmR: 164, forearmR: 19,
        upperArmL: 193, forearmL: -18,
      }),
      offsetY: -0.02, scaleX: 1.014, scaleY: 0.972,
    },
    // The bottom, past where the crouch settles. Legs deepest, spine nearly
    // folded, arms a long way behind.
    {
      t: 0.4,
      pose: P({
        hip: -3.2, torso: 13.2, head: -10.7,
        thighR: 127.6, shinR: 99.3, footR: -130.6,
        thighL: 136.4, shinL: 93.5, footL: -133.6,
        upperArmR: 160.5, forearmR: -3.8,
        upperArmL: 197.1, forearmL: -22.7,
      }),
      offsetY: -0.89, scaleX: 1.11, scaleY: 0.78,
    },
    // The settle, and `crouch`'s own first key to the digit: the state machine
    // hands over between these two frames with nothing in between.
    {
      t: 0.8,
      pose: P({
        hip: -3.4, torso: 13.8, head: -11.1,
        thighR: 131.8, shinR: 91, footR: -126.8,
        thighL: 140.5, shinL: 85, footL: -129.5,
        upperArmR: 159.9, forearmR: -7.5,
        upperArmL: 197.8, forearmL: -23.4,
      }),
      offsetY: -0.77, scaleX: 1.1, scaleY: 0.8,
    },
  ],
};

/**
 * The rise, five frames.
 *
 * Not the descent played backwards. Falling into a crouch is gravity and
 * standing up out of one is muscle, so where the descent covers its distance in
 * the first half this covers most of its own in the second: the legs load
 * against the floor, then extend. There is no overshoot at the top either — the
 * frame after this clip's last is `stand`, and a fighter who popped above
 * standing height would snap back down into idle.
 *
 * The order is hips, then chest, then arms, which is how a body actually leaves
 * a squat: the knees are already straightening while the torso is still folded
 * over them. The first key drags the arms a hair *further* into the crouch than
 * the crouch itself, because they are the last thing to be told.
 */
export const crouchEnd: PoseClip = {
  loop: false,
  keys: [
    // Still crouched, but the legs have begun to push.
    {
      t: 0,
      pose: P({
        hip: -3.4, torso: 13.8, head: -11.1,
        thighR: 131.8, shinR: 91, footR: -126.8,
        thighL: 140.5, shinL: 85, footL: -129.5,
        upperArmR: 159.8, forearmR: -8.1,
        upperArmL: 197.9, forearmL: -23.5,
      }),
      offsetY: -0.77, scaleX: 1.1, scaleY: 0.8,
    },
    // A third of the way up on the legs and a fifth on the spine: the hips are
    // rising out from under a chest that is still folded over them.
    {
      t: 0.4,
      pose: P({
        hip: -2.7, torso: 12, head: -9.8,
        thighR: 146.2, shinR: 62.8, footR: -113.6,
        thighL: 154.6, shinL: 56.1, footL: -115.4,
        upperArmR: 160.4, forearmR: -4.3,
        upperArmL: 197.2, forearmL: -22.8,
      }),
      offsetY: -0.37, scaleX: 1.066, scaleY: 0.868,
    },
    // Standing, on idle's mid-breath stance, because idle is where this goes.
    {
      t: 0.8,
      pose: P({
        hip: 0.1, torso: 4.8, head: -4.8,
        thighR: 174, shinR: 8, footR: -88,
        thighL: 182, shinL: 0, footL: -88,
        upperArmR: 164, forearmR: 19,
        upperArmL: 193, forearmL: -18,
      }),
      offsetY: -0.01, scaleX: 1, scaleY: 1,
    },
  ],
};
