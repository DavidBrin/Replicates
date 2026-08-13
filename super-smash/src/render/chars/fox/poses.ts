/**
 * Fox: the clips that are Fox’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * Author against the real move: the frame data (ultimateframedata.com) says
 * when the hitbox is live, and `poseTimeFor` will put the clip’s `strike` key
 * on that frame whatever the numbers are, so the clip only has to be the right
 * *shape*.
 *
 * ## Why almost every attack is here
 *
 * Because almost every attack Fox has is a **kick**, and the shared library is
 * a library of punches. SmashWiki's own descriptions: forward tilt is "a
 * roundhouse kick", forward smash "a butterfly kick", up smash "a bicycle
 * kick", down smash "a split kick", neutral air "a flying kick", forward air
 * "five roundhouse kicks in quick succession", back air "a back turning kick",
 * down air "a corkscrew kick". A prop cannot fix a pose that is wrong, and
 * neither can a palette: a fighter whose entire moveset is legwork, played on
 * clips that reach with the arms, is a different character.
 *
 * ## The one thing every clip here has in common
 *
 * He is the fastest fighter in the game, and speed is expressed in the
 * *animation*, not in the attribute table. So every clip below is built the
 * same way:
 *
 *   wind-up (`ease: "in"`, slow) → coil → **strike** → `ease: "hold"` for a
 *   few frames of held extension → `ease: "out"` unwind → settle
 *
 * The held extension is the part that is easy to leave out and is most of the
 * effect. A limb that eases smoothly from its wind-up, through contact, into
 * its recovery covers the same ground at the same rate the whole way through,
 * and reads as putty at any speed. A limb that sits still, crosses in three
 * frames, stops dead for four and then unwinds reads as fast even played back
 * at the same frame rate — which is the entire trick, because it is the same
 * frame rate.
 *
 * ## Two conventions worth restating, because both have cost a day here
 *
 * A **planted foot** is `thigh` accumulating to about 196°, `shin` to about
 * 176°, `foot` to about 92°; accumulation runs down the chain, so a pose that
 * leans the `hip` has to repay it in the thigh. And `offsetY` is *absolute*:
 * a crouch that drops the body by two units without folding the legs by two
 * units puts the fighter's feet through the stage. Every grounded pose below
 * was checked against `resolve()` for both — the feet land within a tenth of a
 * unit of the floor, and each strike lands within its own hitbox's radius of
 * where `fighters/fox.ts` says that hitbox is.
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/* ----------------------------------------------------------------- idle -- */

/**
 * The stand — the pose he is in for most of a match, and the one clip here that
 * is not an attack.
 *
 * The shared `idle` is a person standing: legs all but straight, arms hanging,
 * chest up. Fox is not standing, he is *waiting* — a low, forward-leaning ready
 * stance with both knees loaded, the near hand carried up in front of the
 * chest, the far one back at the hip, and the tail out behind as the
 * counterweight. It is the same stance his idle poses depart from (SmashWiki
 * describes the first as "a taekwondo-type fighting stance"), and it is what
 * makes the fastest fighter in the game look like he is about to leave rather
 * than like he is queueing.
 *
 * Three things are borrowed wholesale from the shared clip's reasoning, because
 * they are right and were expensive to learn:
 *
 * 1. **Four keys, and nothing turns round at the same moment as anything
 *    else.** The chest is highest at key 1, the head is still rising at key 2,
 *    the near arm is furthest back at key 3. Two keys give a metronome at any
 *    amplitude.
 * 2. **Only the inhale is cushioned.** Smoothstep is zero-velocity at both
 *    ends, so easing every span stops the whole body dead at every key. The
 *    three spans of the exhale are linear.
 * 3. **A bent knee repays itself out of the thigh.** `shin += d` with
 *    `thigh -= d/2` moves the ankle by hundredths of a unit, and both thighs
 *    carry the pelvis's own tilt subtracted out, or a degree of rock at the
 *    hip skates both boots across the floor.
 *
 * What is Fox's rather than shared: he sits 0.42 units lower with real bend in
 * both knees, the torso is pitched 14° forward with the head counter-rotated so
 * the muzzle stays level rather than pointing at his boots, the near arm is
 * carried forward and bent instead of hanging, and the cycle is 84 frames
 * instead of 108 — a breath a third faster, which is as much of "he is quick"
 * as a still pose can carry.
 *
 * The period is deliberately *not* a multiple of the tail's own 114-frame sway
 * in `rig.ts`, so the two never lock into a beat.
 */
const idle: PoseClip = {
  loop: true,
  period: 84,
  keys: [
    {
      // The settle at the end of the exhale. Chest at its lowest, weight over
      // the back leg, far arm at the back of its swing.
      t: 0,
      pose: P({
        hip: 1.0, torso: 15.0, head: -10.0,
        thighR: 160.0, shinR: 32.0, footR: -104.0,
        thighL: 197.6, shinL: -12.0, footL: -95.0,
        upperArmR: 156.0, forearmR: -48.0,
        upperArmL: 187.0, forearmL: -38.0,
      }),
      offsetY: -0.44,
      scaleY: 0.998,
    },
    {
      // Top of the inhale. Most of the rise is `scaleY`, which stretches about
      // the feet and leaves the soles on the floor; `offsetY` would lift them
      // off it.
      t: 0.33,
      pose: P({
        hip: 0.2, torso: 12.4, head: -5.6,
        thighR: 162.3, shinR: 29.0, footR: -103.0,
        thighL: 199.4, shinL: -15.0, footL: -95.0,
        upperArmR: 155.2, forearmR: -50.5,
        upperArmL: 186.6, forearmL: -35.0,
      }),
      offsetY: -0.36,
      scaleY: 1.016,
      ease: "linear",
    },
    {
      // The head is still coming up as the chest starts down. Weight now over
      // the near leg and that knee at its softest.
      t: 0.57,
      pose: P({
        hip: -0.8, torso: 13.8, head: -14.2,
        thighR: 164.8, shinR: 26.0, footR: -102.0,
        thighL: 200.9, shinL: -18.0, footL: -95.0,
        upperArmR: 152.0, forearmR: -46.0,
        upperArmL: 190.2, forearmL: -39.5,
      }),
      offsetY: -0.40,
      scaleY: 1.007,
      ease: "linear",
    },
    {
      // A hair under key 0, so the last span is a recovery into the settle
      // rather than a fourth extreme.
      t: 0.80,
      pose: P({
        hip: 0.4, torso: 15.6, head: -10.8,
        thighR: 161.1, shinR: 31.0, footR: -104.0,
        thighL: 198.3, shinL: -13.0, footL: -95.0,
        upperArmR: 151.4, forearmR: -47.0,
        upperArmL: 190.6, forearmL: -36.0,
      }),
      offsetY: -0.46,
      scaleY: 0.996,
      ease: "linear",
    },
  ],
};

/* ------------------------------------------------------------------ jab -- */

/**
 * Jab: two alternating punches driving forward.
 *
 * The real move is "two alternating jabs followed by a flurry of kicks, ending
 * with a mid-level roundhouse kick" — and only the first half of that can be
 * drawn, because `SLOT_POSE` in `poses/timing.ts` maps `jab1`, `jab2`, `jab3`
 * *and* `rapidJab` to this one clip. Whatever is authored for the flurry is
 * also what a single frame-2 jab plays, so a roundhouse finisher at the tail
 * of the clip would put a kick in the back half of every jab. Alternating
 * punches read correctly in both, and the flurry is expressed by making the
 * alternation fast rather than by changing what it is. See the report.
 *
 * Frame 2, which is the fastest jab in the game and has to look it: the fist
 * is out on the third key and the whole wind-up is two frames long.
 */
const jab: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 2, head: -2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 168, forearmR: -48, upperArmL: 196, forearmL: -40,
      }),
      ease: "in",
    },
    {
      // Contact. The fist lands at (5.0, 8.0) against a hitbox at (5.0, 6.6)
      // with a 2.4 radius — high in the box, which is where a jab thrown by
      // someone leaning into it lands.
      t: 0.26,
      pose: P({
        torso: 10, head: -8, hip: -4,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 100, forearmR: -8, handR: 0,
        upperArmL: 214, forearmL: -56,
      }),
      offsetX: 0.3,
      scaleX: 1.06,
      ease: "hold",
    },
    { t: 0.34, pose: P({
        torso: 10, head: -8, hip: -4,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 100, forearmR: -8, handR: 0,
        upperArmL: 214, forearmL: -56,
      }), offsetX: 0.3, scaleX: 1.06, ease: "in" },
    // The second fist crosses while the first is still coming back — which is
    // what makes two punches read as a flurry rather than as two punches.
    {
      t: 0.52,
      pose: P({
        torso: 6, head: -4, hip: -2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 172, forearmR: -44,
        upperArmL: 106, forearmL: -10,
      }),
      offsetX: 0.28,
      scaleX: 1.05,
      ease: "hold",
    },
    { t: 0.60, pose: P({
        torso: 6, head: -4, hip: -2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 172, forearmR: -44,
        upperArmL: 106, forearmL: -10,
      }), offsetX: 0.28, scaleX: 1.05, ease: "out" },
    {
      t: 0.86,
      pose: P({
        torso: 4, head: -2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 152, forearmR: -34, upperArmL: 178, forearmL: -34,
      }),
      offsetX: 0.1,
    },
    { t: 1, pose: P({ torso: 2, upperArmR: 168, forearmR: -40, upperArmL: 194, forearmL: -38 }) },
  ],
};

