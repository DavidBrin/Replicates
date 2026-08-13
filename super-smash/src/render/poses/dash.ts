import { P, type PoseClip } from "./clip";

/**
 * The initial dash — the burst out of standing, and the whole of it.
 *
 * Ultimate gives the entire cast the same interrupt frame — SmashWiki's
 * dash-dancing article puts it at frame 15 for every character, which is
 * `DASH_INTERRUPT_FRAME` — and that is why dash-dancing works identically for
 * everybody: reverse before it and the dash restarts for free, hold past it and
 * the state machine hands over to `run`. So this is not a lead-in to the run, it
 * is the animation, and its last key has to *be* the run's first key or the
 * fighter changes shape on the handoff frame.
 *
 * The other fact that shapes it: Ultimate raised initial-dash speeds across the
 * roster far enough that fox-trotting — spamming this animation and cancelling
 * the run — outruns actually running, and `initialDashSpeed` is duly above
 * `runSpeed` for all eight fighters here. `initialDashVelocity` grants all of it
 * on frame 1, so the burst is over before the first drawing and the animation's
 * job is a *settle*: the body is thrown out ahead of the feet at the start and
 * the legs spend the rest of the clip catching up to it.
 *
 * The lean is carried by `root`, which no other clip poses. Leaning the torso
 * cannot do it — that capsule is 3.2 long and 3.7 thick, so rotating it is
 * nearly invisible and only folds the fighter at the waist. `root` is the strut
 * from the feet to the pelvis, so rotating it pitches the whole body about the
 * point where the feet meet the floor, which is what a lean is.
 *
 * Four keys, and the last three are a stride. Frame 0 is the shove: both feet
 * still in the standing footprint under a body already 14° out over them, near
 * leg loaded on the ball of the foot. Frame 4 is the drive — back leg straight
 * out behind, lead knee up, hardest lean, arms at full opposition — and it is
 * also, deliberately, the run's reach key mirrored, so that from there on the
 * legs are simply running: pass at 9, reach at 15. Five frames then six, against
 * the run's five and five, because a stride at dash speed covers more ground and
 * the settle is where the spare frame belongs. The lean bleeds out over those
 * same eleven frames so the fighter arrives upright rather than snapping upright.
 */
export const dash: PoseClip = {
  loop: false,
  keys: [
    {
      // The shove: everything out over the toes, both feet behind it.
      t: 0,
      pose: P({
        root: 14, hip: -12, torso: 42, head: -28,
        thighR: 206, shinR: 26, footR: -82,
        thighL: 182, shinL: 62, footL: -110,
        upperArmR: 68, forearmR: 44,
        upperArmL: 190, forearmL: -52,
      }),
      offsetX: 0.3,
      offsetY: -0.22,
      scaleX: 1.03,
      scaleY: 0.96,
      // Linear, not eased: the engine grants full dash velocity on frame 1, so
      // there is no frame in which the limbs are entitled to sit still.
      ease: "linear",
    },
    {
      // The drive. Near leg straight out behind and toed off, far knee up. Every
      // limb reverses direction here, so this key and the two after it take the
      // default smooth ease: a limb that changes its mind has to slow down first.
      t: 4 / 15,
      pose: P({
        root: 16, hip: -14, torso: 48, head: -32,
        thighR: 244, shinR: 14, footR: -56,
        thighL: 96, shinL: 97, footL: -45,
        upperArmR: 46, forearmR: 54,
        upperArmL: 204, forearmL: -60,
      }),
      offsetX: 0.5,
      offsetY: -0.05,
    },
    {
      // The pass: legs stacked under a body standing up out of the lean, near
      // knee coming through toward the run's reach.
      t: 3 / 5,
      pose: P({
        root: 6, hip: -5, torso: 26, head: -19,
        thighR: 169, shinR: 70, footR: -42,
        thighL: 183, shinL: 16, footL: -96,
        upperArmR: 161, forearmR: 46,
        upperArmL: 145, forearmL: -50,
      }),
      offsetX: 0.15,
      offsetY: 0.5,
    },
    {
      // `run`'s t = 0, to the degree. `root` and `hip` are named even though
      // they are zero: a bone the next key omits keeps the value it had, so
      // leaving them out would carry the dash's lean into the run cycle.
      t: 1,
      // The run's own `t = 0`, to the degree. It changed under this clip when
      // the run gained a flight phase — its first key used to be a floating
      // stride with both feet off the floor and is now a heel contact — so
      // this key is copied from there rather than tuned to look similar.
      pose: P({
        root: 7, hip: -6, torso: 17, head: -13,
        thighR: 152, shinR: 14, footR: -98,
        thighL: 183, shinL: 115, footL: -141,
        upperArmR: 216, forearmR: -36,
        upperArmL: 98, forearmL: -62,
      }),
      offsetX: 0,
      offsetY: -0.2,
    },
  ],
};
