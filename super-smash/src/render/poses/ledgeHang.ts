/**
 * Hanging off the edge, and climbing back onto the stage.
 *
 * ## The ledge in Ultimate
 *
 * The ledge is not a moment, it is a *place you live in*. Grabbing one grants
 * `floor(60 × (airTime/300) + 64 − (percent/120) × 44)` frames of intangibility
 * (SPEC §5), and a fighter may regrab it `LEDGE_REGRAB_LIMIT` times before the
 * state machine forces a get-up on them — so hanging can last several seconds
 * while both players wait each other out over the five options (get-up, attack,
 * roll, jump, drop). Ledge trumping means the hang is not even safe: an opponent
 * grabbing the same ledge pulls the holder off it. Every one of those decisions
 * is read off this clip, which is why it cannot be a photograph.
 *
 * ## The constraint that makes this clip different
 *
 * Every other clip in the library is free to move the whole body: a fighter's
 * feet are on the floor or on nothing, and either way nothing outside the rig is
 * being held. Here the hands are on a **fixed point in the world** — the ledge
 * does not move, so the hands may not either. That inverts how the keys are
 * authored. The body's attitude is chosen first (where the shoulder sits, how
 * far the legs have swung), and then the arm angles and `offsetX`/`offsetY` are
 * *solved* so that the hand lands on the same point in every key. Eyeballing an
 * arm angle here reads instantly as the fighter sliding along the ledge, which
 * is the one thing a hang can never do.
 *
 * That fixed point is `(2.3, 10.0)` in rig units from the fighter's origin: up
 * and forward, at the far edge of the arms' 4.35-unit reach. Directly overhead
 * would be the obvious choice and it is unreadable — the rig's head circle is
 * 2.5 units across against a 1.95-unit upper arm, and Mario's sleeve, forearm
 * and glove are the same red, skin and white as his cap and face, so an arm
 * raised straight up vanishes into the head it passes behind. Forward of the
 * head the whole arm is silhouetted against the sky, and fingers hooked a little
 * inboard of the corner is how you hold a ledge anyway.
 *
 * ## Why the fighter is drawn at the lip rather than below it
 *
 * `grabLedge` snaps `f.x`/`f.y` to the ledge *corner*, and `hurtboxCapsule`
 * stands the hurtbox on that origin — so as far as the engine is concerned a
 * hanging fighter occupies the space **above** the lip. Dropping the drawing a
 * body-height, which is where a real hanging fighter's feet would be, would put
 * the visible fighter entirely outside their own hurtbox and every edgeguard
 * would appear to miss. It would also make `ledgeJump`, `ledgeRoll` and
 * `ledgeAttack` — which reuse `rise`, `roll` and `ftilt`, clips shared with the
 * grounded states and therefore drawn at the origin — jump a body-height on the
 * frame the player presses a button. So the ledge the hands hold is drawn as a
 * point overhead, and the body hangs a unit and a half below its origin with the
 * toes a couple of units past the lip. Moving it properly is an engine change,
 * not a clip one.
 */

import { P, type PoseClip } from "./clip";

/**
 * The sway: four keys, and the legs a quarter cycle behind the body.
 *
 * 72 frames because that is roughly what gravity says. A pendulum swings at
 * `2π√(L/g)`, and a fighter hanging at full stretch carries their mass about
 * twelve units below the ledge; at Mario's gravity of 0.087 units per frame
 * squared that is 74 frames. The roster spans 45 (Fox) to 86 (Kirby) and one clip has to serve all
 * eight, so the middle of that range is the honest number.
 *
 * The body reaches its extremes at `t = 0` and `t = 0.5` and passes through the
 * middle at the quarters; the legs reach *their* extremes at the quarters
 * instead. That quarter-cycle lag is what turns a swinging plank into something
 * with knees in it, and it is the only reason four keys are needed rather than
 * two.
 *
 * The shoulder travels an *arc* about the grip rather than sliding sideways —
 * six degrees of it — which is why the body rises six tenths of a unit as it
 * swings outboard and sinks again coming back. The arc is lopsided because the
 * rest hang is not directly under the grip: a fighter on a ledge braces away
 * from the wall rather than dangling free, so the low point of the swing is the
 * inboard end of it. Everything here is small — under a unit of foot travel on a
 * thirteen-unit fighter — for the same reason.
 */