/* ---------------------------------------------------------------- tilts -- */

/**
 * Forward tilt: a roundhouse kick.
 *
 * Frame 6, and the knee has to be chambered before it fires or the leg reads
 * as a swing from the hip. Contact puts the boot at (7.2, 5.1) against a
 * hitbox at (6.4, 5.6) radius 3.2. The far leg stays planted throughout —
 * this is a kick from a stance, not a leap.
 */
const ftilt: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 6, head: -4,
        thighR: 172, shinR: 14, footR: -98,
        thighL: 200, shinL: -20, footL: -84,
        upperArmR: 200, forearmR: -40, upperArmL: 164, forearmL: -30,
      }),
      ease: "in",
    },
    {
      // Chambered: knee driven up and the boot tucked in under it. The kick is
      // this shape unfolding, and without it there is nothing to unfold.
      t: 0.18,
      pose: P({
        torso: -6, head: 6, hip: 4,
        thighR: 130, shinR: 70, footR: -80,
        thighL: 196, shinL: -18, footL: -86,
        upperArmR: 210, forearmR: -46, upperArmL: 152, forearmL: -26,
      }),
      offsetX: -0.1,
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: -4, head: 6, hip: -6,
        thighR: 102, shinR: -6, footR: -24,
        thighL: 202, shinL: -20, footL: -84,
        upperArmR: 214, forearmR: -52, upperArmL: 150, forearmL: -30,
      }),
      offsetX: 0.4,
      scaleX: 1.1,
      scaleY: 0.96,
      ease: "hold",
    },
    {
      t: 0.38,
      pose: P({
        torso: -4, head: 6, hip: -6,
        thighR: 102, shinR: -6, footR: -24,
        thighL: 202, shinL: -20, footL: -84,
        upperArmR: 214, forearmR: -52, upperArmL: 150, forearmL: -30,
      }),
      offsetX: 0.4,
      scaleX: 1.1,
      scaleY: 0.96,
      ease: "out",
    },
    {
      t: 0.60,
      pose: P({
        torso: 2, head: 0, hip: -2,
        thighR: 138, shinR: 40, footR: -78,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 204, forearmR: -44, upperArmL: 158, forearmL: -28,
      }),
      offsetX: 0.16,
    },
    { t: 0.92, pose: P({ torso: 4, thighR: 170, shinR: 16, footR: -98, thighL: 200, shinL: -20, footL: -84 }) },
    { t: 1, pose: P({ torso: 4, upperArmR: 190, forearmR: -36, upperArmL: 176, forearmL: -32 }) },
  ],
};

/**
 * Up tilt: the scorpion kick.
 *
 * "Fox plants his hands on the ground and does a scorpion kick with his right
 * leg." Round one read that as impossible — "the arm chain reaches 4.4 units
 * from a shoulder that sits at 8.5, so the hands bottom out at hip height" —
 * and settled for a lean. That was measuring the wrong thing. **The arm does
 * not have to be longer; the shoulder has to come down.** Watch the move
 * (SmashWiki's own hitbox capture, frames 2-7) and he is not leaning: he is
 * *doubled over*, chest almost horizontal, muzzle down by his own wrists, hips
 * the highest part of him, with the near leg whipped up and back over his
 * spine. Pitch the torso to 96° and the shoulder is at y 5.2 rather than 9.1,
 * and a 4.35-unit arm hanging off it puts the hand on the floor with room to
 * spare.
 *
 * That is the whole fix, and it is worth stating plainly because it is the same
 * mistake in miniature that made round one lengthen nothing: a limb that will
 * not reach is usually a *body* that is not committed, and reach bought by
 * scaling a bone is paid for in every one of the fifty clips that bone is also
 * in.
 *
 * The shape it buys is a genuine silhouette — a fighter bent double with both
 * hands on the stage and one boot in the air over his own back — and nobody
 * else on this roster makes it.
 *
 * Contact puts the boot at (-3.7, 9.4) against a hitbox at (0.5, 11.5)
 * radius 3.8. Frame 3, which is why the wind-up is a single key and he is
 * already diving at t=0: there are two samples before contact and neither of
 * them can afford to be a fighter standing up straight.
 */
const utilt: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      // Already going over. The hands are past the knees and the near foot has
      // left the floor on the first frame drawn.
      t: 0,
      pose: P({
        torso: 46, head: 6, hip: -4,
        thighR: 126, shinR: 58, footR: -96,
        thighL: 200, shinL: -30, footL: -80,
        upperArmR: 116, forearmR: -6, upperArmL: 120, forearmL: -10,
      }),
      offsetY: -0.2,
      ease: "in",
    },
    {
      // Planted. Chest horizontal, both hands on the stage, hips at the apex,
      // the near leg thrown up and back over his own spine.
      t: 0.26,
      pose: P({
        torso: 96, head: 42, hip: -2,
        thighR: -32, shinR: 8, footR: -30,
        thighL: 202, shinL: -46, footL: -74,
        upperArmR: 78, forearmR: 6, handR: 0,
        upperArmL: 86, forearmL: 0, handL: 0,
      }),
      offsetX: 0.2,
      offsetY: -0.5,
      scaleX: 1.04,
      ease: "hold",
    },
    {
      // The late hitbox runs to frame 7 and sits slightly forward and down of
      // the clean one, so the leg drifts a few degrees over rather than holding
      // a photograph — the shape is the same and the boot is on its way round.
      t: 0.40,
      pose: P({
        torso: 96, head: 42, hip: -2,
        thighR: -26, shinR: 6, footR: -28,
        thighL: 202, shinL: -46, footL: -74,
        upperArmR: 78, forearmR: 6, handR: 0,
        upperArmL: 86, forearmL: 0, handL: 0,
      }),
      offsetX: 0.2,
      offsetY: -0.5,
      scaleX: 1.04,
      ease: "out",
    },
    {
      // Out of it the way he went in: the leg swings down and *forward* past
      // the vertical while the chest comes up, which is what the capture shows
      // on frames 8 through 16 and is the opposite of rewinding the kick.
      t: 0.58,
      pose: P({
        torso: 52, head: 18, hip: -6,
        thighR: 96, shinR: 26, footR: -70,
        thighL: 204, shinL: -34, footL: -78,
        upperArmR: 106, forearmR: -14, upperArmL: 112, forearmL: -18,
      }),
      offsetX: 0.16,
      offsetY: -0.3,
    },
    {
      t: 0.90,
      pose: P({
        torso: 16, head: -8,
        thighR: 160, shinR: 30, footR: -100,
        thighL: 200, shinL: -16, footL: -88,
        upperArmR: 150, forearmR: -34, upperArmL: 184, forearmL: -30,
      }),
      offsetY: -0.1,
    },
    { t: 1, pose: P({ torso: 10, head: -6, thighR: 164, shinR: 26, footR: -100, thighL: 200, shinL: -14, footL: -90, upperArmR: 160, forearmR: -36, upperArmL: 188, forearmL: -32 }) },
  ],
};

/**
 * Down tilt: the crouching tail sweep.
 *
 * "Fox spins while crouching, sweeping with his tail." The tail is hung off
 * `hip` at its base in `rig.ts`, so leaning the hip is what swings it — which
 * is the whole reason it is mounted there. The hip goes over by 34°, the far
 * thigh takes the 34° back so the support leg stays where it was, and the near
 * leg sweeps out low along the floor with it. Contact at (6.0, 0.6) against a
 * hitbox at (5.5, 1.2).
 *
 * The crouch drops him 1.5 units, which the legs repay by folding — a body
 * translated down with straight legs stands underneath the stage.
 */
