/**
 * On the floor, and getting off it.
 *
 * A fighter who is still tumbling when they touch the ground and does not tech
 * — Ultimate gives them an 11-frame window, up from Smash 4's 8 — is knocked
 * down. SmashWiki's floor recovery article lists what happens next: they can
 * stand, roll either way, or get up with an attack, and if they choose nothing
 * they stand on their own after a moment. `states.ts` implements the last of
 * those and only that, so `downed` → `getUp` → `stand` is the no-input option
 * and these two clips are what a player watches while deciding whether to
 * commit to a hit. That is the whole design brief for them: knockdown is
 * okizeme, and okizeme is the defender reading the attacker reading the
 * *animation*.
 *
 * ## Why lying still is not still enough
 *
 * `onLanded` sends a tumbling fighter straight to `downed`, never through
 * `land` — and `squashFor` only squashes for `land`/`landingLag`. So nothing
 * outside this clip gives the arrival any weight: without an impact key the
 * fighter is simply *already* on the floor, in the identical drawing, for forty
 * frames. Two thirds of a second of one drawing is long enough to read as the
 * game having stopped, which is the single worst thing this state can say while
 * an opponent is standing over it choosing a punish.
 *
 * So the clip opens on contact and then keeps settling. Nothing after frame 12
 * moves far; what it does is keep moving, which is the difference between a
 * body at rest and a prop.
 *
 * ## Where the limbs go, and why not at the floor
 *
 * A limb that reaches for the ground is the one thing these clips cannot share
 * across the roster. An upper arm runs from Kirby's 0.9 units to Donkey Kong's
 * 2.8 while shoulder height, once the body is flat, hardly varies at all — so
 * an angle that rests a hand on the stage for one fighter drives it through for
 * the next. The pose this replaced angled the far arm down at the floor and put
 * its hand two units under the stage on Mario and nearly five on DK. Both arms
 * now lie *along* the body, where their height is the body's height and nothing
 * depends on how long they are. It is also why `getUp` has no hand plant: the
 * push is a kip, and no limb in it has to find the ground.
 *
 * ## The one thing eight rigs cannot share
 *
 * The height a body lies at is half its own thickness, and half a fighter's
 * thickness is not proportional to a fighter's height — but `offsetY` is one
 * number and the rotation pivots about 45% of rig height, which is a stand-in
 * for exactly that proportionality. Standing, the two agree; flat, they do not.
 * Mario lands 0.6 units clear of the stage and Samus 0.7, Marth floats 1.7, and
 * Kirby — four fifths head — lies with the bottom third of his ball under the
 * line, which is the same third `crouch` already puts there. So he is wrong in
 * the way the rest of the game is already wrong rather than in a new way, and
 * the spread is 4.6 units wide with nothing in this file able to close it: the
 * fix is a per-fighter lying height on `CharacterRig`, or a `pivot` on
 * `Keyframe`, and neither is mine to add.
 */

import { P, type PoseClip } from "./clip";
import { deg } from "../skeleton";

/**
 * Face up, head trailing, settled.
 *
 * Shared by both clips because the frame `downed` hands over on and the frame
 * `getUp` starts from are the same instant, and a cut there would undo the
 * settle it took forty frames to earn.
 */
const REST = {
  torso: -6, head: 12, hip: 4,
  thighR: 168, shinR: 14, footR: -74,
  thighL: 150, shinL: 46, footL: -60,
  upperArmR: 132, forearmR: -22,
  upperArmL: 191, forearmL: -20,
};

/** Body height for the flat pose. Tuned on the middle of the roster; see above. */
const FLOOR = -3.05;

/**
 * Forty frames of floor (`DOWNED_FRAMES`): the slam, the settle, one breath.
 *
 * Frame 0 is the contact and carries its own squash and its own overshoot —
 * four degrees past flat, because a body dumped on its back lands shoulders
 * first with the hips still catching up. Frame 4 is the rebound off it, and by
 * frame 12 the limbs have flopped down to where they stay.
 *
 * Then one heave, peaking at frame 26 and gone by 40. Three tenths of a unit of
 * chest rise is about a pixel and would be invisible on its own. What actually
 * reads is the eight degrees of arch under it and the sixteen the raised
 * forearm falls, because at this size rotation is the only thing the eye can
 * resolve. It comes back to `REST` so `getUp` inherits a body at rest rather
 * than one mid-breath.
 */
