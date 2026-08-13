import { P, type PoseClip } from "./clip";

/**
 * The ordinary descent.
 *
 * Looping rather than one-shot, and that is the whole design. A fall has no
 * duration — `actionDurationFor` returns undefined for it — so a one-shot would
 * play across `poseTimeFor`'s thirty-frame default and then hold `t = 1` for
 * however long the fighter is in the air, which off the side of the stage is
 * several seconds of photograph. Looping trades a small repeat for a fighter
 * who is never still.
 *
 * The cycle is a drift, not a cycle of *events*: forty-eight frames, arms
 * swinging down and out under gravity and gathering back up, the torso rocking
 * a few degrees. Nothing in it happens *to* the fighter, so replaying it every
 * four-fifths of a second reads as air rather than as a loop.
 *
 * `t = 0` is the top of the arc, and it is reached exactly: `startAction` resets
 * `actionFrame` on the jump→fall transition, so frame 0 of this clip is always
 * the frame the fighter stopped rising. Nothing blends between clips, so that
 * key is not free to be a nice drawing — it has to be roughly where `rise` is
 * when vertical speed crosses zero, or the arms teleport on the apex frame. And
 * that is not `rise`'s *last* key: the rise is authored over thirty frames and
 * cut short by `fullHopVelocity / gravity`, so the crossover lands around three
 * fifths of the way through its coast for most of the cast. This key is matched
 * against that point, which is why it is a shallower gather than the drawing
 * would want.
 *
 * `smooth` easing out of it then gives the hang for free: a smoothstep leaves a
 * key at zero velocity, which is what floating at the apex looks like.
 */