const dtilt: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 26, head: -20,
        thighR: 144, shinR: 84, footR: -132,
        thighL: 148, shinL: 90, footL: -140,
        upperArmR: 176, forearmR: 12, upperArmL: 184, forearmL: 10,
      }),
      offsetY: -1.15,
      ease: "in",
    },
    {
      // Coiled under himself, tail cocked back — the hip leans the other way
      // first so the sweep has somewhere to come from.
      t: 0.18,
      pose: P({
        torso: 40, head: -26, hip: 14,
        thighR: 120, shinR: 104, footR: -132,
        thighL: 130, shinL: 104, footL: -140,
        upperArmR: 164, forearmR: 26, upperArmL: 172, forearmL: 22,
      }),
      offsetY: -1.15,
      offsetX: -0.2,
      scaleX: 1.06,
      scaleY: 0.88,
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 48, head: -26, hip: -34,
        thighR: 172, shinR: -8, footR: -48,
        thighL: 150, shinL: 114, footL: -140,
        upperArmR: 146, forearmR: 40, upperArmL: 154, forearmL: 36,
      }),
      offsetY: -1.15,
      offsetX: 0.2,
      scaleX: 1.18,
      scaleY: 0.84,
      ease: "hold",
    },
    {
      t: 0.37,
      pose: P({
        torso: 48, head: -26, hip: -34,
        thighR: 172, shinR: -8, footR: -48,
        thighL: 150, shinL: 114, footL: -140,
        upperArmR: 146, forearmR: 40, upperArmL: 154, forearmL: 36,
      }),
      offsetY: -1.15,
      offsetX: 0.2,
      scaleX: 1.18,
      scaleY: 0.84,
      ease: "out",
    },
    {
      t: 0.60,
      pose: P({
        torso: 34, head: -22, hip: -12,
        thighR: 146, shinR: 76, footR: -128,
        thighL: 140, shinL: 100, footL: -138,
        upperArmR: 168, forearmR: 20, upperArmL: 176, forearmL: 18,
      }),
      offsetY: -1.18,
      scaleX: 1.06,
      scaleY: 0.9,
    },
    // Both of these name every bone the keys before them named. A bone dropped
    // from the last keys does not hold its value — it falls back to the rig's
    // rest angle — so leaving the arms and feet off here popped them straight
    // on the frame the crouch was supposed to be settling.
    {
      t: 0.92,
      pose: P({
        torso: 26, head: -20, hip: -4,
        thighR: 144, shinR: 84, footR: -132,
        thighL: 148, shinL: 90, footL: -140,
        upperArmR: 172, forearmR: 16, upperArmL: 180, forearmL: 14,
      }),
      offsetY: -1.15,
    },
    {
      t: 1,
      pose: P({
        torso: 24, head: -18, hip: -2,
        thighR: 144, shinR: 84, footR: -132,
        thighL: 148, shinL: 90, footL: -140,
        upperArmR: 174, forearmR: 12, upperArmL: 182, forearmL: 10,
      }),
      offsetY: -1.12,
    },
  ],
};

/**
 * Dash attack: the flying kick.
 *
 * Frame 4 out of a 2.402 run — the fastest closing tool in the game, and the
 * reason it is dangerous is that it arrives before the animation looks like it
 * should have. So there is barely a wind-up: he is already leaving the ground
 * on the first key, both boots lead, and the arms are thrown back behind him,
 * which is the silhouette a flying kick has and a running punch does not.
 */
const dashAttack: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 26, head: -18,
        thighR: 146, shinR: 44, footR: -90,
        thighL: 202, shinL: -14, footL: -86,
        upperArmR: 200, forearmR: 10, upperArmL: 196, forearmL: 8,
      }),
      offsetX: 0.2,
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 34, head: -24, hip: -10,
        thighR: 124, shinR: -8, footR: -44,
        thighL: 140, shinL: 26, footL: -56,
        upperArmR: 230, forearmR: 40, upperArmL: 224, forearmL: 36,
      }),
      offsetX: 1.2,
      offsetY: 0.5,
      scaleX: 1.16,
      scaleY: 0.9,
      ease: "hold",
    },
    {
      // Held to the end of the *late* hitbox, not the early one. Both are live
      // — frame 4 through frame 15 — and the eleven frames in between are most
      // of what the move is. Cut short at t 0.38 he was visibly landing while
      // the weak hit was still connecting.
      t: 0.55,
      pose: P({
        torso: 34, head: -24, hip: -10,
        thighR: 124, shinR: -8, footR: -44,
        thighL: 140, shinL: 26, footL: -56,
        upperArmR: 230, forearmR: 40, upperArmL: 224, forearmL: 36,
      }),
      offsetX: 1.3,
      offsetY: 0.4,
      scaleX: 1.16,
      scaleY: 0.9,
      ease: "out",
    },
    // The landing: he comes down out of it hard, which is the lag the move has.
    {
      t: 0.7,
      pose: P({
        torso: 30, head: -22, hip: -4,
        thighR: 140, shinR: 62, footR: -110,
        thighL: 178, shinL: 20, footL: -100,
        upperArmR: 196, forearmR: 4, upperArmL: 192, forearmL: 2,
      }),
      offsetX: 0.9,
      offsetY: -0.9,
      scaleX: 1.1,
      scaleY: 0.86,
    },
    { t: 0.92, pose: P({ torso: 18, thighR: 158, shinR: 40, footR: -108, thighL: 196, shinL: -12, footL: -88 }), offsetX: 0.4, offsetY: -0.3 },
    { t: 1, pose: P({ torso: 12, upperArmR: 176, forearmR: -20, upperArmL: 192, forearmL: -18 }) },
  ],
};

/* --------------------------------------------------------------- smashes -- */

/**
 * Forward smash: the butterfly kick.
 *
 * "Fox somersaults forward" — a butterfly kick is a leaping turn where the
 * legs whip over in sequence and the trailing heel arrives as the body comes
 * round. Frame 13 is slow for him, and the thirteen frames of startup are what
 * gives it the only real wind-up in his moveset: he turns away, drops, and
 * then leaves the ground.
 *
 * Contact puts the boot at (8.4, 5.6) against a hitbox at (7.5, 6.0) radius
 * 4.0, with the far leg swept back and down and the body airborne by a unit —
 * a still frame of it is a fighter in the air with one leg out at chest height
 * and the other trailing, which is a butterfly kick and is not a punch.
 *
 * The key at t=0.15 is where a *charged* smash parks: `poseTimeFor` holds a
 * charging smash at `strike * 0.55`, which for a 0.30 strike is 0.165. So that
 * key is not a passing shape, it is the pose a player looks at for as long as
 * they hold the button, and it is drawn as a coil rather than as a half-swing.
 */
const fsmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 8,
        thighR: 168, shinR: 22, footR: -100,
        thighL: 202, shinL: -16, footL: -86,
        upperArmR: 214, forearmR: 30, upperArmL: 160, forearmL: -24,
      }),
      offsetX: -0.4,
      ease: "in",
    },
    {
      // The charge pose. Turned away, dropped onto the back leg, near knee up
      // and cocked, both arms wound back across the body.
      t: 0.15,
      pose: P({
        torso: -26, head: 18, hip: 10,
        thighR: 134, shinR: 76, footR: -120,
        thighL: 186, shinL: -6, footL: -80,
        upperArmR: 244, forearmR: 56, upperArmL: 146, forearmL: -40,
      }),
      offsetX: -0.7,
      offsetY: -0.9,
      scaleX: 1.06,
      scaleY: 0.9,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -16, head: 14, hip: -8,
        thighR: 106, shinR: -6, footR: -14,
        thighL: 232, shinL: 26, footL: -70,
        upperArmR: 122, forearmR: -56, upperArmL: 252, forearmL: 44,
      }),
      offsetX: 1.1,
      offsetY: 1.1,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "hold",
    },
    {
      t: 0.4,
      pose: P({
        torso: -16, head: 14, hip: -8,
        thighR: 106, shinR: -6, footR: -14,
        thighL: 232, shinL: 26, footL: -70,
        upperArmR: 122, forearmR: -56, upperArmL: 252, forearmL: 44,
      }),
      offsetX: 1.15,
      offsetY: 1.0,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "out",
    },
    // The far leg comes over and he lands out of the turn. The whole-body
    // rotation is small and only here — the somersault is carried by the legs
    // crossing, and a big `rotation` on the contact key would have dragged the
    // boot out of its own hitbox.
    {
      t: 0.56,
      pose: P({
        torso: 6, head: 0, hip: -4,
        thighR: 138, shinR: 54, footR: -110,
        thighL: 206, shinL: -4, footL: -90,
        upperArmR: 150, forearmR: -20, upperArmL: 214, forearmL: 20,
      }),
      offsetX: 0.9,
      offsetY: -0.5,
      rotation: 0.18,
      scaleY: 0.9,
    },
    { t: 0.9, pose: P({ torso: 10, thighR: 166, shinR: 20, footR: -98, thighL: 200, shinL: -16, footL: -86 }), offsetX: 0.5 },
    { t: 1, pose: P({ torso: 8, upperArmR: 172, forearmR: -30, upperArmL: 192, forearmL: -28 }), offsetX: 0.4 },
  ],
};

/**
 * Up smash: the bicycle kick, and it is a real somersault.
 *
 * Frame 8 — not frame 2, which belongs to the charge hold and is the most
 * repeated wrong number about this character; see the header of
 * `fighters/fox.ts`. The hitbox is a 5.7-radius sphere at (1.0, 12.0), above
 * his own head.
 *
 * ## The thing round one could not do, and why it can now
 *
 * The boot has to get above his own head, and it cannot: the leg chain is 6.37
 * units from a pelvis at 4.87, which tops out at 11.25, and the crown of his
 * head is at 13.10. Round one worked round it by pitching the torso back and
 * calling it done, and the capture shows exactly what that buys — a fighter
 * sitting down in mid-air with a boot out at ear height, carried entirely by
 * the swing arc the renderer paints over him. Lengthening the leg is not the
 * answer either: it would need +1.9 units, which is a stork, and every unit of
 * it has to be repaid in `root` or he stands through the floor in all fifty
 * shared clips.
 *
 * The answer is the one the real move uses. SmashWiki's own hitbox capture:
 * frames 0-4 he crouches, frame 5 he rises with one arm thrown overhead, and by
 * frame 7 he is **horizontal**, going over backwards — through the whole active
 * window his head is below his hips and both legs are above him, and the
 * hitboxes sit on the knee and over the top of his body. It is a somersault,
 * so it is authored as one: the body turns 135° backwards about the pelvis, the
 * legs stay pointed down the body's own axis, and after the turn "down the
 * body" *is* up and forward. A boot that could not pass 11.25 standing arrives
 * at 14.7, with his own crown three units under it at 6.6.
 *
 * `rotation` and not `spin`: `spin` integrates whole turns across the clip and
 * cannot be keyed, and this turn has to arrive on frame 8, hold through the
 * second half of the pedal and then come back — he lands on his feet. Each
 * span is under half a revolution, which is the constraint `lerpAngle` puts on
 * a keyed rotation, and the unwind is the recovery: 44 frames of it, which is
 * why this is the slowest thing he owns.
 *
 * The two contact keys are the two halves of the pedal — near leg first, far
 * leg following it over the top — so a still frame of the move is a scissor in
 * the air and not one leg raised.
 */
