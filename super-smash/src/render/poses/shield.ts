/**
 * Holding shield, and dropping it.
 *
 * ## What `drawShield` leaves for the pose to do
 *
 * This is the clip in the library that is mostly *covered up*. `drawShield`
 * fills a port-coloured disc of radius `0.92 × fighterHeight × (0.5 + 0.5 ×
 * hp)`, centred half a body up, over everything below — at full health that is
 * a bubble nearly twice the fighter's height, and even an almost-broken shield
 * still swallows the torso. The fill is only a quarter opaque, so the fighter
 * is not hidden so much as washed — but a coloured wash plus a heavy ring, on a
 * figure an eighth of the screen tall, is the end of anything between the hips
 * and the chin.
 *
 * So the effort here is deliberately lopsided, and the next person to open this
 * file should know that was a choice rather than an unfinished job. Three
 * things survive the bubble and got the attention:
 *
 * - **The size of the silhouette**, which is all the tint leaves of the upper
 *   body. A shield pose the same height as `idle` says nothing. This one is a
 *   tenth shorter than standing at the loosest point of its cycle and a seventh
 *   shorter at the brace — about half way to `crouch` — and gets some of that
 *   from squash rather than knee bend, because `scaleY` compresses a braced
 *   body about the floor and so costs nothing in planting.
 * - **The legs and feet.** They sit at the bottom edge of the disc where the
 *   fill is thinnest, and near zero health they are outside it altogether —
 *   Ultimate's shield poking is exactly a shrinking bubble uncovering
 *   extremities. So the stance is *staggered*, near ankle a unit behind the far
 *   one, because side-on that is the only way two legs read as two legs: the
 *   first draft had both knees in the same place and the fighter was a column
 *   with a shoe under it.
 * - **Coming out of shield**, which is `shieldRelease` below, and which is
 *   where the bubble finally gets out of the way: its alpha fades as
 *   `1 − actionFrame/11`.
 *
 * Torso and arm detail got the time left over, which was not much. The guard is
 * shaped so nothing juts out of the body's mass — the hands end up level with
 * the knees, which is as far forward as anything gets — and past that it is not
 * visible and was not laboured.
 *
 * ## Planting, which is a per-rig problem
 *
 * Every key keeps the soles **flat**: the foot angle is solved as `92 −
 * accumulated shin`, which is the rig's own rest orientation generalised to a
 * bent knee. That matters more than it sounds, because all eight fighters share
 * these angles and their bone lengths do not match. A pointed foot spends that
 * variation on *depth*, so one `offsetY` buries Donkey Kong's feet while
 * Kirby's hover; a flat one spends it on shoe length, which nobody notices.
 * `offsetY` is then solved per key against the drawn sole rather than picked by
 * eye, with `idle` as the reference for where a planted fighter's sole sits —
 * the test file asserts it, on the three rigs that bracket the roster. What is
 * left is a residue under a fifth of a unit between the longest legs and the
 * shortest, which one shared clip cannot remove: the same knee bend lifts a
 * long shin further than a short one, and only `offsetY` is there to pay for
 * it.
 *
 * ## Ultimate's shield, in the numbers this animates to
 *
 * A shield decays at 0.15 a frame from 50, so a full one survives about 5.6
 * seconds of holding, and regenerates at 0.08 while down. It must be held 3
 * frames before it can be dropped (`SHIELD_MIN_HOLD`), the drop takes 11 frames
 * (`SHIELD_RELEASE_FRAMES`), and the **first 5 of those 11 parry** — Ultimate
 * moved the perfect shield from the press to the release, which is the most
 * consequential defensive change in the series. Up special, up smash and jump
 * cancel the drop; everything else waits it out. Sources: SmashWiki
 * [Shield], [Perfect shield], [Out of shield], and
 * `research/physics-and-knockback.md` §"Perfect shield is on release".
 *
 * ## What this clip cannot say
 *
 * It cannot express decay. A fighter inside a shrinking bubble should look
 * progressively more crowded, and the pose layer is never told the shield's
 * health: `PosedFighter` in `timing.ts` carries `action`, `actionFrame`,
 * `charge` and six other fields, and `shieldHealth` is not among them. The
 * breathing below is a *strain cycle* and is written as one — it returns to
 * where it started every 42 frames, which health never does. Nothing here fakes
 * the decay by leaning on `actionFrame` as a stand-in for it, which would be
 * wrong twice over: shieldstun resets the counter, and re-entering shield
 * resets it while the health carries over. Real crowding needs `shieldHealth`
 * on `PosedFighter` and a branch in `poseTimeFor` mapping it to clip time, the
 * way `charge` already parks a charging smash partway up its wind-up. That is a
 * `timing.ts` change and is not made here.
 */

import { P, type PoseClip } from "./clip";