export const ledgeHang: PoseClip = {
  loop: true,
  period: 72,
  keys: [
    {
      // Swung inboard: chest toward the wall, hips and legs swung out under it.
      t: 0,
      pose: P({
        hip: 0, torso: 8, head: -18,
        thighR: 199, shinR: 7, footR: -36,
        thighL: 187, shinL: 12, footL: -41,
        upperArmR: 53, forearmR: -44,
        upperArmL: 56, forearmL: -55,
      }),
      offsetX: -0.6,
      offsetY: -1.7,
    },
    {
      // Passing the middle. The legs are at their forward extreme here, not the
      // body — that quarter-cycle offset is the whole trick.
      t: 0.25,
      pose: P({
        hip: 0, torso: 10, head: -19,
        thighR: 190, shinR: 11, footR: -35,
        thighL: 179, shinL: 16, footL: -40,
        upperArmR: 50, forearmR: -30,
        upperArmL: 56, forearmL: -46,
      }),
      offsetX: -1.1,
      offsetY: -1.5,
    },
    {
      // Swung out over the blast zone. Top of the arc, so the body sits half a
      // unit higher and the elbows carry their deepest bend.
      t: 0.5,
      pose: P({
        hip: 0, torso: 8, head: -18,
        thighR: 199, shinR: 7, footR: -36,
        thighL: 187, shinL: 12, footL: -41,
        upperArmR: 65, forearmR: -44,
        upperArmL: 70, forearmL: -57,
      }),
      offsetX: -1.2,
      offsetY: -1.1,
    },
    {
      // Passing back the other way, legs trailing at their back extreme.
      t: 0.75,
      pose: P({
        hip: 0, torso: 5, head: -16,
        thighR: 208, shinR: 3, footR: -37,
        thighL: 195, shinL: 8, footL: -42,
        upperArmR: 55, forearmR: -30,
        upperArmL: 61, forearmL: -46,
      }),
      offsetX: -0.8,
      offsetY: -1.6,
    },
  ],
};

/**
 * The climb: `LEDGE_GETUP_FRAMES` = 26, and every one of them doing something.
 *
 * The horizontal travel is not here. `finishLedgeOption` teleports the fighter
 * `LEDGE_GETUP_DISTANCE` inboard when the state ends, so the clip's `offsetX` is
 * the body's lean over its own feet — under two units across the whole climb —
 * and not the journey onto the stage.
 *
 * Six beats, and the hands let go a third of the way through because they have
 * to. The grip is at the fighter's own head height (see above), so there is no
 * mantle to be had: you cannot press up over a hold level with your ears — an
 * arm this length buys half a unit of rise before it runs out of fold. What a
 * fighter can do, and what Ultimate's neutral get-up looks like at speed, is
 * haul on it, throw the knees up and across, and let go at the top of the pull
 * with enough of the body over the lip to land on a foot.
 *
 * - **0–3, the gather.** Sink on the grip, legs swing back to load. `in` easing
 *   on both spans: nothing about a pull-up starts fast.
 * - **3–9, the pull.** Elbows fold from nearly straight to ninety degrees while
 *   the knees drive up in front — the reach from shoulder to grip drops from 4.2
 *   units to 3.2, which is all the height an arm this length can buy.
 *   `out` easing: the pull runs out of arm rather than stopping.
 * - **9–13, the turnover.** Frame 9 is the last key with a grip. The arms open
 *   out of their fold as the lead foot swings across and lands over the lip.
 * - **13–18, the plant.** The arms swing down past the hips and the lead foot
 *   takes the weight; `scaleY` 0.96 is the compression of catching a falling
 *   body on one leg.
 * - **18–22, the rise.** Lead leg drives, rear leg swings through, torso comes
 *   up out of its 34° pitch. A hair of stretch (1.015) on the way up.
 * - **22–26, the arrival.** The last key is the **mean** of `idle`'s four keys
 *   rather than any one of them, because `poseTimeFor` runs the standing loop off
 *   the global frame and a climb can hand over into any part of its breath. It
 *   also names every leg bone, including the two `idle` leaves at rest: a bone
 *   the next clip does not name keeps whatever this one left it at, so anything
 *   not returned here would ride into the standing pose and stay there.
 */