const usmash: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -8,
        thighR: 164, shinR: 26, footR: -98,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 186, forearmR: -14, upperArmL: 196, forearmL: -12,
      }),
      ease: "in",
    },
    {
      // The charge pose, at `strike * 0.55` = 0.143 — a tenth of the way into
      // the span below, which under a cubic `in` is a thousandth of the way to
      // it, so this drawing is what a held button shows. Dropped into a crouch
      // with both knees loaded and the arms swung down and back: a coil that is
      // obviously about to go upward.
      t: 0.13,
      pose: P({
        torso: 20, head: -16, hip: -6,
        thighR: 134, shinR: 80, footR: -122,
        thighL: 140, shinL: 84, footL: -128,
        upperArmR: 216, forearmR: 34, upperArmL: 222, forearmL: 30,
      }),
      offsetY: -1.5,
      scaleX: 1.08,
      scaleY: 0.86,
      ease: "in",
    },
    {
      // Frames 8-9, the clean hit. Over backwards, near leg driving through the
      // top of the arc, the far one still trailing. The arms are thrown wide
      // rather than tucked — a somersault is thrown *by* the arms, and tucked
      // ones would leave the body a featureless bar at this angle.
      t: 0.26,
      pose: P({
        torso: -18, head: 22, hip: 6,
        // A scissor, not a pair. The two legs were 26 degrees apart and read as
        // one fat limb at match scale — the reference has the kicking leg
        // ramrod straight down the body's axis with the other folded hard into
        // the chest, and that split *is* the move's read. Sixty degrees at the
        // knee is what makes two legs legible as two.
        thighR: 186, shinR: -6, footR: -76,
        thighL: 126, shinL: 68, footL: -104,
        upperArmR: 116, forearmR: -44, upperArmL: 232, forearmL: 36,
      }),
      offsetX: -0.5,
      offsetY: 2.0,
      rotation: -2.36,
      scaleX: 0.92,
      scaleY: 1.12,
      ease: "hold",
    },
    {
      // Frames 10-11, the late hit and the second half of the pedal. Further
      // over, and the far leg has crossed the near one through the top.
      t: 0.35,
      pose: P({
        torso: -16, head: 20, hip: 4,
        thighR: 130, shinR: 64, footR: -100,
        thighL: 184, shinL: -6, footL: -78,
        upperArmR: 112, forearmR: -40, upperArmL: 236, forearmL: 32,
      }),
      offsetX: -0.4,
      offsetY: 2.25,
      rotation: -2.58,
      scaleX: 0.92,
      scaleY: 1.12,
      ease: "out",
    },
    {
      // Coming down out of it. The turn unwinds and the legs fold under him at
      // the same time, so what the eye tracks is the knees arriving rather than
      // the body rewinding.
      t: 0.50,
      pose: P({
        torso: 4, head: 4, hip: 0,
        thighR: 128, shinR: 54, footR: -104,
        thighL: 146, shinL: 44, footL: -96,
        upperArmR: 148, forearmR: -30, upperArmL: 210, forearmL: 26,
      }),
      offsetY: 1.35,
      rotation: -1.28,
      scaleY: 1.04,
    },
    {
      t: 0.62,
      pose: P({
        torso: 16, head: -10, hip: -2,
        thighR: 132, shinR: 76, footR: -122,
        thighL: 142, shinL: 78, footL: -126,
        upperArmR: 176, forearmR: -6, upperArmL: 194, forearmL: 4,
      }),
      offsetY: -1.1,
      rotation: -0.30,
      scaleY: 0.90,
    },
    {
      t: 0.88,
      pose: P({
        torso: 8, head: -6,
        thighR: 158, shinR: 36, footR: -102,
        thighL: 198, shinL: -10, footL: -88,
        upperArmR: 172, forearmR: -20, upperArmL: 194, forearmL: -16,
      }),
      offsetY: -0.3,
    },
    { t: 1, pose: P({ torso: 6, thighR: 162, shinR: 30, footR: -100, thighL: 200, shinL: -14, footL: -88, upperArmR: 178, forearmR: -24, upperArmL: 198, forearmL: -20 }) },
  ],
};

/**
 * Down smash: the split kick.
 *
 * Both hitboxes fire on the same frame, one in front and one behind, and the
 * move sends at 25° — a semi-spike that puts them offstage rather than up. So
 * the pose is a genuine split: the near boot out at (7.7, 2.0) and the far one
 * at (-6.4, 0.6), body dropped, stretched wide.
 *
 * **A split has to travel outward, not downward**, and getting that wrong is
 * what the floor test caught here three separate times. Going straight from
 * the gathered charge to the finished split swings both knees through straight
 * while the body is still dropping, and both boots pass a unit and a half
 * *under* the stage on the way — so there is a key at t=0.185 with the legs
 * half out and the feet still on the floor, which flattens the path.
 *
 * The rear ankle is the subtler half of the same problem. A toe pointing
 * cleanly backwards is 274° accumulated, and interpolating to it from a
 * planted 92° sweeps the whole 1.7-unit boot through *straight down* at the
 * midpoint, which is a foot buried to the shin. 198° — trailing down and back,
 * roughly in line with the leg — keeps the split just as wide, never passes
 * through vertical, and is what a leg sliding out along a floor actually
 * does.
 */
const dsmash: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 12, head: -10,
        thighR: 162, shinR: 30, footR: -102,
        thighL: 190, shinL: 6, footL: -104,
        upperArmR: 178, forearmR: -6, upperArmL: 190, forearmL: -6,
      }),
      offsetY: -0.3,
      ease: "in",
    },
    {
      // The charge pose, at `strike * 0.55` = 0.132: knees together, weight
      // dropped, arms clamped in. Everything gathered before it flies apart.
      t: 0.12,
      pose: P({
        torso: 20, head: -16,
        thighR: 118, shinR: 112, footR: -138,
        thighL: 126, shinL: 112, footL: -146,
        upperArmR: 150, forearmR: -48, upperArmL: 158, forearmL: -44,
      }),
      offsetY: -1.35,
      scaleX: 0.94,
      scaleY: 0.86,
      ease: "in",
    },
    {
      t: 0.185,
      pose: P({
        torso: 14, head: -10, hip: -2,
        thighR: 112, shinR: 36, footR: -58,
        thighL: 240, shinL: 0, footL: -148,
        upperArmR: 130, forearmR: 10, upperArmL: 206, forearmL: -10,
      }),
      offsetY: -1.6,
      scaleX: 1.1,
      scaleY: 0.85,
      ease: "in",
    },
    {
      t: 0.24,
      pose: P({
        torso: 6, head: -2, hip: -2,
        thighR: 106, shinR: -4, footR: -20,
        thighL: 260, shinL: 8, footL: -68,
        upperArmR: 112, forearmR: 50, upperArmL: 250, forearmL: -50,
      }),
      offsetY: -1.55,
      scaleX: 1.24,
      scaleY: 0.84,
      ease: "hold",
    },
    {
      t: 0.34,
      pose: P({
        torso: 6, head: -2, hip: -2,
        thighR: 106, shinR: -4, footR: -20,
        thighL: 260, shinL: 8, footL: -68,
        upperArmR: 112, forearmR: 50, upperArmL: 250, forearmL: -50,
      }),
      offsetY: -1.55,
      scaleX: 1.24,
      scaleY: 0.84,
      ease: "out",
    },
    {
      t: 0.54,
      pose: P({
        torso: 12, head: -8,
        thighR: 126, shinR: 80, footR: -118,
        thighL: 234, shinL: 16, footL: -146,
        upperArmR: 128, forearmR: 24, upperArmL: 232, forearmL: -24,
      }),
      offsetY: -1.5,
      scaleX: 1.1,
      scaleY: 0.88,
    },
    // He gathers the split back under himself before he stands. Both of the
    // last two keys name every bone, and both keep the boots on the floor —
    // pulling the legs in while the body is still two units down was putting
    // them through it.
    {
      t: 0.9,
      pose: P({
        torso: 14, head: -10,
        thighR: 140, shinR: 86, footR: -134,
        thighL: 148, shinL: 84, footL: -140,
        upperArmR: 158, forearmR: 0, upperArmL: 202, forearmL: -2,
      }),
      offsetY: -1.0,
      scaleX: 1.02,
      scaleY: 0.94,
    },
    {
      t: 1,
      pose: P({
        torso: 12, head: -8,
        thighR: 142, shinR: 82, footR: -132,
        thighL: 150, shinL: 80, footL: -138,
        upperArmR: 162, forearmR: -4, upperArmL: 198, forearmL: -6,
      }),
      offsetY: -0.9,
      scaleX: 1.01,
      scaleY: 0.96,
    },
  ],
};