export const fall: PoseClip = {
  loop: true,
  period: 48,
  keys: [
    // Apex. Still stretched, still gathered, momentum spent.
    {
      t: 0,
      pose: P({
        torso: 0, head: 2,
        thighR: 160, shinR: 34, footR: -72,
        thighL: 198, shinL: 28, footL: -80,
        upperArmR: 88, forearmR: -6,
        upperArmL: 274, forearmL: 10,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
    },
    // The arms lose the throw and drop into the airborne spread.
    {
      t: 0.26,
      pose: P({
        torso: -3, head: 4,
        thighR: 150, shinR: 32, footR: -76,
        thighL: 208, shinL: 26, footL: -84,
        upperArmR: 108, forearmR: -22,
        upperArmL: 254, forearmL: 22,
      }),
      offsetY: 0.04,
      scaleX: 1.01,
      scaleY: 0.99,
    },
    // The bottom of the drift: rushing air pushes the arms back and the chest up.
    {
      t: 0.56,
      pose: P({
        torso: -8, head: 9,
        thighR: 142, shinR: 28, footR: -78,
        thighL: 216, shinL: 22, footL: -88,
        upperArmR: 132, forearmR: -34,
        upperArmL: 232, forearmL: 34,
      }),
      offsetY: -0.06,
      scaleX: 1.02,
      scaleY: 0.98,
    },
    // Gathering back toward the apex shape, so the wrap to `t = 0` is a
    // continuation and not a second jump.
    {
      t: 0.82,
      pose: P({
        torso: 0, head: 1,
        thighR: 156, shinR: 36, footR: -72,
        thighL: 202, shinL: 30, footL: -82,
        upperArmR: 98, forearmR: -16,
        upperArmL: 264, forearmL: 16,
      }),
      offsetY: 0.16,
      scaleX: 0.98,
      scaleY: 1.02,
    },
  ],
};

/**
 * The committed dive.
 *
 * Ultimate itself does not change the pose: SmashWiki records that a fast fall
 * shows "a small flashing blue-purplish star" beside the fighter and nothing
 * else — no animation, no sound. That cue does not exist here, and the read has
 * to exist somewhere, because fast-falling is information the opponent is
 * entitled to: it is only available after the apex, it holds until the fighter
 * lands or is hit, and at `FAST_FALL_MULTIPLIER` the descent is 60% faster, so
 * whether it happened decides whether an anti-air is early or on time. So the
 * signal is moved into the silhouette — which is what the pre-Ultimate games
 * did, and what the star replaced.
 *
 * There is no anticipation, deliberately. `states.ts` assigns
 * `fastFallVelocity` on the frame the input is read, so the fighter is already
 * moving 60% faster while any wind-up would still be playing; a gather here
 * would put the drawing a beat behind the physics. The pose arrives with the
 * velocity instead: one frame of ordinary fall, then a hard snap.
 *
 * `t = 0` is `fall`'s apex key exactly, because the two clips are entered from
 * the same place — the jump→fall transition is the same frame the fast fall
 * becomes legal (`vy <= 0`), so both start on the apex drawing and the fast fall
 * is the one that then does something.
 *
 * The tuck at frame 3 is `hold`: it is the frame an opponent reads, and three
 * frames of one unchanging shape is how an animator makes a pose legible at
 * 60Hz — eased through, it would never actually be drawn. It then cuts open
 * into an arrow that goes on raking further over for the rest of the clip. The
 * rake is whole-body `rotation` rather than a deeper torso bend, because
 * bending the torso alone only sticks the chest out: at this size a fighter
 * reads as *going somewhere* when the whole figure tips, and as stumbling when
 * only the spine does.
 *
 * Freezing at `t = 1` is correct here in a way it is not for `fall`: a fast fall
 * is a commitment, and going rigid is what commitment looks like.
 */
export const fastFall: PoseClip = {
  loop: false,
  keys: [
    // `hip` is named only so that it has something to interpolate *from*: a bone
    // that appears first in the second key is taken at the second key's value
    // for the whole span, and an un-named hip here would tip the pelvis over on
    // frame 0 — before the fast fall has been committed to.
    {
      t: 0,
      pose: P({
        hip: 0, torso: 0, head: 2,
        thighR: 160, shinR: 34, footR: -72,
        thighL: 198, shinL: 28, footL: -80,
        upperArmR: 88, forearmR: -6,
        upperArmL: 274, forearmL: 10,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
      ease: "out",
    },
    // The tuck. Knees to the chest, elbows in, head down: the read.
    {
      t: 0.1,
      pose: P({
        hip: -8, torso: 26, head: 2,
        thighR: 116, shinR: 118, footR: -58,
        thighL: 124, shinL: 114, footL: -54,
        upperArmR: 138, forearmR: -96,
        upperArmL: 146, forearmL: -102,
      }),
      offsetY: -0.55,
      scaleX: 0.9,
      scaleY: 1.0,
      rotation: 0.06,
      ease: "hold",
    },
    // The ball opens into an arrow: legs together and pointed, arms pinned to
    // the flanks, head leading. The ordinary fall is a wide X and this is a
    // thin I, which is the difference that has to survive being a centimetre
    // tall on a four-player screen.
    {
      t: 0.2,
      pose: P({
        hip: -2, torso: 14, head: 8,
        thighR: 168, shinR: 34, footR: -66,
        thighL: 190, shinL: 28, footL: -58,
        upperArmR: 194, forearmR: -22,
        upperArmL: 202, forearmL: -26,
      }),
      offsetY: 0.18,
      scaleX: 0.85,
      scaleY: 1.05,
      rotation: 0.1,
      ease: "out",
    },
    {
      t: 0.45,
      pose: P({
        hip: -2, torso: 16, head: 8,
        thighR: 170, shinR: 30, footR: -64,
        thighL: 192, shinL: 24, footL: -56,
        upperArmR: 200, forearmR: -18,
        upperArmL: 208, forearmL: -22,
      }),
      offsetY: 0.16,
      scaleX: 0.84,
      scaleY: 1.06,
      rotation: 0.14,
    },
    // Under a degree a frame, so a long plunge goes on raking over rather than
    // stopping dead the moment the clip runs out.
    {
      t: 1,
      pose: P({
        hip: -3, torso: 19, head: 9,
        thighR: 172, shinR: 26, footR: -60,
        thighL: 194, shinL: 20, footL: -52,
        upperArmR: 208, forearmR: -12,
        upperArmL: 216, forearmL: -16,
      }),
      offsetY: 0.14,
      scaleX: 0.83,
      scaleY: 1.08,
      rotation: 0.19,
    },
  ],
};