export const ledgeGetUp: PoseClip = {
  loop: false,
  keys: [
    {
      // The hang, at the middle of its sway.
      t: 0,
      pose: P({
        hip: 0, torso: 8, head: -18,
        thighR: 199, shinR: 7, footR: -36,
        thighL: 187, shinL: 12, footL: -41,
        upperArmR: 52, forearmR: -30,
        upperArmL: 58, forearmL: -46,
      }),
      offsetX: -1.0,
      offsetY: -1.5,
      ease: "in",
    },
    {
      // Frame 3 — the gather. The legs swing back under a body sinking onto
      // straight arms: the anticipation the pull is thrown out of.
      t: 3 / 26,
      pose: P({
        hip: 0, torso: 4, head: -16,
        thighR: 209, shinR: 5, footR: -36,
        thighL: 197, shinL: 9, footL: -40,
        upperArmR: 53, forearmR: -22,
        upperArmL: 61, forearmL: -42,
      }),
      offsetX: -0.9,
      offsetY: -1.5,
      ease: "in",
    },
    {
      // Frame 9 — the pull, and the last frame with a grip. Elbows folded past a
      // right angle, both knees driven up in front, pelvis tucked under the curl.
      // The hands have not moved a millimetre since frame 0.
      t: 9 / 26,
      pose: P({
        hip: 5, torso: 2, head: -14,
        thighR: 127, shinR: 80, footR: -40,
        thighL: 145, shinL: 66, footL: -50,
        upperArmR: 79, forearmR: -85,
        upperArmL: 79, forearmL: -91,
      }),
      offsetX: -0.2,
      offsetY: -1.0,
      ease: "out",
    },
    {
      // Frame 13 — the turnover. Released; the lead foot is across the lip and
      // three units inboard of it, toes leading, arms opening out of the fold.
      t: 13 / 26,
      pose: P({
        hip: 8, torso: 14, head: -20,
        thighR: 88, shinR: 72, footR: -36,
        thighL: 142, shinL: 72, footL: -54,
        upperArmR: 73, forearmR: -60,
        upperArmL: 63, forearmL: -66,
      }),
      offsetX: 0.4,
      offsetY: -0.7,
      scaleY: 0.99,
    },
    {
      // Frame 18 — the plant. The arms swing down through straight and out the
      // other side, the rear leg still trailing off the edge, and the whole body
      // compresses onto the lead foot.
      t: 18 / 26,
      pose: P({
        hip: 4, torso: 34, head: -32,
        thighR: 114, shinR: 88, footR: -110,
        thighL: 192, shinL: 44, footL: -98,
        upperArmR: 112, forearmR: 34,
        upperArmL: 96, forearmL: 40,
      }),
      offsetX: 0.8,
      offsetY: -0.9,
      scaleY: 0.96,
      ease: "out",
    },
    {
      // Frame 22 — the rise. Lead leg driving, rear leg swinging through to meet
      // it, arms nearly down.
      t: 22 / 26,
      pose: P({
        hip: 0, torso: 14, head: -14,
        thighR: 161, shinR: 25, footR: -90,
        thighL: 200, shinL: -10, footL: -84,
        upperArmR: 146, forearmR: 20,
        upperArmL: 168, forearmL: 2,
      }),
      offsetX: 0.9,
      offsetY: -0.1,
      scaleY: 1.015,
    },
    {
      // The mean of `idle`'s four keys, not any one of them: `poseTimeFor` drives
      // the standing loop off the *global* frame, so there is no telling which
      // part of its breath a climb hands over into.
      t: 1,
      pose: P({
        hip: 0, torso: 5, head: -5,
        thighR: 174, shinR: 8, footR: -88,
        thighL: 182, shinL: 0, footL: -88,
        upperArmR: 164, forearmR: 19,
        upperArmL: 193, forearmL: -18,
      }),
      offsetX: 0.7,
      offsetY: 0.05,
    },
  ],
};