/* --------------------------------------------------------------- aerials -- */

/**
 * Neutral air: the flying kick, and then the leg simply stays out.
 *
 * The strong hit is three frames long and the weak one is *seventeen* — 6% at
 * zero base knockback, which at low percent barely moves the victim and is the
 * whole reason the move exists. So the animation has to show the leg staying
 * out: the strike key holds from 0.20 all the way to 0.63, which is exactly
 * the frames the weak hitbox is live, and only then does he tuck.
 *
 * This is the one clip here where the long hold is not a stylistic choice
 * about snap. It is what the move *is*.
 */
const nair: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 6,
        thighR: 150, shinR: 46, footR: -100,
        thighL: 206, shinL: -6, footL: -88,
        upperArmR: 172, forearmR: -30, upperArmL: 196, forearmL: -26,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 4, head: -2, hip: -4,
        thighR: 116, shinR: -6, footR: -30,
        thighL: 226, shinL: 34, footL: -62,
        upperArmR: 128, forearmR: -34, upperArmL: 244, forearmL: 30,
      }),
      scaleX: 1.12,
      scaleY: 0.96,
      ease: "hold",
    },
    // The sex-kick window. Same drawing for seventeen frames, which is honest:
    // the hitbox does not change either.
    {
      t: 0.64,
      pose: P({
        torso: 4, head: -2, hip: -4,
        thighR: 120, shinR: -2, footR: -34,
        thighL: 224, shinL: 32, footL: -60,
        upperArmR: 130, forearmR: -32, upperArmL: 242, forearmL: 28,
      }),
      scaleX: 1.1,
      scaleY: 0.96,
      ease: "out",
    },
    {
      t: 0.82,
      pose: P({
        torso: 4,
        thighR: 140, shinR: 26, footR: -76,
        thighL: 212, shinL: 14, footL: -80,
        upperArmR: 152, forearmR: -26, upperArmL: 214, forearmL: 22,
      }),
      scaleX: 1.02,
    },
    { t: 1, pose: P({ torso: 2, thighR: 152, shinR: 38, thighL: 206, shinL: 4, upperArmR: 168, upperArmL: 200 }) },
  ],
};

/**
 * Forward air: five roundhouse kicks in quick succession.
 *
 * Five hitboxes, on action frames 6, 10, 15, 20 and 25, and `strike` only
 * anchors the first — the other four land wherever `poseTimeFor`'s recovery
 * ramp puts them, which for a 43-frame move with a 0.14 strike is t = 0.233,
 * 0.349, 0.465 and 0.581. Every one of those has a key on it, and the legs
 * alternate: near, far, near, far, near. Between kicks the knee comes back to
 * a chamber rather than to rest, so the flurry never stops moving.
 *
 * The first four are on an autolink angle that drags the victim along, and the
 * fifth is the finisher at 4.8% — so the fifth kick is the biggest of the five
 * and gets the only held extension in the clip.
 */
const fair: PoseClip = {
  loop: false,
  strike: 0.14,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 154, shinR: 54, footR: -110,
        thighL: 200, shinL: -4, footL: -88,
        upperArmR: 180, forearmR: -30, upperArmL: 190, forearmL: -26,
      }),
      ease: "in",
    },
    // 1 — near leg.
    {
      t: 0.14,
      pose: P({
        torso: -6, head: 6, hip: -6,
        thighR: 100, shinR: -4, footR: -20,
        thighL: 220, shinL: 44, footL: -58,
        upperArmR: 152, forearmR: -40, upperArmL: 226, forearmL: 34,
      }),
      offsetX: 0.2,
      scaleX: 1.1,
      scaleY: 0.96,
      ease: "out",
    },
    // 2 — far leg, while the near one folds back through the chamber.
    {
      t: 0.233,
      pose: P({
        torso: -4, head: 4, hip: -4,
        thighR: 148, shinR: 62, footR: -108,
        thighL: 104, shinL: -6, footL: -22,
        upperArmR: 226, forearmR: 32, upperArmL: 150, forearmL: -38,
      }),
      offsetX: 0.24,
      scaleX: 1.1,
      scaleY: 0.96,
      ease: "out",
    },
    // 3 — near.
    {
      t: 0.349,
      pose: P({
        torso: -6, head: 6, hip: -6,
        thighR: 98, shinR: -4, footR: -18,
        thighL: 218, shinL: 48, footL: -56,
        upperArmR: 150, forearmR: -40, upperArmL: 228, forearmL: 34,
      }),
      offsetX: 0.28,
      scaleX: 1.11,
      scaleY: 0.96,
      ease: "out",
    },
    // 4 — far.
    {
      t: 0.465,
      pose: P({
        torso: -4, head: 4, hip: -4,
        thighR: 146, shinR: 66, footR: -106,
        thighL: 100, shinL: -4, footL: -20,
        upperArmR: 228, forearmR: 32, upperArmL: 148, forearmL: -38,
      }),
      offsetX: 0.32,
      scaleX: 1.11,
      scaleY: 0.96,
      ease: "out",
    },
    // 5 — the finisher. Bigger than the four before it and held, because it is
    // the only one of the five that launches.
    {
      t: 0.581,
      pose: P({
        torso: -10, head: 8, hip: -8,
        thighR: 94, shinR: -8, footR: -12,
        thighL: 224, shinL: 40, footL: -60,
        upperArmR: 142, forearmR: -46, upperArmL: 240, forearmL: 40,
      }),
      offsetX: 0.45,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "hold",
    },
    {
      t: 0.68,
      pose: P({
        torso: -10, head: 8, hip: -8,
        thighR: 94, shinR: -8, footR: -12,
        thighL: 224, shinL: 40, footL: -60,
        upperArmR: 142, forearmR: -46, upperArmL: 240, forearmL: 40,
      }),
      offsetX: 0.45,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "out",
    },
    {
      t: 0.88,
      pose: P({
        torso: -2,
        thighR: 138, shinR: 34, footR: -84,
        thighL: 210, shinL: 16, footL: -80,
        upperArmR: 168, forearmR: -28, upperArmL: 204, forearmL: 24,
      }),
      offsetX: 0.2,
    },
    { t: 1, pose: P({ torso: 0, thighR: 152, shinR: 40, thighL: 204, shinL: 4 }) },
  ],
};

/**
 * Back air: the back turning kick.
 *
 * One hit, 13%, and the hardest thing he has in the air. He turns his back
 * into it and drives the heel out behind him: contact puts the boot at (-6.1,
 * 3.3) against a hitbox at (-6.5, 5.5) radius 3.6, with the head thrown
 * forward to (3.9, 8.9) as the counterweight. A back kick with the torso still
 * upright is a fighter falling over backwards, not a kick.
 *
 * It autocancels from frame 18 out of 48, which is why it is thrown out of a
 * short hop constantly — so the recovery has to *finish*, and he is back to a
 * neutral falling shape well before the clip ends.
 */
const bair: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -8,
        thighR: 154, shinR: 46, footR: -100,
        thighL: 204, shinL: -6, footL: -88,
        upperArmR: 176, forearmR: -26, upperArmL: 192, forearmL: -24,
      }),
      ease: "in",
    },
    {
      // Chambered: knee pulled up in front and the body already turning, so the
      // heel has the whole arc to travel through.
      t: 0.15,
      pose: P({
        torso: 26, head: -20, hip: 8,
        thighR: 128, shinR: 84, footR: -120,
        thighL: 216, shinL: 20, footL: -92,
        upperArmR: 200, forearmR: -30, upperArmL: 206, forearmL: -28,
      }),
      offsetX: 0.2,
      scaleX: 1.06,
      ease: "in",
    },
    {
      t: 0.22,
      pose: P({
        torso: 36, head: -26, hip: 10,
        thighR: 264, shinR: 0, footR: -92,
        thighL: 232, shinL: 24, footL: -112,
        upperArmR: 244, forearmR: 24, upperArmL: 238, forearmL: 22,
      }),
      offsetX: -0.6,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "hold",
    },
    {
      t: 0.32,
      pose: P({
        torso: 36, head: -26, hip: 10,
        thighR: 264, shinR: 0, footR: -92,
        thighL: 232, shinL: 24, footL: -112,
        upperArmR: 244, forearmR: 24, upperArmL: 238, forearmL: 22,
      }),
      offsetX: -0.6,
      scaleX: 1.16,
      scaleY: 0.94,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 20, head: -14, hip: 4,
        thighR: 226, shinR: 22, footR: -100,
        thighL: 214, shinL: 16, footL: -96,
        upperArmR: 210, forearmR: 6, upperArmL: 208, forearmL: 4,
      }),
      offsetX: -0.24,
      scaleX: 1.05,
    },
    { t: 0.78, pose: P({ torso: 8, thighR: 168, shinR: 28, footR: -96, thighL: 200, shinL: 0, footL: -88 }) },
    { t: 1, pose: P({ torso: 6, thighR: 156, shinR: 36, thighL: 202, shinL: 2 }) },
  ],
};