/**
 * The guard, as a 42-frame cycle rather than a photograph.
 *
 * Looping is the load-bearing decision. A shield is held for as long as the
 * button is, which the state machine models by letting `actionFrame` run
 * unbounded — and `poseTimeFor` gives a non-looping clip `actionFrame / 30`
 * clamped at 1, so a still guard would traverse its keys in half a second and
 * then be a frozen drawing for the remaining five seconds of the shield's life.
 * A cycle never freezes, and at 42 frames it reads as bracing under load rather
 * than as breathing — `idle` takes 108 for a breath, and a fighter behind a
 * shield is not relaxed.
 *
 * `t = 0` is the hardest, most compressed frame of the cycle, and that is worth
 * more than it looks: `shieldStart` and `shieldStun` share this clip, and both
 * restart `actionFrame` at 0. So raising the shield snaps to the brace and then
 * settles out of it, and — the useful one — **every hit on the shield re-braces
 * it**, for free, with no shieldstun-specific clip and nothing here knowing a
 * hit happened. The fighter compresses under the blow and eases back out across
 * the frames of shieldstun that follow.
 */
export const shield: PoseClip = {
  loop: true,
  period: 42,
  keys: [
    // The brace. Weight sunk between the feet, hips back, chin buried, hands
    // stacked in front of the face. This is the frame a hit lands on.
    {
      t: 0,
      pose: P({
        hip: -4, torso: 18, head: -10,
        thighR: 153, shinR: 85, footR: -142,
        thighL: 133, shinL: 85, footL: -122,
        upperArmR: 162, forearmR: -148,
        upperArmL: 170, forearmL: -152,
      }),
      offsetY: -0.94,
      offsetX: -0.10,
      scaleY: 0.94,
      scaleX: 1.04,
      // Cubic-out: the fighter comes off the brace at once and then creeps,
      // which is how a body under load actually unloads.
      ease: "out",
    },
    // Settled. A fifth of a unit of knee bend has come back, the stagger has
    // closed a little and the guard has opened by a hand's width. This is the
    // shape a shield spends most of its life in.
    {
      t: 0.45,
      pose: P({
        hip: -3, torso: 15, head: -8,
        thighR: 154, shinR: 77, footR: -136,
        thighL: 137, shinL: 77, footL: -119,
        upperArmR: 163, forearmR: -140,
        upperArmL: 171, forearmL: -145,
      }),
      offsetY: -0.80,
      offsetX: -0.07,
      scaleY: 0.965,
      scaleX: 1.025,
      // Cubic-in: it dwells here, then tightens back up late in the cycle.
      ease: "in",
    },
    // Re-gripping. Not a new shape — the same guard being tightened, which is
    // what stops the cycle reading as a sine wave with a fighter drawn on it.
    {
      t: 0.76,
      pose: P({
        hip: -3, torso: 17, head: -9,
        thighR: 153, shinR: 81, footR: -139,
        thighL: 135, shinL: 81, footL: -121,
        upperArmR: 162, forearmR: -143,
        upperArmL: 170, forearmL: -148,
      }),
      offsetY: -0.88,
      offsetX: -0.08,
      scaleY: 0.95,
      scaleX: 1.033,
    },
  ],
};

/**
 * Dropping shield: 11 frames, and the first 5 of them are a parry.
 *
 * `poseTimeFor` divides `actionFrame` by `SHIELD_RELEASE_FRAMES`, so this clip
 * is only ever sampled at `n/11` for n in 0..10. Frames 0 to 4 get a key each —
 * they are *drawn*, not travelled through — and the tail is keyed at 6, 8 and
 * 10 and interpolated between. That split is the animation's whole argument:
 * the parry window is the part with something to say.
 *
 * Those five frames have to sell a decision, and they have to do it through a
 * bubble still at two thirds of its opacity when they end. Detail is hopeless there, so the
 * read is silhouette-scale: the fighter uncoils out of the guard and *grows out
 * of the shield*, arriving on frame 4 taller than standing with the chest open
 * and both arms flung back past the hips. That is also the frame a successful
 * parry flashes white on, so it is the one drawing here anybody will study.
 *
 * Frames 5 to 10 are the opposite and are meant to look it. This is the drop
 * lag — the frames an opponent is punishing, and the ones up special, up smash
 * and jump exist to skip. Nothing decisive happens: the overshoot collapses
 * back onto bent knees, the arms swing through and settle, and the fighter
 * arrives at neutral. Frame 10 is `idle`'s settle key bone for bone, so the
 * handover to `stand` is not a cut — and because every key keeps the soles
 * flat, the feet arrive there turning a few degrees a frame instead of
 * whipping round at the end.
 */