export const downed: PoseClip = {
  loop: false,
  keys: [
    // contact
    {
      t: 0,
      pose: P({
        ...REST,
        thighR: 158, shinR: 26, footR: -84,
        thighL: 138, shinL: 58, footL: -70,
        upperArmR: 118, forearmR: -38,
        upperArmL: 200, forearmL: -6,
      }),
      rotation: deg(-88),
      offsetY: FLOOR - 0.25,
      scaleY: 0.93,
      ease: "out",
    },
    // rebound
    {
      t: 0.11,
      pose: P({
        ...REST,
        thighR: 172, shinR: 8, footR: -70,
        thighL: 156, shinL: 40, footL: -56,
        upperArmR: 138, forearmR: -14,
        upperArmL: 186, forearmL: -26,
      }),
      rotation: deg(-82),
      offsetY: FLOOR + 0.3,
      scaleY: 1.03,
    },
    // settled
    { t: 0.3, pose: P(REST), rotation: deg(-84), offsetY: FLOOR },
    // the heave
    {
      t: 0.66,
      pose: P({
        ...REST,
        torso: -14, head: 20,
        thighR: 173, shinR: 11,
        upperArmR: 141, forearmR: -38,
        upperArmL: 186, forearmL: -26,
      }),
      rotation: deg(-84),
      offsetY: FLOOR + 0.3,
      scaleY: 1.025,
    },
    { t: 1, pose: P(REST), rotation: deg(-84), offsetY: FLOOR },
  ],
};

/**
 * Thirty frames off the floor (`GETUP_FRAMES`).
 *
 * The whole-body rotation does the work — flat at −84° on frame 0, half the
 * turn spent between frames 7 and 11, upright by 18 — and the limbs are what
 * stop it reading as a plank pivoting. The eases are the shape of a push: `in`
 * off the first key leaves the flat drawing untouched for two frames, which is
 * the beat that says *still down*, and `out` off the coil spends most of what
 * is left in the six frames after it and decelerates over the top, which is
 * what an impulse against a floor looks like.
 *
 * The kip is the knees coming over the chest, the legs whipping down under the
 * hips, and the body following them up — no hand plant, for the reason in the
 * arm note above.
 *
 * The last three keys are `crouchStart`'s bottom and `crouchEnd`'s middle and
 * last, taken outright. Those poses are tuned against the one thing that is
 * genuinely hard here — how far the legs have to fold to pay for the `offsetY`
 * they spend, across eight leg lengths — and re-deriving them by eye would only
 * mean getting them slightly wrong. They are borrowed with the whole-body
 * rotation of the frame they land on taken back out of `hip`, which keeps the
 * accumulated sole angle at the ~92° `crouch` rests the boots on the stage
 * with. Four degrees past vertical at the catch and settling back: a fighter
 * coming up off the floor arrives with their weight ahead of their feet.
 */
export const getUp: PoseClip = {
  loop: false,
  keys: [
    { t: 0, pose: P(REST), rotation: deg(-84), offsetY: FLOOR, ease: "in" },
    // the coil — knees over the chest, arms in tight, chin off the floor
    {
      t: 0.25,
      pose: P({
        hip: -12, torso: -14, head: 30,
        thighR: 124, shinR: 95, footR: -96,
        thighL: 132, shinL: 90, footL: -92,
        upperArmR: 150, forearmR: -70,
        upperArmL: 196, forearmL: -30,
      }),
      rotation: deg(-74),
      offsetY: FLOOR + 0.1,
      ease: "out",
    },
    // the push — soles down, hips coming up over them, torso still a long way
    // behind. Feet flat: rotation + hip + thigh + shin + foot ≈ 92°.
    {
      t: 0.45,
      pose: P({
        hip: -8, torso: 21, head: 15,
        thighR: 150, shinR: 106, footR: -118,
        thighL: 158, shinL: 100, footL: -120,
        upperArmR: 145, forearmR: -55,
        upperArmL: 200, forearmL: -40,
      }),
      rotation: deg(-34),
      offsetY: -1.35,
    },
    // the catch — `crouchStart`'s bottom, four degrees past vertical, with the
    // pelvis carrying that four back out of the legs so the soles stay flat
    {
      t: 0.62,
      pose: P({
        hip: -7.2, torso: 13.2, head: -10.7,
        thighR: 127.6, shinR: 99.3, footR: -130.6,
        thighL: 136.4, shinL: 93.5, footL: -133.6,
        upperArmR: 152, forearmR: -18,
        upperArmL: 199, forearmL: -30,
      }),
      rotation: deg(4),
      offsetY: -0.89,
      scaleX: 1.11,
      scaleY: 0.78,
    },
    // the rise — `crouchEnd`'s middle key
    {
      t: 0.81,
      pose: P({
        hip: -4.7, torso: 12, head: -9.8,
        thighR: 146.2, shinR: 62.8, footR: -113.6,
        thighL: 154.6, shinL: 56.1, footL: -115.4,
        upperArmR: 160.4, forearmR: -4.3,
        upperArmL: 197.2, forearmL: -22.8,
      }),
      rotation: deg(2),
      offsetY: -0.37,
      scaleX: 1.066,
      scaleY: 0.868,
    },
    // standing, on the stance `crouchEnd` hands to `idle`
    {
      t: 1,
      pose: P({
        hip: 0.1, torso: 4.8, head: -4.8,
        thighR: 174, shinR: 8, footR: -88,
        thighL: 182, shinL: 0, footL: -88,
        upperArmR: 164, forearmR: 19,
        upperArmL: 193, forearmL: -18,
      }),
      rotation: 0,
      offsetY: 0,
    },
  ],
};