/**
 * Up air: the tail sweep, and then the heel.
 *
 * "From a mid-air somersault, Fox attacks above him with a tail sweep followed
 * by a heel kick." Two hitboxes, on action frames 8 and 11, and they are two
 * different attacks — the first is 5% with set knockback, the second is 10%
 * and is the one that kills.
 *
 * The first key swings the `hip` **70°** back, which is what carries the tail
 * up and over him — it is mounted on the hip's base in `rig.ts` precisely so a
 * pose can do this — with the torso taking 48° back and both thighs taking the
 * full 70°, so the only thing that actually moves is the tail and the arch.
 * Thirty degrees was the first attempt and it was not a sweep, it was a lean:
 * the tail has to leave the silhouette it normally occupies or there is
 * nothing to see. The second key is the heel: the near boot arrives at (0.3,
 * 13.2) against a hitbox at (0.5, 12.0), above his own head.
 */
const uair: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -6,
        thighR: 156, shinR: 42, footR: -98,
        thighL: 202, shinL: -4, footL: -88,
        upperArmR: 178, forearmR: -22, upperArmL: 194, forearmL: -20,
      }),
      ease: "in",
    },
    // Hit 1 — the tail. Hips thrown back and the chest opened, the arch that
    // whips the tail up over him.
    {
      t: 0.24,
      pose: P({
        torso: 48, head: 16, hip: -70,
        thighR: 238, shinR: 16, footR: -84,
        thighL: 268, shinL: 10, footL: -90,
        upperArmR: 66, forearmR: -26, upperArmL: 300, forearmL: 24,
      }),
      offsetY: 0.2,
      scaleX: 0.98,
      scaleY: 1.08,
      ease: "out",
    },
    // Hit 2 — the heel comes over the top.
    {
      t: 0.324,
      pose: P({
        torso: -18, head: 16, hip: -8,
        thighR: 6, shinR: 14, footR: -14,
        thighL: 56, shinL: 26, footL: -30,
        upperArmR: 44, forearmR: -18, upperArmL: 322, forearmL: 16,
      }),
      offsetY: 0.4,
      scaleX: 0.9,
      scaleY: 1.14,
      ease: "hold",
    },
    {
      t: 0.42,
      pose: P({
        torso: -18, head: 16, hip: -8,
        thighR: 6, shinR: 14, footR: -14,
        thighL: 56, shinL: 26, footL: -30,
        upperArmR: 44, forearmR: -18, upperArmL: 322, forearmL: 16,
      }),
      offsetY: 0.4,
      scaleX: 0.9,
      scaleY: 1.14,
      ease: "out",
    },
    {
      t: 0.64,
      pose: P({
        torso: -6, head: 6, hip: -2,
        thighR: 86, shinR: 34, footR: -66,
        thighL: 118, shinL: 30, footL: -60,
        upperArmR: 108, forearmR: -18, upperArmL: 254, forearmL: 16,
      }),
      offsetY: 0.14,
      scaleY: 1.04,
    },
    { t: 0.9, pose: P({ torso: 2, thighR: 150, shinR: 36, footR: -94, thighL: 204, shinL: 2, footL: -88 }) },
    { t: 1, pose: P({ torso: 0, thighR: 154, shinR: 34, thighL: 202, shinL: 2 }) },
  ],
};

/**
 * Down air: the drill.
 *
 * "A corkscrew kick that hits multiple times in quick succession" — seven
 * hitboxes on action frames 4, 7, 10, 13, 16, 19 and 22, six of them 1.4% at
 * 325° (down and forward, dragging the victim down with him) and then a 3%
 * launcher.
 *
 * A corkscrew turns about the body's own long axis, and this rig has no such
 * axis — `spin` turns him about his waist, which is a somersault and not a
 * drill. What a corkscrew looks like side-on is the body going *edge-on and
 * back again*, twice per turn, and that is expressible: `scaleX` pumps between
 * 0.72 and 1.0 on every hit while the legs alternate which one leads. Six
 * pumps in eighteen frames is the drill, and it stays legible at the size this
 * renders at, which a real rotation would not.
 *
 * Legs stay pinned together and pointed straight down throughout — the hitbox
 * is at y = -1.5, i.e. below his own feet, and a drill whose legs wander is
 * not a drill.
 */
const dair: PoseClip = {
  loop: false,
  strike: 0.1,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 6,
        thighR: 152, shinR: 50, footR: -104,
        thighL: 204, shinL: -4, footL: -88,
        upperArmR: 176, forearmR: -26, upperArmL: 192, forearmL: -24,
      }),
      ease: "in",
    },
    ...drillKeys(),
    // The launcher: the last hit is 3% at 60°, so he snaps straight and kicks
    // out of the drill rather than winding down out of it.
    {
      t: 0.46,
      pose: P({
        torso: 4, head: -2,
        thighR: 182, shinR: -8, footR: -104,
        thighL: 178, shinL: -6, footL: -102,
        upperArmR: 158, forearmR: -34, upperArmL: 202, forearmL: 32,
      }),
      offsetY: -0.7,
      scaleX: 1.04,
      scaleY: 1.22,
      ease: "out",
    },
    {
      t: 0.66,
      pose: P({
        torso: 2,
        thighR: 174, shinR: 10, footR: -98,
        thighL: 186, shinL: 8, footL: -96,
        upperArmR: 168, forearmR: -28, upperArmL: 196, forearmL: 26,
      }),
      offsetY: -0.3,
      scaleY: 1.08,
    },
    { t: 0.9, pose: P({ torso: 0, thighR: 166, shinR: 20, footR: -96, thighL: 194, shinL: 6, footL: -92 }) },
    { t: 1, pose: P({ torso: 0, thighR: 162, shinR: 24, thighL: 196, shinL: 8 }) },
  ],
};

/**
 * The six drill hits, at the `t` the six hitboxes actually land on.
 *
 * Written as a loop rather than as six hand-copied keys because the only thing
 * that differs between them is the phase, and six copies of the same twelve
 * numbers is six chances to typo one of them. The `t` values are
 * `poseTimeFor`'s own map for a 49-frame move with `firstActive` 4 and a 0.10
 * strike — action frames 4, 7, 10, 13, 16, 19.
 */
function drillKeys() {
  const T = [0.1, 0.16, 0.22, 0.28, 0.34, 0.4];
  return T.map((t, i) => {
    const phase = i % 2 === 0 ? 1 : -1;
    return {
      t,
      pose: P({
        torso: 2, head: -2, hip: phase * 4,
        // Legs together and straight down, alternating which one leads by a
        // few degrees — the scissor of a drill, not a stride.
        thighR: 180 - phase * 10, shinR: -4, footR: -100 + phase * 8,
        thighL: 180 + phase * 10, shinL: -4, footL: -100 - phase * 8,
        upperArmR: 150 + phase * 16, forearmR: -40,
        upperArmL: 210 - phase * 16, forearmL: 40,
      }),
      // Edge-on at every hit, face-on between them: two half-turns per full
      // revolution of the corkscrew.
      scaleX: i % 2 === 0 ? 0.74 : 1.0,
      scaleY: 1.2,
      offsetY: -0.45,
      ease: "out" as const,
    };
  });
}

/* ---------------------------------------------------------------- grab -- */

/**
 * Grab: he reaches out with his right arm.
 *
 * One arm, not two. The shared clip reaches with both, which is Donkey Kong's
 * grab and Mario's, and on a fighter this narrow it reads as a lunge. The far
 * arm stays down and back as the counterweight; the hand arrives at (5.0, 8.1)
 * against a grab box at (6.0, 6.4) radius 3.0.
 */
const grab: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -4, head: 4,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 156, forearmR: -54, upperArmL: 188, forearmL: -34,
      }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 8, head: -6, hip: -2,
        thighR: 166, shinR: 20, footR: -98,
        thighL: 198, shinL: -18, footL: -84,
        upperArmR: 94, forearmR: 0, handR: 0,
        upperArmL: 198, forearmL: -44,
      }),
      offsetX: 0.4,
      scaleX: 1.06,
      ease: "hold",
    },
    {
      t: 0.36,
      pose: P({
        torso: 8, head: -6, hip: -2,
        thighR: 166, shinR: 20, footR: -98,
        thighL: 198, shinL: -18, footL: -84,
        upperArmR: 94, forearmR: 0, handR: 0,
        upperArmL: 198, forearmL: -44,
      }),
      offsetX: 0.4,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.58,
      pose: P({
        torso: 4, head: -2,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 118, forearmR: -18, upperArmL: 194, forearmL: -38,
      }),
      offsetX: 0.18,
    },
    {
      t: 0.9,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 150, forearmR: -40, upperArmL: 190, forearmL: -36,
      }),
    },
    {
      t: 1,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -98,
        thighL: 200, shinL: -18, footL: -84,
        upperArmR: 158, forearmR: -44, upperArmL: 192, forearmL: -38,
      }),
    },
  ],
};

/* ------------------------------------------------------------- specials -- */