export const shieldRelease: PoseClip = {
  loop: false,
  keys: [
    // Frame 0. Still the guard — the frame the button came up on, before
    // anything has moved. It has to sit inside `shield`'s cycle or the cut from
    // the hold is visible.
    {
      t: 0,
      pose: P({
        hip: -4, torso: 17, head: -9,
        thighR: 154, shinR: 81, footR: -139,
        thighL: 136, shinL: 81, footL: -121,
        upperArmR: 163, forearmR: -145,
        upperArmL: 171, forearmL: -150,
      }),
      offsetY: -0.86,
      offsetX: -0.08,
      scaleY: 0.95,
      scaleX: 1.03,
    },
    // Frame 1. The guard cracks. Elbows open first and the hips are already
    // driving — one frame in, and the fighter is unmistakably leaving shield.
    {
      t: 1 / 11,
      pose: P({
        hip: -3, torso: 16, head: -9,
        thighR: 156, shinR: 71, footR: -132,
        thighL: 142, shinL: 71, footL: -118,
        upperArmR: 166, forearmR: -118,
        upperArmL: 174, forearmL: -124,
      }),
      offsetY: -0.69,
      offsetX: -0.05,
      scaleY: 0.975,
      scaleX: 1.018,
    },
    // Frame 2. The drive. Knees extending hard, arms swinging down and forward
    // through the body's line, head coming up off the chest.
    {
      t: 2 / 11,
      pose: P({
        hip: -2, torso: 12, head: -7,
        thighR: 162, shinR: 52, footR: -120,
        thighL: 152, shinL: 52, footL: -110,
        upperArmR: 176, forearmR: -50,
        upperArmL: 185, forearmL: -58,
      }),
      offsetY: -0.41,
      offsetX: 0,
      scaleY: 0.995,
      scaleX: 1.005,
    },
    // Frame 3. Nearly extended, chest opening, arms passing the hips.
    {
      t: 3 / 11,
      pose: P({
        hip: -1, torso: 6, head: -5,
        thighR: 170, shinR: 27, footR: -104,
        thighL: 165, shinL: 27, footL: -99,
        upperArmR: 196, forearmR: -12,
        upperArmL: 204, forearmL: -20,
      }),
      offsetY: -0.14,
      offsetX: 0.04,
      scaleY: 1.02,
      scaleX: 0.985,
    },
    // Frame 4 — the last parry frame, and the extreme of the clip. Taller than
    // standing, chest thrown open, both arms swung back behind the hips.
    // Everything before this was the fighter getting out of the shield; from
    // here they are out of it and paying for it.
    {
      t: 4 / 11,
      pose: P({
        hip: 2, torso: -3, head: 0,
        thighR: 176, shinR: 5, footR: -91,
        thighL: 184, shinL: -3, footL: -91,
        upperArmR: 218, forearmR: -14,
        upperArmL: 226, forearmL: -18,
      }),
      offsetY: -0.07,
      offsetX: 0.07,
      scaleY: 1.04,
      scaleX: 0.97,
      // Frame 5 — the first frame that can be hit again — sits halfway down
      // out of the overshoot. Easing out instead would put most of that
      // collapse into frame 5 alone and make the busiest drawing in the clip
      // one the fighter gets no credit for.
      ease: "smooth",
    },
    // Frame 6. The collapse out of the overshoot: knees take the weight again
    // and the arms swing forward through neutral. The parry is over.
    {
      t: 6 / 11,
      pose: P({
        hip: -2, torso: 8, head: -6,
        thighR: 165, shinR: 43, footR: -114,
        thighL: 156, shinL: 43, footL: -106,
        upperArmR: 170, forearmR: 20,
        upperArmL: 184, forearmL: -12,
      }),
      offsetY: -0.28,
      offsetX: 0.04,
      scaleY: 0.985,
      scaleX: 1.015,
      // Cubic-in holds frame 7 down near this shape. The drop lag should look
      // like time the fighter is not getting back, not like a recovery.
      ease: "in",
    },
    // Frame 8. The dwell. Barely a different drawing from frame 6, on purpose.
    {
      t: 8 / 11,
      pose: P({
        hip: -2, torso: 6, head: -5,
        thighR: 168, shinR: 35, footR: -109,
        thighL: 161, shinL: 35, footL: -103,
        upperArmR: 164, forearmR: 16,
        upperArmL: 194, forearmL: -14,
      }),
      offsetY: -0.21,
      offsetX: 0.02,
      scaleY: 0.99,
      scaleX: 1.008,
      ease: "out",
    },
    // Frame 10, the last frame this clip is ever sampled on: `idle`'s settle
    // key bone for bone, with the feet on the rest angles it leaves them at, so
    // the state machine's handover to `stand` costs nothing. `idle` is driven
    // off the global frame, so a fighter arrives at an arbitrary phase of the
    // breath — but the whole cycle lives inside about four degrees, so landing
    // on any one key of it is landing on all four. The test asserts the seam
    // rather than trusting these numbers to stay in step with `idle.ts`.
    {
      t: 10 / 11,
      pose: P({
        hip: 0.8, torso: 5.5, head: -4.1,
        thighR: 174.7, shinR: 5.0, footR: -88,
        thighL: 179.7, shinL: 3.0, footL: -88,
        upperArmR: 162.5, forearmR: 21.7,
        upperArmL: 195.0, forearmL: -17.5,
      }),
      offsetY: 0.02,
      offsetX: 0,
    },
  ],
};