/**
 * Reflector. Frame 3, and it reflects from frame 4 through frame 23.
 *
 * The fastest thing on the roster and the purest case for `hold` in the whole
 * project: there are exactly three samples before contact — t 0, 0.10, 0.20 —
 * so nothing subtle in the wind-up is ever drawn, and the shape has to arrive
 * whole. It then sits *completely still* until t = 0.67, which is action frame
 * 22, the last frame the reflector actually reflects, and then he cuts it off.
 *
 * Holding a pose for twenty frames feels wrong to author and is right on
 * screen: what a player has to read is "the shine is up", for exactly as long
 * as it is up. A shine that drifts through its own active frames is telling
 * them something false about when it ends.
 */
const downB: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      // Already dropping on the first frame. A neutral standing key here would
      // spend the entire wind-up getting to where the move starts.
      t: 0,
      pose: P({
        torso: 10, head: -8,
        thighR: 158, shinR: 44, footR: -110,
        thighL: 190, shinL: 6, footL: -102,
        upperArmR: 140, forearmR: -50, upperArmL: 186, forearmL: -30,
      }),
      offsetY: -0.5,
      ease: "in",
    },
    {
      // Deployed: low, wide, braced, the device held out in front at chest
      // height where the hitbox is (2.0, 5.5).
      t: 0.2,
      pose: P({
        torso: 14, head: -10, hip: -4,
        thighR: 136, shinR: 74, footR: -118,
        thighL: 214, shinL: 20, footL: -140,
        upperArmR: 96, forearmR: -14, handR: 0,
        upperArmL: 214, forearmL: -52,
      }),
      offsetY: -1.3,
      offsetX: 0.2,
      scaleX: 1.08,
      scaleY: 0.9,
      ease: "hold",
    },
    {
      // One frame of settle inside the hold so he is braced rather than frozen,
      // and then held again. The silhouette does not change.
      t: 0.32,
      pose: P({
        torso: 12, head: -8, hip: -4,
        thighR: 138, shinR: 72, footR: -118,
        thighL: 214, shinL: 20, footL: -140,
        upperArmR: 98, forearmR: -12, handR: 0,
        upperArmL: 212, forearmL: -50,
      }),
      offsetY: -1.24,
      offsetX: 0.2,
      scaleX: 1.08,
      scaleY: 0.9,
      ease: "hold",
    },
    {
      t: 0.67,
      pose: P({
        torso: 12, head: -8, hip: -4,
        thighR: 138, shinR: 72, footR: -118,
        thighL: 214, shinL: 20, footL: -140,
        upperArmR: 98, forearmR: -12, handR: 0,
        upperArmL: 212, forearmL: -50,
      }),
      offsetY: -1.24,
      offsetX: 0.2,
      scaleX: 1.08,
      scaleY: 0.9,
      ease: "out",
    },
    {
      t: 0.84,
      pose: P({
        torso: 6, head: -4,
        thighR: 160, shinR: 30, footR: -100,
        thighL: 200, shinL: -8, footL: -88,
        upperArmR: 142, forearmR: -40, upperArmL: 196, forearmL: -34,
      }),
      offsetY: -0.4,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 168, forearmR: -36, upperArmL: 194, forearmL: -32 }) },
  ],
};

/**
 * Blaster: a draw, a shot, and then he keeps it trained on you.
 *
 * "Takes his Blaster out of its holster and fires at the opponent." The
 * defining property of the move is that it causes *nothing but damage* — no
 * flinch, no hitstun, no launch — so it is not a strike and must not be
 * animated as one. The shared clip is a straight punch, which is wrong twice
 * over: it reaches with the wrong intent and it reaches at the wrong time.
 *
 * **This clip's timing is unusual and worth stating.** `neutralB` has
 * `hitboxes: []` in `fighters/fox.ts` — the move itself has no hitbox, only a
 * projectile — so `poseTimeFor` takes its fallback branch and **`strike` is
 * ignored entirely**: `t = actionFrame / 36`, plain and linear. The `strike`
 * below is therefore documentation and a test anchor, not a lever. Every key
 * is placed at its real fraction by hand:
 *
 *   - t 0.085 — action frame 3, the hand reaches the holster on his right hip
 *     (which `rig.ts` puts there for exactly this reason).
 *   - t 0.278 — action frame 10, the frame the bolt spawns. Arm locked out.
 *   - t 0.333 — the recoil. The muzzle kicks up and the elbow eats it.
 *   - t 0.40 to 0.64 — back on target and *held*, because holding the button
 *     fires again and a Fox who lowers his gun between shots is telling the
 *     opponent it is safe to approach.
 *   - t 0.972 — action frame 35, the last frame drawn at all.
 *
 * The draw itself is the snap: `ease: "in"` across the seven frames from the
 * holster to the shot means the gun barely moves for four of them and then
 * covers the whole distance in three.
 */
const neutralB: PoseClip = {
  loop: false,
  strike: 0.278,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -2, head: 2,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 178, forearmR: -6, upperArmL: 190, forearmL: -22,
      }),
      ease: "in",
    },
    {
      // Hand on the holster, weight dropping onto the back foot. The arm chain
      // bottoms out at about y = 4.2 from a shoulder at 8.5, so this is as low
      // as he physically reaches — which is the hip, which is where it is.
      t: 0.085,
      pose: P({
        torso: -6, head: 6, hip: 2,
        thighR: 166, shinR: 20, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 160, forearmR: 38, upperArmL: 190, forearmL: -30,
      }),
      offsetY: -0.3,
      ease: "in",
    },
    {
      // Fired. Hand at (4.1, 7.0), which puts the muzzle of the pistol
      // `fx.neutralB` paints within half a unit of the (7.0, 6.0) the bolt
      // actually spawns at.
      t: 0.278,
      pose: P({
        torso: 6, head: -4, hip: -4,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 122, forearmR: -16, handR: 0,
        upperArmL: 198, forearmL: -54,
      }),
      offsetX: 0.2,
      ease: "out",
    },
    {
      // Recoil. Small — this is a sidearm, not a cannon, and a whole-body
      // lurch would make the flinchless shot look like it hit something.
      t: 0.333,
      pose: P({
        torso: 2, head: 0, hip: -2,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 112, forearmR: -24, handR: -8,
        upperArmL: 198, forearmL: -54,
      }),
      offsetX: 0.05,
      ease: "out",
    },
    {
      t: 0.4,
      pose: P({
        torso: 5, head: -3, hip: -4,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 120, forearmR: -17, handR: 0,
        upperArmL: 198, forearmL: -54,
      }),
      offsetX: 0.18,
      ease: "hold",
    },
    {
      // Still on target. Twelve frames of one drawing: he is waiting to see
      // whether you walk into the next one.
      t: 0.64,
      pose: P({
        torso: 5, head: -3, hip: -4,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 120, forearmR: -17, handR: 0,
        upperArmL: 198, forearmL: -54,
      }),
      offsetX: 0.18,
      ease: "out",
    },
    {
      t: 0.86,
      pose: P({
        torso: 0, head: 0,
        thighR: 168, shinR: 18, footR: -98,
        thighL: 202, shinL: -20, footL: -82,
        upperArmR: 150, forearmR: 4, upperArmL: 192, forearmL: -34,
      }),
      offsetX: 0.06,
    },
    { t: 1, pose: P({ torso: -2, upperArmR: 172, forearmR: 6, upperArmL: 190, forearmL: -26 }) },
  ],
};

/**
 * Fox Illusion: three drawings, not a curve.
 *
 * "Dashes forward at a blindingly fast speed, leaving behind afterimages" —
 * about half of Final Destination in one move. The hitbox sits at `x: -3.0`,
 * *behind* him, which is why the move passes through an opponent and catches
 * them on the way out, and it is also the clue to the shape: he is already
 * past you when it lands.
 *
 * Nothing happens for sixteen frames but a spring winding, and the coil is
 * then *held* through action frames 14, 15 and 16 so the eye gets one clean
 * shape to have taken away from it. `hold` is doing real work there: the
 * engine's own `momentum` entry launches him on action frame 17, and a coil
 * that eased into the streak would slide forward still crouched.
 *
 * Action frames 17 to 24 are one drawing — body pitched forward, stretched to
 * 1.5x and squashed to 0.78, head leading, limbs streaming back past the
 * pelvis — because a smear that changes is not a smear. Then it stops, and it
 * stops in two frames: the `out` span puts three quarters of the way to the
 * plant on frame 25. Everything after is thirty frames of skid moving a
 * fraction as far per frame, which is the contrast the whole move is made of.
 *
 * `offsetX` is only ever the coil's load and the skid's overshoot. The engine
 * already moves him 6.2 units a frame; adding travel here makes him teleport.
 */
const sideB: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    // The gather. Weight settling back onto both legs, arms starting to drop
    // behind him. Cubic `in` out of here, so the first eight frames barely move.
    {
      t: 0,
      pose: P({
        hip: -6, torso: 26, head: -22,
        thighR: 146, shinR: 50, footR: -92,
        thighL: 152, shinL: 52, footL: -100,
        upperArmR: 198, forearmR: -6,
        upperArmL: 192, forearmL: -4,
      }),
      offsetX: -0.4,
      offsetY: -0.45,
      ease: "in",
    },
    // Frames 14-16, one drawing: a sprinter's set. Hips dropped and pulled back
    // behind the feet, back flat, head up and looking down the dash, both arms
    // cocked back above the tail. Then it cuts.
    {
      t: 0.17,
      pose: P({
        hip: -16, torso: 62, head: -46,
        thighR: 122, shinR: 96, footR: -84,
        thighL: 130, shinL: 98, footL: -94,
        upperArmR: 214, forearmR: 34,
        upperArmL: 206, forearmL: 30,
      }),
      offsetX: -1.3,
      offsetY: -1.3,
      scaleX: 0.95,
      scaleY: 0.9,
      ease: "hold",
    },
    // Frame 17: gone. The streak — the only drawing anyone remembers this move
    // by. The feet leave the ground because at this speed they have to.
    {
      t: 0.21,
      pose: P({
        hip: 26, torso: 22, head: -46,
        thighR: 228, shinR: 20, footR: -8,
        thighL: 246, shinL: 8, footL: -12,
        upperArmR: 198, forearmR: 20,
        upperArmL: 206, forearmL: 16,
      }),
      offsetX: 0.5,
      offsetY: -1.35,
      scaleX: 1.5,
      scaleY: 0.79,
      ease: "in",
    },
    // Frame 24, the hitbox. The same drawing four degrees further out.
    {
      t: 0.3,
      pose: P({
        hip: 28, torso: 22, head: -48,
        thighR: 234, shinR: 22, footR: -10,
        thighL: 252, shinL: 8, footL: -14,
        upperArmR: 200, forearmR: 22,
        upperArmL: 208, forearmL: 18,
      }),
      offsetX: 0.85,
      offsetY: -1.42,
      scaleX: 1.58,
      scaleY: 0.76,
      ease: "out",
    },
    // The plant. A sprinter stopping brings the knee *up and forward* first and
    // puts the foot down second, and it turns out the animation has to as well:
    // swinging the lead leg straight from the streak to the skid rotates the
    // ankle through vertical while the leg is at full stretch, and the boot
    // goes two units under the stage on the way. Knee up, body up, then plant.
    {
      t: 0.335,
      pose: P({
        hip: 10, torso: 34, head: -30,
        thighR: 150, shinR: 90, footR: -142,
        thighL: 226, shinL: 26, footL: -52,
        upperArmR: 220, forearmR: 28,
        upperArmL: 228, forearmL: 24,
      }),
      offsetX: 0.7,
      offsetY: -0.85,
      scaleX: 1.36,
      scaleY: 0.82,
    },
    // Frames 25-27: the arrival. Lead leg thrown out in front of the pelvis to
    // catch him, trailing leg kicked up behind, both arms flung back. The whole
    // deceleration is these two frames.
    {
      t: 0.42,
      pose: P({
        hip: -10, torso: 30, head: -26,
        thighR: 132, shinR: 24, footR: -56,
        thighL: 202, shinL: 88, footL: -130,
        upperArmR: 238, forearmR: 34,
        upperArmL: 246, forearmL: 30,
      }),
      offsetX: 1.0,
      offsetY: -1.0,
      scaleX: 1.24,
      scaleY: 0.86,
    },
    // The bottom of the skid. Knees folded, hips at their lowest, torso rocked
    // back past vertical — a fighter braking leans away from where he was
    // going, and this is the frame the recovery lag is legible in.
    {
      t: 0.44,
      pose: P({
        hip: -18, torso: 14, head: 0,
        thighR: 124, shinR: 100, footR: -88,
        thighL: 196, shinL: 88, footL: -136,
        upperArmR: 240, forearmR: 20,
        upperArmL: 246, forearmL: 16,
      }),
      offsetX: 0.5,
      offsetY: -1.37,
      scaleX: 1.06,
      scaleY: 0.94,
    },
    // Weight recentring. Slow — a degree or two a frame against the streak's
    // forty.
    {
      t: 0.56,
      pose: P({
        hip: -6, torso: 14, head: -10,
        thighR: 140, shinR: 66, footR: -94,
        thighL: 186, shinL: 52, footL: -110,
        upperArmR: 210, forearmR: -4,
        upperArmL: 216, forearmL: -2,
      }),
      offsetX: 0.2,
      offsetY: -0.6,
      scaleX: 1.03,
      scaleY: 0.98,
    },
    {
      t: 0.78,
      pose: P({
        torso: 6, head: -4,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 194, shinL: 20, footL: -104,
        upperArmR: 168, forearmR: -14,
        upperArmL: 190, forearmL: -12,
      }),
      offsetY: -0.14,
    },
    {
      t: 1,
      pose: P({
        torso: 2, head: 0,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 194, shinL: 20, footL: -104,
        upperArmR: 172, forearmR: -8, upperArmL: 188, forearmL: -6,
      }),
    },
  ],
};

/**
 * Fire Fox: nineteen frames of gathering, and then he is gone.
 *
 * Ninety-one frames long, and the shared clip spends all of them slowly
 * drifting, which is the exact inverse of the real move. What it actually is:
 * a long, *still* charge with flame building around a body that is not moving,
 * an ignition on action frame 19 that is a hard cut, and then a rigid comet.
 *
 * So the coil is reached by t = 0.12 and then `hold` freezes it for nine
 * frames while `fx.upB` does the work; the ignition at t = 0.22 is where the
 * engine's own momentum starts (`momentum: frame 20`); the launch hitbox is at
 * t = 0.47 and the trailing body hitbox runs to t = 0.78, through which he is
 * one straight line; and only then does he come apart.
 *
 * No large `offsetY` on the flight keys: the engine is already carrying him
 * 4.3 units a frame upward and a translation on top of that puts him through
 * the top of the screen.
 */
const upB: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -6,
        thighR: 160, shinR: 34, footR: -102,
        thighL: 198, shinL: -12, footL: -86,
        upperArmR: 166, forearmR: -34, upperArmL: 192, forearmL: -30,
      }),
      ease: "in",
    },
    {
      // The coil. Curled in on himself, arms clamped across the chest, head
      // down — a shape that is obviously storing something.
      t: 0.12,
      pose: P({
        torso: 30, head: -24, hip: -8,
        thighR: 126, shinR: 96, footR: -132,
        thighL: 134, shinL: 92, footL: -132,
        upperArmR: 136, forearmR: -78, upperArmL: 144, forearmL: -74,
      }),
      offsetY: -1.9,
      scaleX: 1.1,
      scaleY: 0.86,
      ease: "hold",
    },
    {
      // Ignition, action frame 19. A cut, not a transition.
      t: 0.22,
      pose: P({
        torso: -2, head: 4, hip: 0,
        thighR: 178, shinR: 2, footR: -94,
        thighL: 182, shinL: 2, footL: -96,
        upperArmR: 176, forearmR: -6, upperArmL: 184, forearmL: 6,
      }),
      offsetY: 0.2,
      rotation: 0.1,
      scaleX: 0.84,
      scaleY: 1.18,
      ease: "out",
    },
    {
      // Rising. Rigid, aligned with the launch, which the momentum entry puts
      // at about 73° above horizontal.
      t: 0.34,
      pose: P({
        torso: 0, head: 2,
        thighR: 180, shinR: 0, footR: -92,
        thighL: 180, shinL: 0, footL: -92,
        upperArmR: 178, forearmR: -2, upperArmL: 182, forearmL: 2,
      }),
      rotation: 0.28,
      scaleX: 0.8,
      scaleY: 1.24,
      ease: "hold",
    },
    {
      // The launch hitbox, action frame 42. Maximum extension.
      t: 0.47,
      pose: P({
        torso: 0, head: 2,
        thighR: 180, shinR: 0, footR: -92,
        thighL: 180, shinL: 0, footL: -92,
        upperArmR: 178, forearmR: -2, upperArmL: 182, forearmL: 2,
      }),
      rotation: 0.3,
      scaleX: 0.76,
      scaleY: 1.3,
      ease: "hold",
    },
    {
      // The trailing body hitbox runs to action frame 71. He is a projectile
      // and projectiles do not gesture.
      t: 0.78,
      pose: P({
        torso: 0, head: 2,
        thighR: 180, shinR: 0, footR: -92,
        thighL: 180, shinL: 0, footL: -92,
        upperArmR: 178, forearmR: -2, upperArmL: 182, forearmL: 2,
      }),
      rotation: 0.3,
      scaleX: 0.76,
      scaleY: 1.3,
      ease: "out",
    },
    {
      // He comes apart. Everything he was holding in lets go at once.
      t: 0.9,
      pose: P({
        torso: 12, head: -8,
        thighR: 156, shinR: 40, footR: -100,
        thighL: 202, shinL: 16, footL: -92,
        upperArmR: 222, forearmR: 34, upperArmL: 152, forearmL: -30,
      }),
      rotation: 0.46,
      scaleY: 1.02,
    },
    {
      t: 1,
      pose: P({
        torso: 14, thighR: 152, shinR: 44, thighL: 206, shinL: 20,
        upperArmR: 232, forearmR: 40, upperArmL: 144, forearmL: -36,
      }),
      rotation: 0.5,
    },
  ],
};

export const poses: Partial<Record<PoseName, PoseClip>> = {
  idle,
  jab,
  ftilt,
  utilt,
  dtilt,
  dashAttack,
  fsmash,
  usmash,
  dsmash,
  nair,
  fair,
  bair,
  uair,
  dair,
  grab,
  neutralB,
  sideB,
  upB,
  downB,
};
