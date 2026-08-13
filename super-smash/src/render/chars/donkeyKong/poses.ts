/**
 * Donkey Kong: the clips that are Donkey Kong’s rather than everybody’s.
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
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/**
 * The Spinning Kong bar: both arms straight out and level, legs long.
 *
 * Hoisted out of the clip because every frame of the spin is this same
 * drawing — the turn is carried entirely by `scaleX`, and repeating fourteen
 * identical pose literals would hide that rather than show it.
 */
const KONG_BAR = P({
  torso: 0, head: 0,
  thighR: 174, shinR: 6, footR: -88,
  thighL: 186, shinL: 4, footL: -88,
  // Fifteen degrees under level, not dead level. His shoulder stands at 8.72
  // rig units and the move's hitboxes sit at world y 8, which is 6.88 of them —
  // so a horizontal bar puts his fists 1.8 units above the damage. The slope is
  // invisible at a glance and it is the difference between the drawing and the
  // hitbox agreeing about where the clothesline is.
  upperArmR: 105, forearmR: 0, handR: 0,
  upperArmL: 255, forearmL: 0, handL: 0,
});

/**
 * The Roll Attack's ball, held unchanged through every live frame.
 *
 * Hoisted for the same reason `KONG_BAR` is: the rotation is the animation and
 * repeating six identical pose literals under it would hide that rather than
 * show it. Chin tucked *behind* the knees, not on top of them — a head on the
 * outside of the ball reads as a fighter being thrown.
 */
const ROLL_BALL = {
  hip: -12, torso: 82, head: -74,
  thighR: 96, shinR: 124, footR: -100,
  thighL: 108, shinL: 118, footL: -96,
  upperArmR: 116, forearmR: 86, handR: 16,
  upperArmL: 124, forearmL: 80, handL: 14,
};

export const poses: Partial<Record<PoseName, PoseClip>> = {
  /**
   * Standing — the knuckle lean, and the pose a player looks at longer than any
   * other in the game.
   *
   * The shared idle is a person: spine plumb, arms hanging at the sides, ankles
   * stacked. Played on this rig that is a brown barrel with a tie on it and two
   * pale blobs at the bottom, and *every* proportion the rig was built for is
   * thrown away — the arms end up beside the hips where the fur mass eats them,
   * and the feet overlap into one lump 0.22 units wide.
   *
   * ## He is on his knuckles, and that is the whole thing
   *
   * This is sourced rather than stylised. Measured off SmashWiki's own idle
   * GIFs frame by frame, DK's `wait1`:
   *
   * - the **hip→shoulder axis leans about 55° from vertical** — only 35° above
   *   horizontal, with the upper back strongly rounded;
   * - the **arms hang plumb**, shoulder to ground contact, with under 2% of his
   *   height of horizontal offset — they are a vertical line, not a reach;
   * - the **fists rest on the floor**, forward of and outboard of the feet, and
   *   genuinely bear weight;
   * - **the top of the shoulder hump and the top of the skull are the same
   *   height** to within 3% of him. There is no neck and nothing but the hair
   *   tuft rises above the shoulder line;
   * - the silhouette is nearly **square**: 0.81 as long as it is tall.
   *
   * Every one of those falls out of two numbers here. Fifty-one degrees of
   * accumulated spine carries the shoulder 4.0 rig units forward of the ankles
   * *and 1.9 down*, and the arm — hanging dead plumb, `upperArm` set to exactly
   * 180 minus the spine — then reaches the floor on its own. Nothing reaches;
   * he is simply leaning on his hands. The same lean lays the fur mass over
   * into the long diagonal back a gorilla has, and swings the widest point of
   * it up behind the shoulder where the hump belongs.
   *
   * The head bone is the one thing that does *not* follow the spine: it is
   * pulled back 42° so it finishes near vertical. That is not a cheat about
   * anatomy, it is a fact about the rig — the muzzle, brow, ears and eyes are
   * props hung off the head bone's own frame, so rotating the bone to the
   * horizontal the reference measures would swing his face round onto the top
   * of his skull. A near-vertical bone off a neck that is already 4 units
   * forward and 2 down gets the head where the reference puts it — level with
   * the hump, thrust out in front of the chest — with the face still pointing
   * where a face goes.
   *
   * ## What moves, and what is nailed down
   *
   * A per-pixel motion map of the idle cycle shows the **hands and feet dead
   * still** and the head, back and chest carrying all of it: they are planted
   * anchors, not swinging limbs. So the arms here barely move — three degrees
   * across the cycle against the shared clip's six — and what breathes is the
   * spine, which rolls four degrees, and the head, which drifts five and
   * arrives a quarter cycle after the chest. `scaleY` does the lift, because it
   * stretches about the feet; `offsetY` is kept under a tenth of a unit,
   * because a knuckle stance that translates upward takes its knuckles off the
   * floor and the pose stops being the pose.
   *
   * The rest is the shared clip's structure, which is worth keeping: four keys
   * so that no two parts of the body turn round on the same frame, uneven key
   * times so the cycle has no countable beat, and only the inhale cushioned so
   * the other three spans do not stall at both ends. Slower, though — 126
   * frames against 108. A heavyweight does not breathe at a human's cadence.
   *
   * A knee bends without dragging its foot across the floor by taking half the
   * angle back out of the thigh, the same bookkeeping the shared clip does.
   */
  idle: {
    loop: true,
    // Two and a tenth seconds. The shared clip's 108 is a person's breath; a
    // heavyweight's is slower, and the slower it is the more the sway reads as
    // mass rather than as fidget.
    period: 126,
    keys: [
      // The settle at the bottom of the exhale. Lowest the body gets, deepest
      // the lean, and the frame the near knuckle is nearest the floor. The span
      // leaving here is the one the ease is spent on.
      {
        t: 0,
        pose: P({
          hip: 18, torso: 33, head: -42,
          thighR: 143, shinR: 36, footR: -102,
          thighL: 205, shinL: -26, footL: -92,
          // 180 minus the 51° of accumulated spine above it, exactly: the arm
          // is plumb in world space and the shoulder's own position is what
          // puts the fist forward of his toes.
          upperArmR: 129, forearmR: 0, handR: 0,
          upperArmL: 135, forearmL: 0, handL: 0,
        }),
        offsetY: 0.0,
        scaleY: 0.99,
      },
      // Top of the inhale. The chest is up and the spine has opened four
      // degrees — a gorilla straightens out of the lean to breathe rather than
      // lifting his shoulders past his ears. Mostly `scaleY`, which stretches
      // about the feet and leaves the soles where they are; `offsetY` alone
      // would lift them off the stage.
      {
        t: 0.32,
        pose: P({
          hip: 17, torso: 32, head: -38,
          thighR: 147, shinR: 32, footR: -102,
          thighL: 205, shinL: -22, footL: -92,
          upperArmR: 131, forearmR: 0, handR: 0,
          upperArmL: 137, forearmL: 0, handL: 0,
        }),
        offsetY: 0.03,
        scaleY: 1.022,
        ease: "linear",
      },
      // The head arrives late: it is still coming up as the chest starts back
      // down, which is the whole of "the head has its own rhythm". Weight has
      // shifted onto the near leg and that knee is at its softest, and the near
      // arm is at the back of its swing while the far one is at the front —
      // nothing synchronises a standing animal's arms.
      {
        t: 0.55,
        pose: P({
          hip: 19, torso: 32, head: -46,
          thighR: 142, shinR: 39, footR: -103,
          thighL: 204, shinL: -28, footL: -91,
          upperArmR: 131, forearmR: 0, handR: 0,
          upperArmL: 138, forearmL: 0, handL: 0,
        }),
        offsetY: 0.04,
        scaleY: 1.006,
        ease: "linear",
      },
      // A hair under the settle, so the last span is a small recovery into it
      // rather than a fourth extreme.
      {
        t: 0.78,
        pose: P({
          hip: 18, torso: 34, head: -42,
          thighR: 143, shinR: 37, footR: -102,
          thighL: 205, shinL: -25, footL: -92,
          upperArmR: 128, forearmR: 0, handR: 0,
          upperArmL: 134, forearmL: 0, handL: 0,
        }),
        offsetY: -0.02,
        scaleY: 0.985,
        ease: "linear",
      },
    ],
  },

  /**
   * Forward smash — "a lunging clap" (SmashWiki), and the clap is where it
   * *ends*: both arms go up and over the top and are driven down and forward,
   * and the hands arrive together at the bottom of the swing.
   *
   * ## What round two changed, and why
   *
   * This used to finish with both palms out at chest height, drawn from our own
   * hitbox table — 22% on the hands at `(11, 8)` and 21% on the arms at
   * `(5, 8)` — read as "horizontal, not a slam into the floor". The hitbox is
   * not that tight. In the real game the hand sphere sits at 26% of his height
   * and its lower edge *touches the ground*; ours has radius 6 about a centre
   * at y 8, so it spans world y 2 to 14, and a hand anywhere from the floor to
   * over his own head satisfies it. The chest-height reading was one point
   * inside a range, and it was the wrong one.
   *
   * The frames say: at contact the **torso is folded to near horizontal, the
   * head is thrust down and forward, and both arms are fully extended forward
   * and down with the hands together at knuckle height**. That is drawn here —
   * the hands land 4.4 rig units up against 9.3 before, which is 30% of his
   * height against 63% — and it is the difference between a fighter punching
   * and four hundred pounds falling on you.
   *
   * The charge pose changed with it. It was both fists cocked behind the crown,
   * which is the shape of the *up* smash's gather and reads as the wrong move.
   * Ultimate's own change list says he "no longer brings his arms behind him as
   * much when charging", and the frame it holds on is asymmetric: one arm
   * cocked high and back, the other still down and forward. Two arms doing
   * different things is also simply more legible than two doing the same one.
   *
   * Frame 22 of 54 before it connects, so a third of a second of wind-up *is*
   * the move, and the shape at the top of it is held rather than travelled
   * through.
   */
  fsmash: {
    loop: false,
    strike: 0.34,
    keys: [
      // The gather. The far arm reaches forward and rolls up over his head
      // while the near arm swings down past his knees — both hands finish
      // behind him, which is why they set off in opposite directions.
      {
        t: 0,
        pose: P({
          hip: 6, torso: 14, head: -14,
          thighR: 158, shinR: 26, footR: -92,
          thighL: 202, shinL: -14, footL: -92,
          upperArmR: 120, forearmR: -30, handR: -12,
          upperArmL: 54, forearmL: -22, handL: -10,
        }),
        offsetX: -0.25,
      },
      // `strike * 0.55` exactly — the t a charging smash parks at — and `hold`,
      // so the charge pose and the frames after it are one held drawing rather
      // than a slow drift.
      //
      // **Asymmetric**: the near fist is cocked high and *behind* the crown at
      // 310° accumulated, the far one is still down and forward at 152°. Two
      // arms doing different things, which is both what the frames show and
      // simply more legible than two doing the same one — with both fists
      // parked over the head this pose was the up smash's gather and a charging
      // DK told a player nothing about which smash was coming.
      //
      // The spine barely pitches here, and that is deliberate: the fold is
      // spent on the contact frame rather than leaked into the wind-up, so the
      // difference between this drawing and the next one is the whole move.
      {
        t: 0.187,
        pose: P({
          hip: 6, torso: 16, head: -14,
          thighR: 152, shinR: 34, footR: -96,
          thighL: 210, shinL: -18, footL: -88,
          upperArmR: 288, forearmR: -24, handR: -10,
          upperArmL: 130, forearmL: 10, handL: 6,
        }),
        offsetX: -0.5, offsetY: -0.08, scaleX: 1.03, scaleY: 0.97,
        ease: "hold",
      },
      // Over the top, move frame 20. Both arms have met above the crown and the
      // spine has begun to fold under them — everything still loaded, which is
      // what makes the next frame land like a dropped anvil. Also where the arm
      // and head go intangible (frames 20-26): the swing goes *through* what it
      // collides with.
      {
        t: 0.3,
        pose: P({
          hip: 10, torso: 26, head: -22,
          thighR: 146, shinR: 42, footR: -98,
          thighL: 216, shinL: -22, footL: -86,
          upperArmR: 340, forearmR: -12, handR: -6,
          upperArmL: 334, forearmL: -8, handL: -4,
        }),
        offsetX: -0.45, offsetY: -0.17, scaleX: 1.02, scaleY: 0.99,
        ease: "in",
      },
      // Contact, move frame 22 — the dive.
      //
      // Fifty-eight degrees of accumulated spine, which is a torso laid nearly
      // over; the head thrust down and forward on the end of it; both arms
      // driven out at 122° accumulated, thirty-two degrees below horizontal,
      // and the two fists arriving together **4.4 rig units off the floor**.
      // That is 30% of his height. The version this replaces put them at 9.3,
      // which is 63% — a man throwing a punch rather than four hundred pounds
      // falling on you. Our own hand hitbox is a radius-6 sphere about `y: 8`,
      // so it reaches from world 2 to world 14 and both readings satisfy it;
      // the frames pick between them.
      //
      // He does not travel. `offsetX` runs to +0.5 of a rig unit, which is the
      // dive tipping his mass forward over planted feet, not a step.
      {
        t: 0.34,
        pose: P({
          hip: 14, torso: 44, head: 10,
          thighR: 128, shinR: 66, footR: -108,
          thighL: 232, shinL: -20, footL: -78,
          upperArmR: 64, forearmR: -4, handR: -2,
          upperArmL: 58, forearmL: 0, handL: 0,
        }),
        offsetX: 0.5, offsetY: -0.5, scaleX: 1.12, scaleY: 0.92,
        ease: "out",
      },
      // Frame 23 — the last frame the hitbox is live, and the reason this key
      // exists. `ease: "out"` is a cubic, so without it the clip is already a
      // tenth of the way into its recovery one frame after contact and the move
      // is visibly being put away while it is still hitting. The arms hold
      // exactly where they made contact; only the body keeps travelling. `t` is
      // not a taste decision: `poseTimeFor` maps action frame `f` past contact
      // to `strike + (1 - strike)(f - first)/(total - first)`, and for frames
      // 22-23 of 54 that is 0.36.
      {
        t: 0.36,
        pose: P({
          hip: 14, torso: 46, head: 12,
          thighR: 127, shinR: 68, footR: -108,
          thighL: 233, shinL: -21, footL: -78,
          upperArmR: 63, forearmR: -4, handR: -2,
          upperArmL: 57, forearmL: 0, handL: 0,
        }),
        offsetX: 0.58, offsetY: -0.56, scaleX: 1.12, scaleY: 0.92,
      },
      // Through it. Four hundred pounds does not stop on the hitbox: the hands
      // carry on down and under him and this is the lowest the move gets.
      {
        t: 0.44,
        pose: P({
          hip: 12, torso: 50, head: 18,
          thighR: 124, shinR: 74, footR: -112,
          thighL: 236, shinL: -24, footL: -80,
          upperArmR: 82, forearmR: -8, handR: -2,
          upperArmL: 76, forearmL: -4, handL: 0,
        }),
        offsetX: 0.34, offsetY: -0.78, scaleX: 1.05, scaleY: 0.9,
      },
      // Hauling out of it. Elbows fold hard and the hands come back in front of
      // his face — thirty recovery frames need somewhere to go or they read as
      // a freeze.
      {
        t: 0.6,
        pose: P({
          hip: 6, torso: 20, head: -20,
          thighR: 146, shinR: 44, footR: -98,
          thighL: 216, shinL: -22, footL: -94,
          upperArmR: 104, forearmR: -96, handR: -12,
          upperArmL: 114, forearmL: -90, handL: -12,
        }),
        offsetX: 0.25, offsetY: -0.28,
      },
      // Back down onto his knuckles. The last shape anyone sees is near here,
      // not at the terminator.
      {
        t: 0.86,
        pose: P({
          hip: 2, torso: 12, head: -10,
          thighR: 160, shinR: 24, footR: -92,
          thighL: 204, shinL: -14, footL: -96,
          upperArmR: 136, forearmR: -34, handR: -10,
          upperArmL: 142, forearmL: -30, handL: -10,
        }),
        offsetX: 0.08, offsetY: -0.15,
      },
      {
        t: 1,
        pose: P({
          hip: 2, torso: 10, head: -8,
          thighR: 166, shinR: 16, footR: -90,
          thighL: 198, shinL: -10, footL: -96,
          upperArmR: 140, forearmR: -30, handR: -8,
          upperArmL: 146, forearmL: -28, handL: -8,
        }),
        offsetY: -0.09,
      },
    ],
  },

  /**
   * Dash attack — the **Roll Attack**, his signature move from Donkey Kong
   * Country, and the one clip in this file where the body genuinely tumbles.
   *
   * He had no override at all here, which meant the shared clip: an arm swipe.
   * That is not this move in any sense. SmashWiki: "Rolls forwards to strike
   * with his entire body", and the game's script agrees in the strongest
   * possible way — the hitbox is a single sphere on the **root** bone flagged
   * `attack_region_body`, with **no limb hitbox anywhere in the move**. There
   * is nothing to swing.
   *
   * ## This is what `rotation` is for
   *
   * `docs/character-art.md` warns that clip-level rotation cartwheels the whole
   * body and that two characters reached for it on spinning moves and had to
   * back it out — and then names the exception: "reserve `spin` for a body that
   * genuinely tumbles: a tumble, a roll, a launched fighter." This is the roll.
   * The rotation is in the *screen* plane, which is exactly the plane a forward
   * roll happens in, so it is the one place in his kit where the obvious tool
   * is also the right one.
   *
   * Stepped rather than swept, because rotation interpolates the short way
   * round: keys 2.0 radians apart, ending on **4π** so the terminator is a
   * fighter the right way up and the whole move is two clean revolutions. A
   * single key at 4π would be a key at zero and he would not turn at all.
   *
   * The pose under it barely changes, and that is the point of a roll — he
   * folds into a ball on the way in, holds it, and unfolds on the way out. The
   * eleven frames of clean hitbox and thirteen of late are all ball.
   *
   * `strike: 8 / 34` is the identity map for this clip: the first active frame
   * is 9, so `firstActive` is 8, and every `t` below is its frame number over
   * 34. Travel is the engine's — the frames show him covering about 1.7 body
   * heights — so nothing here uses `offsetX` for more than the fold.
   */
  dashAttack: {
    loop: false,
    strike: 8 / 34,
    keys: [
      // f0 — still running, weight already going forward and both hands
      // dropping toward the floor. `in` holds it flat for three frames and then
      // throws him into the dive.
      {
        t: 0,
        pose: P({
          hip: 12, torso: 26, head: -22,
          thighR: 150, shinR: 40, footR: -104,
          thighL: 210, shinL: -18, footL: -96,
          upperArmR: 128, forearmR: -10, handR: -4,
          upperArmL: 152, forearmL: -8, handL: -4,
        }),
        offsetY: -0.15,
        ease: "in",
      },
      // f5 — the dive. Hands to the deck, hips coming up over them, spine
      // folding: the frames show him going onto his hands *first* and rolling
      // over them, which is why the rotation has not started yet.
      {
        t: 5 / 34,
        pose: P({
          hip: 24, torso: 44, head: -30,
          thighR: 120, shinR: 78, footR: -112,
          thighL: 132, shinL: 72, footL: -108,
          upperArmR: 104, forearmR: 22, handR: 10,
          upperArmL: 112, forearmL: 18, handL: 8,
        }),
        offsetY: -0.5, scaleX: 1.1, scaleY: 0.88,
        ease: "in",
      },
      // f8 — the ball, and the first live frame. Knees to the chest, both arms
      // wrapped round the shins, chin tucked in behind them.
      {
        t: 8 / 34,
        pose: P({ ...ROLL_BALL }),
        rotation: 0.9, offsetY: -1.5, scaleX: 1.04, scaleY: 1.02,
        ease: "out",
      },
      { t: 12 / 34, pose: P({ ...ROLL_BALL }), rotation: 2.9, offsetY: -1.7, scaleX: 1.04, scaleY: 1.02 },
      { t: 16 / 34, pose: P({ ...ROLL_BALL }), rotation: 4.9, offsetY: -1.7, scaleX: 1.03, scaleY: 1.03 },
      { t: 20 / 34, pose: P({ ...ROLL_BALL }), rotation: 6.9, offsetY: -1.65, scaleX: 1.02, scaleY: 1.02 },
      { t: 24 / 34, pose: P({ ...ROLL_BALL }), rotation: 8.9, offsetY: -1.5, scaleX: 1.01 },
      // f28 — opening out of it, the last live frame behind him. The legs run
      // out first and the arms follow, which is how a roll ends.
      {
        t: 28 / 34,
        pose: P({
          hip: 6, torso: 34, head: -26,
          thighR: 136, shinR: 66, footR: -108,
          thighL: 200, shinL: 30, footL: -100,
          upperArmR: 132, forearmR: 26, handR: 8,
          upperArmL: 178, forearmL: 20, handL: 6,
        }),
        rotation: 10.9, offsetY: -1.25,
      },
      // 4π: two whole turns, so the shape he hands back to `idle` is a fighter
      // the right way up rather than one caught mid-cartwheel.
      {
        t: 1,
        pose: P({
          hip: 16, torso: 30, head: -36,
          thighR: 146, shinR: 36, footR: -102,
          thighL: 206, shinL: -20, footL: -94,
          upperArmR: 130, forearmR: 0, handR: 0,
          upperArmL: 138, forearmL: 0, handL: 0,
        }),
        rotation: Math.PI * 4,
        offsetY: -0.08,
      },
    ],
  },

  /**
   * Up smash — the overhead clap.
   *
   * The hitbox is at `x: 0, y: 16`: dead centre and above his crown, not in
   * front of him. So the clap is the whole shape — both arms leave the barrel,
   * meet on the centreline over his head, and for four frames the widest
   * fighter on the roster is the narrowest thing on screen. He is intangible on
   * frames 12-15, which is the frames he is going *up* through an aerial
   * approach, so nothing about the rise should look defensive.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      // The gather: down into the knees, both arms swept back and low. The
      // cubic `in` holds this shape through nearly the whole wind-up, which is
      // also what a charging smash parks on — `poseTimeFor` stops at
      // `strike * 0.55`, and under `in` that is still only a sixth of the way
      // to the clap, so the glow sits behind a coiled ape rather than a
      // half-finished one.
      {
        t: 0,
        pose: P({
          torso: 20, head: -16, hip: -6,
          thighR: 134, shinR: 82, footR: -84,
          thighL: 146, shinL: 76, footL: -82,
          // Hanging **down** and splayed, not swept back. Frames 3-9 of the
          // real move are a deep crouch with both arms dangling outside the
          // hips, hands open near knee height; the previous pair (208 / 220,
          // both behind him) was the down smash's gather wearing this move's
          // name, and it is the one drawing a player has to read to know which
          // smash is coming.
          upperArmR: 151, forearmR: 14, handR: 6,
          upperArmL: 186, forearmL: -12, handL: -6,
        }),
        offsetY: -1.35,
        scaleX: 1.08,
        scaleY: 0.94,
        ease: "in",
      },
      // Contact. Palms together on the centreline over the crown, body upright,
      // **feet flat and planted** — measured off the frames, the silhouette's
      // bottom edge does not move between neutral and contact, so the previous
      // version's toe rise and 0.55 of `offsetY` were a jump he does not do.
      // What is left is `scaleY`, which stretches about the soles and therefore
      // lifts the clap without lifting him.
      {
        t: 0.3,
        pose: P({
          torso: -12, head: -8, hip: 2,
          thighR: 172, shinR: 6, footR: -86,
          thighL: 188, shinL: 6, footL: -86,
          // The clap is made at the **elbows**, and that is what lets it be a
          // clap at all. `paintFigure` draws the head circle before the near
          // limbs, so a near arm swung to the centreline paints straight over
          // his face — the shoulders therefore stay splayed 28° apart, at 34
          // and 6 accumulated, and the forearms are folded back toward each
          // other (−22 and +18) so the two fists finish 0.6 of a unit apart
          // over the crown while the upper arms stay wide of the skull. Drawn
          // as a matching pair at the shoulder instead, the hands were 1.9
          // apart and the move read as a starfish rather than a clap.
          upperArmR: 44, forearmR: -22, handR: 0,
          upperArmL: 16, forearmL: 18, handL: 0,
        }),
        offsetY: 0.08,
        // Barely narrowed. At 0.88 the squeeze plus two vertical arms turned
        // the widest fighter on the roster into a stick, which is a worse lie
        // about him than the stretch is a truth about the move.
        scaleY: 1.13,
        scaleX: 0.95,
        ease: "out",
      },
      // Frame 15, the last live frame — the clap holds exactly where it landed
      // rather than starting to come apart on the frame after contact. See the
      // note on the forward smash for where 0.319 comes from.
      {
        t: 0.319,
        pose: P({
          torso: -12, head: -9, hip: 2,
          thighR: 173, shinR: 5, footR: -86,
          thighL: 187, shinL: 5, footL: -86,
          upperArmR: 44, forearmR: -22, handR: 0,
          upperArmL: 16, forearmL: 18, handL: 0,
        }),
        offsetY: 0.1,
        scaleY: 1.13,
        scaleX: 0.95,
      },
      // The hands part and the weight comes back down through the heels.
      {
        t: 0.44,
        pose: P({
          torso: -2, head: -6,
          thighR: 164, shinR: 18, footR: -84,
          thighL: 196, shinL: 16, footL: -84,
          upperArmR: 62, forearmR: -14, handR: -4,
          upperArmL: -10, forearmL: 12, handL: 4,
        }),
        offsetY: 0.04,
        scaleY: 1.04,
      },
      { t: 1, pose: P({ torso: 8, upperArmR: 118, forearmR: -42, upperArmL: 238, forearmL: 42 }) },
    ],
  },

  /**
   * Down smash — "raises his arms overhead and then quickly swings them
   * downward to perform forearm clubs" (SmashWiki). Both of them, together.
   *
   * ## The stagger was wrong
   *
   * This used to draw the front arm clubbing to the floor while the back arm
   * was still up over his shoulder, on the reasoning that our hitbox table
   * fires `x: +8` on frames 11-12 and `x: -8` on 13-14 and that "the two-frame
   * stagger *is* the move". It is not. The game's own script fires **four**
   * hitboxes on frames 11-12 — `armr` and `arml` at the same offset, and both
   * shoulders — perfectly mirrored, and the two ground-level boxes on 13-14 are
   * the same pair of arms arriving on the deck. Our table is a two-hitbox
   * simplification of a symmetric move, and the drawing was reading the
   * simplification as the choreography.
   *
   * So: **both arms swing down at once**, and the only asymmetry left is the
   * one the real data does have — the front fist finishes further out than the
   * back one (19 units against 12), which falls out for free here from a spine
   * that is leaning forward.
   *
   * ## And they reach the floor
   *
   * The late fists sit 4.5 units up on a 24-unit model — 18% of his height,
   * knuckles on the deck. They were at 5.7 rig units of 14.7, which is 39%, and
   * a ground pound whose fists stop at hip height is a shrug. The contact key
   * puts them at knee height and the frame-14 key puts them down, so the two
   * live frames are the fists still travelling into the floor rather than a
   * held shape.
   *
   * He barely crouches, and that is not a shortcut. His arms are 6.4 rig units
   * and his shoulder stands at 8.7, so knuckles reach the floor from almost
   * upright — that ratio *is* the character. Drawn at the crouch a human would
   * need (`offsetY: -1.9`), everything collapsed into one mound at ground level
   * with no arms legible in it at all.
   */
  dsmash: {
    loop: false,
    strike: 0.28,
    keys: [
      // Both arms hauled overhead and slightly back, weight up on the hips.
      // The same held gather as the up smash, deliberately: they are siblings
      // and the player is meant to have to read which one is coming.
      {
        t: 0,
        pose: P({
          torso: -8, head: 6, hip: 4,
          thighR: 162, shinR: 26, footR: -84,
          thighL: 196, shinL: 24, footL: -82,
          // Elbows flared out either side, so the gather is a wide diamond
          // rather than two sticks — it has to be legible against the up
          // smash's gather, which is the other thing a held charge might be.
          upperArmR: 22, forearmR: -34, handR: -10,
          upperArmL: -18, forearmL: 34, handL: 10,
        }),
        offsetY: 0.2,
        scaleY: 1.06,
        ease: "in",
      },
      // Contact, frame 11. **Both** arms driven down together, elbows nearly
      // straight, one forward and one back at a matched 49° below horizontal,
      // fists at knee height, head dropped between them. Two long lines leaving
      // the barrel in opposite directions is the widest, flattest thing in his
      // kit apart from the neutral air, and it is the frame that says "both
      // sides at once" without a word of animation.
      {
        t: 0.28,
        pose: P({
          torso: 20, head: 14, hip: -4,
          thighR: 150, shinR: 44, footR: -100,
          thighL: 208, shinL: 38, footL: -92,
          upperArmR: 115, forearmR: 0, handR: 0,
          upperArmL: 213, forearmL: 0, handL: 0,
        }),
        offsetY: -0.55,
        scaleX: 1.18,
        scaleY: 0.95,
        ease: "out",
      },
      // Frame 14: both fists arrive on the deck, one either side, 3.1 rig units
      // up — 21% of his height, which is the knuckle line the real move stops
      // at. The front one finishes 4.6 out and the back one 2.1, and that
      // asymmetry is not authored: it is the forward lean carrying the shoulder
      // ahead of the spine, which is the same 19-against-12 the game's own
      // ground hitboxes have.
      //
      // This is also the last live frame, so it doubles as the key that stops
      // the clip withdrawing mid-hitbox — `poseTimeFor` maps action frames
      // 11-14 of 55 onto t = 0.28..0.328. It used to sit at 0.42, which put
      // the second, *stronger* hit a fifth of the way into the recovery.
      {
        t: 0.328,
        pose: P({
          torso: 18, head: 16, hip: -2,
          thighR: 148, shinR: 46, footR: -102,
          thighL: 210, shinL: 40, footL: -90,
          upperArmR: 132, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: 0, handL: 0,
        }),
        offsetY: -0.75,
        scaleX: 1.22,
        scaleY: 0.92,
      },
      // Still propped on both fists. Forty-one frames of endlag, and the frames
      // show him down there for most of them — he does not spring back up.
      {
        t: 0.62,
        pose: P({
          torso: 20, head: 6,
          thighR: 150, shinR: 42, footR: -98,
          thighL: 208, shinL: 38, footL: -90,
          upperArmR: 138, forearmR: 6, handR: 4,
          upperArmL: 200, forearmL: -6, handL: -4,
        }),
        offsetY: -0.7,
        scaleX: 1.1,
      },
      { t: 1, pose: P({ torso: 10, thighR: 148, shinR: 56, thighL: 200, shinL: 32 }), offsetY: -0.8 },
    ],
  },

  /**
   * Spinning Kong — 104 frames, the launcher on 19, the trapping loop 25-58,
   * the finisher on 62, and 38 frames of landing lag if it ends on the floor.
   *
   * Both arms straight out, level, and the whole ape turning under them. At
   * full extension his hands are 12.2 rig units apart against a 12.3-unit
   * height — the arm span *is* his height, and nothing else in his kit is that
   * wide.
   *
   * ## Why this is not `spin`
   *
   * `spin` was the obvious tool and it is the wrong one. It rotates in the
   * *picture* plane, so what came out was a cartwheel: DK tumbling
   * head-over-heels with the ground line sweeping past his ears, which reads as
   * a fighter who has been launched, not one who is attacking. Spinning Kong
   * turns about his **vertical** axis, and a side-on 2D rig has no such axis.
   *
   * What it does have is width. A body turning about its vertical axis is at
   * full width square-on and vanishes to a sliver edge-on, twice per
   * revolution — so the turn is drawn as `scaleX` pumping 1.06 → 0.30 → 1.06
   * under a `linear` ease, at the real move's cadence of one half turn every
   * ~7.2 frames. The arm bar itself never moves: it is level and symmetric, so
   * a half turn maps the silhouette onto itself and there is nothing to
   * animate. That symmetry is the whole reason this works.
   *
   * ## What is deliberately still
   *
   * No `offsetY` for the rise: `momentum` drives him up and forward from frame
   * 6 for 18 frames and reproducing it here would double it. The legs dangle
   * and hold — at this rate centrifugal force points radially outward in the
   * body's own frame, which is constant, so the limbs are pinned rather than
   * swung, and pinning them is also what keeps the bar clean enough to read the
   * width off.
   */
  upB: {
    loop: false,
    // Not a fraction of the clip — `poseTimeFor` anchors `t = strike` onto the
    // first active frame whatever value is written, so this sets the ratio of
    // the two clock rates either side of it. 0.01 gives the 18 startup frames
    // one percent of the clip and the 86 after it the other ninety-nine: a
    // slow coil, then a snap into a turn that runs at a constant rate.
    strike: 0.01,
    keys: [
      // f0 — the coil. Hips back, knees deep, both fists low.
      {
        t: 0,
        pose: P({
          hip: -8, torso: 26, head: -20,
          thighR: 132, shinR: 90, footR: -110,
          thighL: 140, shinL: 86, footL: -108,
          upperArmR: 186, forearmR: 34,
          upperArmL: 174, forearmL: -34,
        }),
        offsetY: -0.95, scaleX: 1.06, scaleY: 0.93,
        ease: "in",
      },
      // f6 — the load, and the frame `momentum` fires.
      {
        t: 0.0033,
        pose: P({
          hip: -4, torso: 18, head: -14,
          thighR: 148, shinR: 60, footR: -98,
          thighL: 156, shinL: 56, footL: -96,
          upperArmR: 198, forearmR: 28,
          upperArmL: 162, forearmL: -28,
        }),
        offsetY: -0.5, scaleX: 1.02, scaleY: 0.97,
        ease: "in",
      },
      // f13 — the throw. Legs snap out and the arms sweep down and open: 4.6
      // units of span at f0, 10.7 here, 12.2 at the launcher. The whole of the
      // wind-up is that one widening.
      {
        t: 0.0072,
        pose: P({
          torso: 4, head: -4,
          thighR: 168, shinR: 18, footR: -92,
          thighL: 180, shinL: 16, footL: -90,
          upperArmR: 128, forearmR: -20,
          upperArmL: 232, forearmL: 20,
        }),
        offsetY: -0.1, scaleX: 0.97, scaleY: 1.04,
        ease: "in",
      },
      // f18 — the launcher. Elbows locked, arms dead level, body upright,
      // legs long and just split. This is the strike key.
      { t: 0.01, pose: KONG_BAR, scaleX: 1.06, ease: "out" },
      // f22 — edge on.
      { t: 0.0514, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f25 — square on.
      { t: 0.0929, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // f29 — edge on.
      { t: 0.1343, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f32 — square on.
      { t: 0.1758, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // f36 — edge on.
      { t: 0.2172, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f40 — square on.
      { t: 0.2587, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // f43 — edge on.
      { t: 0.3001, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f47 — square on.
      { t: 0.3415, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // f50 — edge on.
      { t: 0.383, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f54 — square on.
      { t: 0.4244, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // f58 — edge on.
      { t: 0.4659, pose: KONG_BAR, scaleX: 0.3, scaleY: 1.04, ease: "linear" },
      // f61 — square on.
      { t: 0.5073, pose: KONG_BAR, scaleX: 1.06, scaleY: 1.0, ease: "linear" },
      // The hits are done by f62 and the turn opens out: the pump decays
      // rather than stopping, because a body this heavy does not stop turning
      // on a frame.
      {
        t: 0.5487,
        pose: P({
          torso: 2, head: -2,
          thighR: 168, shinR: 16, footR: -84,
          thighL: 192, shinL: 12, footL: -82,
          upperArmR: 96, forearmR: -8,
          upperArmL: 264, forearmL: 8,
        }),
        scaleX: 0.62, scaleY: 1.02, ease: "linear",
      },
      {
        t: 0.6777,
        pose: P({
          torso: 4, head: -3,
          thighR: 162, shinR: 24, footR: -80,
          thighL: 198, shinL: 20, footL: -78,
          upperArmR: 100, forearmR: -12,
          upperArmL: 260, forearmL: 12,
        }),
        scaleX: 0.86,
      },
      // f90 — coming down, opening out of the bar.
      {
        t: 0.8388,
        pose: P({
          torso: 8, head: -5,
          thighR: 152, shinR: 44, footR: -76,
          thighL: 208, shinL: 38, footL: -74,
          upperArmR: 116, forearmR: -26,
          upperArmL: 244, forearmL: 26,
        }),
        scaleX: 0.98,
      },
      // f98 — spent, and posed toward `fall`'s apex key so the handover is
      // four frames of arms rather than a teleport.
      {
        t: 0.9309,
        pose: P({
          torso: 10, head: -4,
          thighR: 148, shinR: 56, footR: -74,
          thighL: 212, shinL: 48, footL: -72,
          upperArmR: 128, forearmR: -32,
          upperArmL: 232, forearmL: 32,
        }),
      },
      {
        t: 1,
        pose: P({
          torso: 8, head: -2,
          thighR: 152, shinR: 48, footR: -76,
          thighL: 206, shinL: 42, footL: -76,
          upperArmR: 120, forearmR: -26,
          upperArmL: 240, forearmL: 26,
        }),
      },
    ],
  },

  /**
   * Neutral special — Giant Punch, "a wind-up punch".
   *
   * The charge is *made of* arm circles — SmashWiki's ten wind-ups became a
   * continuous 110-frame charge in Ultimate — and the release still carries one
   * of them. So the wind-up is a crank rather than a cock: the whole arm rolls
   * round at his side and the punch is that same circle finishing through the
   * bottom, arriving from underneath.
   *
   * **The direction is the opposite of the obvious one, and it is sourced.**
   * This clip first shipped with the fist going forward, down, back and up. It
   * is the other way round: decoding `Donkey_Kong_Neutral_B_SSBU.gif` frame by
   * frame gives fist-up-the-**front** (f7), over the crown (f8), behind him at
   * chest height (f9), behind and low (f10), then the punch (f11). That is why
   * the throw comes from underneath.
   *
   * Frame 19 of 62 before it connects, live for two, super armour on 9-20. The
   * armour is why nothing in the middle flinches: from the held cock onward
   * every key is further into the punch than the one before it.
   */
  neutralB: {
    loop: false,
    strike: 0.3,
    keys: [
      // Set: down over his knuckles, near fist by his knee, weight back. The
      // crank spans are `linear` — a windmill turns at one speed, and easing
      // each quarter separately reads as four separate arm gestures.
      {
        t: 0,
        pose: P({
          hip: 4, torso: 16, head: -12,
          thighR: 156, shinR: 32, footR: -98,
          thighL: 200, shinL: -14, footL: -95,
          upperArmR: 129, forearmR: -22, handR: -8,
          upperArmL: 186, forearmL: -26, handL: -8,
        }),
        offsetX: -0.15, offsetY: -0.15,
        ease: "linear",
      },
      // Up the front. The arm passes his face for two frames on the way — it is
      // a windmill drawn side-on and the arm genuinely is in front of the head;
      // the near arm's contour is what keeps it reading as an arm.
      {
        t: 0.06,
        pose: P({
          hip: 2, torso: 2, head: 0,
          thighR: 154, shinR: 34, footR: -97,
          thighL: 202, shinL: -16, footL: -95,
          upperArmR: 44, forearmR: -20, handR: -6,
          upperArmL: 216, forearmL: -18, handL: -6,
        }),
        offsetX: -0.25, offsetY: -0.2,
        ease: "linear",
      },
      // Over the crown and away behind him, torso rocking back under it. Each
      // step of the circle is under 180°, so the shortest-path interpolation
      // takes the way round it was drawn to take.
      {
        t: 0.115,
        pose: P({
          hip: 0, torso: -8, head: 10,
          thighR: 152, shinR: 30, footR: -86,
          thighL: 206, shinL: -18, footL: -92,
          upperArmR: 323, forearmR: -14, handR: -4,
          upperArmL: 226, forearmL: -12, handL: -6,
        }),
        offsetX: -0.34, offsetY: -0.12,
        ease: "linear",
      },
      // Cocked, and `hold`: five frames of one drawing. The arm is nearly
      // straight and horizontal behind him, because a folded elbow puts the
      // fist inside the fur mass — the hump is the widest point on him and it
      // swallowed the cock entirely.
      //
      // This is also the pose a **charging** Giant Punch parks on —
      // `poseTimeFor` stops a charge at `strike * 0.55`, which is exactly this
      // `t` — so it is the drawing a player looks at for up to a hundred and
      // ten frames, and it has to be his charge stance rather than one frame of
      // a windmill. It was drawn leaning *back*, chest 16° behind vertical.
      // The reference is the other way round and emphatic about it: a deep
      // hunched crouch, back arched higher than his head, head low and thrust
      // forward, and — the detail that sells it — **the off arm knuckle-down on
      // the ground as a third point of support**, which it holds without moving
      // for the whole charge while only the near arm whirls.
      {
        t: 0.165,
        pose: P({
          hip: 16, torso: 30, head: -40,
          thighR: 136, shinR: 46, footR: -104,
          thighL: 202, shinL: -12, footL: -92,
          upperArmR: 300, forearmR: -12, handR: -6,
          upperArmL: 134, forearmL: 0, handL: 0,
        }),
        offsetX: -0.35, offsetY: -0.2, scaleX: 0.99,
        ease: "hold",
      },
      // The bottom of the circle: fist behind and low, spine coiled back over
      // the rear foot, off hand still on the deck.
      {
        t: 0.245,
        pose: P({
          hip: 8, torso: 10, head: -18,
          thighR: 142, shinR: 42, footR: -96,
          thighL: 216, shinL: -22, footL: -88,
          upperArmR: 236, forearmR: -14, handR: -6,
          upperArmL: 148, forearmL: -6, handL: -2,
        }),
        offsetX: -0.5, offsetY: -0.26, scaleX: 0.96, scaleY: 1.02,
        ease: "in",
      },
      // Contact, move frame 19 — **a diving overhand, not a jab.**
      //
      // Three things here are measured off the 60fps hitbox capture rather than
      // guessed, and all three were wrong before:
      //
      // - **The torso pitches to near horizontal.** Sixty-two degrees of
      //   accumulated spine. It is a full-body dive; the arm is along for the
      //   ride.
      // - **The fist finishes *below* the shoulder**, on an arm sloping 17°
      //   under horizontal. It was drawn 6° under, which is a level punch, and
      //   a level punch from an upright body is Mario's.
      // - **The off arm is thrown up and back behind the head**, fist clenched,
      //   at head height or above. The reference calls this the signature read
      //   of the pose and it is: one arm out low in front and one cocked high
      //   behind is a shape no other move in his kit makes. It used to hang
      //   down and back at 244°, where the fur mass ate it.
      //
      // And he does **not travel**. Ground-contact tracking across the swing
      // shows the rear foot lifting on frame 17 and the front foot not
      // advancing at all — it actually drifts back. All the reach comes from
      // hip drop, torso pitch and shoulder drive, so `offsetX` is a fifth of a
      // rig unit here where it used to be 1.05 and climbing to 1.35.
      {
        t: 0.3,
        pose: P({
          hip: 16, torso: 46, head: -58,
          thighR: 118, shinR: 66, footR: -104,
          thighL: 224, shinL: -28, footL: -74,
          upperArmR: 45, forearmR: 0, handR: 0,
          upperArmL: 243, forearmL: -20, handL: -8,
        }),
        offsetX: 0.2, offsetY: -0.55, scaleX: 1.12, scaleY: 0.94,
        ease: "out",
      },
      // Frame 20, the hitbox's second live frame. Without this the cubic `out`
      // has the fist 68% of the way home while the punch is still connecting.
      {
        t: 0.316,
        pose: P({
          hip: 16, torso: 47, head: -59,
          thighR: 117, shinR: 68, footR: -105,
          thighL: 225, shinL: -28, footL: -74,
          upperArmR: 45, forearmR: -1, handR: 0,
          upperArmL: 244, forearmL: -21, handL: -8,
        }),
        offsetX: 0.24, offsetY: -0.59, scaleX: 1.11, scaleY: 0.94,
      },
      // Through it. The extended pose is *held* from 19 to about 31 in the real
      // move — he does not snatch the arm back — so this key barely differs
      // from the last two, and the recovery starts after it rather than at it.
      {
        t: 0.44,
        pose: P({
          hip: 16, torso: 49, head: -60,
          thighR: 115, shinR: 72, footR: -108,
          thighL: 227, shinL: -30, footL: -74,
          upperArmR: 48, forearmR: -3, handR: 0,
          upperArmL: 248, forearmL: -22, handL: -8,
        }),
        offsetX: 0.3, offsetY: -0.66, scaleX: 1.09, scaleY: 0.93,
      },
      // The arm falls out of the punch and he rocks back onto both fists at
      // chest height — a boxer's guard, which is what the frames do from about
      // 37 to 49. Forty-three recovery frames need somewhere to go.
      {
        t: 0.6,
        pose: P({
          hip: 8, torso: 30, head: -24,
          thighR: 134, shinR: 54, footR: -102,
          thighL: 224, shinL: -20, footL: -100,
          upperArmR: 118, forearmR: -72, handR: -14,
          upperArmL: 176, forearmL: -56, handL: -12,
        }),
        offsetX: 0.14, offsetY: -0.45, scaleX: 1.02,
      },
      // Back over both knuckles, ground given back. The last shape anyone sees
      // is near here — frame 61 lands at t = 0.984 — not at the terminator.
      {
        t: 0.88,
        pose: P({
          hip: 12, torso: 26, head: -30,
          thighR: 150, shinR: 32, footR: -98,
          thighL: 208, shinL: -16, footL: -94,
          upperArmR: 138, forearmR: -6, handR: -2,
          upperArmL: 148, forearmL: -4, handL: -2,
        }),
        offsetX: 0.06, offsetY: -0.18,
      },
      {
        t: 1,
        pose: P({
          hip: 15, torso: 30, head: -38,
          thighR: 146, shinR: 34, footR: -100,
          thighL: 206, shinL: -22, footL: -92,
          upperArmR: 132, forearmR: 0, handR: 0,
          upperArmL: 138, forearmL: 0, handL: 0,
        }),
        offsetX: 0.0, offsetY: -0.06,
      },
    ],
  },

  /**
   * Side special — Headbutt. "A downward-swinging headbutt" (SmashWiki), and
   * the skull is the only part of him that hits.
   *
   * One hitbox, `x: 7, y: 9, r: 4.5`, live on frames 20-21 at angle 270 with
   * `effect: "bury"` — head height, a body's width in front, driving straight
   * down. That is where the crown has to be, so the clip is one 158° swing of
   * the `head` bone stacked on 68° of spine: reared up and *behind his own
   * heels* at the top, through the vertical, and down onto the spot.
   *
   * Three numbers set the beats and none of them are mine:
   *
   * - **super armour on frames 5-14** (SmashWiki and Ultimate Frame Data; the
   *   window is not in `fighters/donkeyKong.ts`). The reared shape is
   *   `ease: "hold"`, so frames 8-13 are one held drawing rather than six
   *   travelled through. The back half of the armour window *is* the
   *   anticipation, and it has to be legible for a fixed count or the tank
   *   never reads as a tank.
   * - **`momentum` sets vx = 1.1 on frames 14-20.** The engine carries him
   *   about seven world units in that window, so the clip must not: `offsetX`
   *   only ever leans (−0.30 → +0.55, under a rig unit), and the key at
   *   `t = 0.236` *is* action frame 14 — already committed and dropped into his
   *   legs on the frame the shove starts.
   * - **contact on frame 20 of 62**, so a third of a second of loaded wind-up
   *   and then two thirds getting back off the floor. The recovery gets five
   *   keys; without them forty frames read as a freeze.
   *
   * The arms are staged around one constraint: `paintFigure` draws the head
   * circle *before* the near limbs, so an arm crossing the face erases the
   * thing the move is about. They start on his knuckles, are hauled back into
   * the wind-up, fly back and up over the shoulder hump as the head comes down,
   * and only swing forward again once the skull is on its way back up.
   */
  sideB: {
    loop: false,
    strike: 0.32,
    keys: [
      // The plant. His ordinary knuckle stance — `out` rather than `smooth` so
      // the input reads on the frame it is pressed.
      {
        t: 0,
        pose: P({
          hip: 2, torso: 10, head: -4,
          thighR: 168, shinR: 20, footR: -96,
          thighL: 196, shinL: -9, footL: -95,
          upperArmR: 132, forearmR: -34, handR: -12,
          upperArmL: 138, forearmL: -32, handL: -10,
        }),
        offsetY: -0.08,
        ease: "out",
      },
      // Frame 3, the gather. Chin drops, knees soften, both sets of knuckles go
      // to the floor. A rear-back with no dip in front of it has no wind-up in
      // it; this is the small wrong-way move that sells the right-way one.
      {
        t: 0.055,
        pose: P({
          hip: 8, torso: 24, head: -16,
          thighR: 156, shinR: 52, footR: -120,
          thighL: 204, shinL: -6, footL: -109,
          upperArmR: 140, forearmR: -24, handR: -8,
          upperArmL: 146, forearmL: -22, handL: -6,
        }),
        offsetY: -0.35, scaleY: 0.97,
        ease: "out",
      },
      // Frame 8, held to frame 13 — the back half of the super-armour window.
      // Hips driven forward, chest 22° *behind* vertical and the skull cocked
      // another 38° past that: one long drawn bow, with the crown finishing
      // behind his own heels at the far end of a swing that lands ten world
      // units in front of them. `hold`, because this is the drawing the
      // opponent has to read.
      {
        t: 0.14,
        pose: P({
          hip: 6, torso: -28, head: -38,
          thighR: 172, shinR: 2, footR: -92,
          thighL: 194, shinL: 13, footL: -117,
          upperArmR: 226, forearmR: 22, handR: 8,
          upperArmL: 234, forearmL: 18, handL: 6,
        }),
        offsetX: -0.3, offsetY: -0.02, scaleY: 1.06,
        ease: "hold",
      },
      // Frame 14 exactly — the hold breaks on the frame the engine takes over.
      // The spine snaps up through vertical while the head stays cocked back
      // and he drops into both knees: everything loaded, nothing spent. The
      // cubic `in` keeps frames 15-16 nearly still and puts the whole swing
      // into the last three, which is what a whip is.
      {
        t: 0.236,
        pose: P({
          hip: 14, torso: -8, head: -32,
          thighR: 148, shinR: 68, footR: -132,
          thighL: 206, shinL: 22, footL: -136,
          upperArmR: 218, forearmR: 20, handR: 8,
          upperArmL: 226, forearmL: 16, handL: 6,
        }),
        offsetX: -0.05, offsetY: -0.55, scaleY: 0.96,
        ease: "in",
      },
      // Contact, move frame 20. The head bone reaches 98° accumulated — crown
      // levelled forward and already tipping under, face pointing at the floor
      // it is about to put someone into. Both arms are thrown back and up over
      // the shoulder hump as counterweight, 128° clear of the head bone.
      {
        t: 0.32,
        pose: P({
          hip: 10, torso: 36, head: 52,
          thighR: 142, shinR: 58, footR: -110,
          thighL: 234, shinL: 15, footL: -131,
          upperArmR: 284, forearmR: 26, handR: 8,
          upperArmL: 262, forearmL: 20, handL: 6,
        }),
        offsetX: 0.35, offsetY: -0.28, scaleX: 1.13, scaleY: 0.95,
        ease: "out",
      },
      // Frame 21 — the second live frame. `ease: "out"` is a cubic, so without
      // this key the skull is already 31% of the way home while the bury is
      // still connecting. `poseTimeFor` maps frames 20-21 of 62 to t = 0.336.
      {
        t: 0.336,
        pose: P({
          hip: 10, torso: 38, head: 54,
          thighR: 141, shinR: 60, footR: -112,
          thighL: 235, shinL: 17, footL: -133,
          upperArmR: 286, forearmR: 27, handR: 8,
          upperArmL: 264, forearmL: 21, handL: 6,
        }),
        offsetX: 0.4, offsetY: -0.34, scaleX: 1.12, scaleY: 0.94,
      },
      // Through it. Weight 127 does not stop on the hitbox: the
      // head swings on to 116° and the skull finishes low and in front, which
      // is the bury said out loud. Lowest and furthest the move gets.
      {
        t: 0.4,
        pose: P({
          hip: 12, torso: 44, head: 60,
          thighR: 136, shinR: 82, footR: -126,
          thighL: 238, shinL: 28, footL: -146,
          upperArmR: 294, forearmR: 30, handR: 10,
          upperArmL: 272, forearmL: 24, handL: 8,
        }),
        offsetX: 0.55, offsetY: -0.58, scaleX: 1.07, scaleY: 0.92,
      },
      // The arms fall first, and the order is the whole point. They have to come
      // down before the spine comes up or they sweep forward across his face on
      // the way — `paintFigure` draws the head circle before the near limbs, so
      // an arm anywhere near the muzzle paints over the one thing this move is
      // about. So the body stays bent double here and only the arms move.
      {
        t: 0.5,
        pose: P({
          hip: 10, torso: 42, head: 54,
          thighR: 138, shinR: 86, footR: -132,
          thighL: 224, shinL: 23, footL: -141,
          upperArmR: 176, forearmR: 26, handR: 8,
          upperArmL: 186, forearmL: 22, handL: 6,
        }),
        offsetX: 0.4, offsetY: -0.7, scaleX: 1.02, scaleY: 0.91,
      },
      // Frame 35: the chin comes up before the body does. He is still bent
      // double — the head is the *only* thing that moves, straight up out of the
      // strike and clear of the barrel. Leave it down while the spine rises and
      // the skull spends fifteen frames buried in his own chest.
      {
        t: 0.58,
        pose: P({
          hip: 10, torso: 38, head: -18,
          thighR: 140, shinR: 80, footR: -130,
          thighL: 220, shinL: 18, footL: -136,
          upperArmR: 156, forearmR: 18, handR: 6,
          upperArmL: 166, forearmL: 14, handL: 4,
        }),
        offsetX: 0.34, offsetY: -0.64, scaleX: 1.01, scaleY: 0.92,
      },
      // Frame 46: hanging off his own knuckles, arms swung through the vertical
      // and elbows locked, head up. The spine leads out and the neck has already
      // unwound, which is the opposite order to the way it went in.
      {
        t: 0.72,
        pose: P({
          hip: 8, torso: 34, head: -20,
          thighR: 146, shinR: 70, footR: -125,
          thighL: 212, shinL: 19, footL: -133,
          upperArmR: 126, forearmR: 6, handR: 2,
          upperArmL: 134, forearmL: 2, handL: 0,
        }),
        offsetX: 0.24, offsetY: -0.55,
      },
      // Frame 53, the last shape anyone actually sees. He does not finish
      // standing: sixty-three frames of commitment end bent over his own
      // knuckles with his chin still down, which is what the recovery feels
      // like to play against.
      {
        t: 0.86,
        pose: P({
          hip: 8, torso: 30, head: -18,
          thighR: 150, shinR: 61, footR: -123,
          thighL: 208, shinL: -5, footL: -115,
          upperArmR: 116, forearmR: -8, handR: -2,
          upperArmL: 124, forearmL: -6, handL: -2,
        }),
        offsetX: 0.1, offsetY: -0.45,
      },
      {
        t: 1,
        pose: P({
          hip: 6, torso: 26, head: -16,
          thighR: 154, shinR: 53, footR: -118,
          thighL: 204, shinL: -1, footL: -114,
          upperArmR: 118, forearmR: -14, handR: -4,
          upperArmL: 126, forearmL: -12, handL: -4,
        }),
        offsetX: 0.04, offsetY: -0.36,
      },
    ],
  },

  /**
   * Down special — Hand Slap. Down onto his knuckles and hammer the floor.
   *
   * The hitbox is at (8, 0.8): on the ground, in front of him. The pose that
   * carries the move is the quadruped one — shoulders over his hands, back
   * arched, head low and forward — because nobody else on the roster does it,
   * and blacked out it is unmistakably an ape.
   *
   * `fighters/donkeyKong.ts` declares one hit; the real grounded Hand Slap hits
   * twice per loop (frames 12-13 and 23-24). The clip animates the one slap the
   * data has rather than inventing a second the engine would not back.
   */
  downB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 0, torso: 6, head: -6,
          thighR: 160, shinR: 24, footR: -92,
          thighL: 200, shinL: 20, footL: -90,
          upperArmR: 152, forearmR: -20, handR: -6,
          upperArmL: 208, forearmL: -18, handL: -6,
        }),
      },
      // Both arms hauled up and the mass starting to fall. He does not lower
      // himself — he lets go.
      {
        t: 0.18,
        pose: P({
          hip: -4, torso: -10, head: 8,
          thighR: 168, shinR: 22, footR: -90,
          thighL: 202, shinL: 18, footL: -88,
          upperArmR: 22, forearmR: -26, handR: -10,
          upperArmL: 340, forearmL: 24, handL: 10,
        }),
        offsetY: 0.16, scaleY: 1.05,
        ease: "in",
      },
      // Contact, frame 12. Down on all fours: palms flat on the floor ahead of
      // him, shoulders stacked over them, spine arched, head low and forward.
      //
      // The spine does the work, not `offsetY`. Laid over to 55° accumulated,
      // the torso carries his shoulders forward and down over his hands and the
      // silhouette becomes a quadruped; drawn upright with a deep crouch
      // instead — which is what the first pass did — he read as a man hunching,
      // and the two planted palms disappeared into the barrel entirely. His
      // arms are 5.9 rig units against a 7.4-unit shoulder, so once the spine
      // is over they reach the floor without him having to sink at all.
      {
        t: 0.3,
        pose: P({
          hip: -6, torso: 61, head: -25,
          thighR: 146, shinR: 62, footR: -104,
          thighL: 156, shinL: 58, footL: -100,
          upperArmR: 85, forearmR: 30, handR: 15,
          upperArmL: 93, forearmL: 34, handL: 15,
        }),
        offsetY: -0.95, scaleX: 1.14, scaleY: 0.9,
        ease: "out",
      },
      // Frame 13, the second live frame — the palms stay on the floor.
      {
        t: 0.32,
        pose: P({
          hip: -6, torso: 63, head: -26,
          thighR: 145, shinR: 63, footR: -104,
          thighL: 155, shinL: 59, footL: -100,
          upperArmR: 84, forearmR: 31, handR: 15,
          upperArmL: 92, forearmL: 35, handL: 15,
        }),
        offsetY: -1.0, scaleX: 1.15, scaleY: 0.89,
      },
      // Still down there. The recovery is a body that has to get back up, not
      // one that springs.
      {
        t: 0.52,
        pose: P({
          hip: -4, torso: 54, head: -22,
          thighR: 148, shinR: 58, footR: -102,
          thighL: 158, shinL: 54, footL: -98,
          upperArmR: 92, forearmR: 22, handR: 10,
          upperArmL: 100, forearmL: 26, handL: 10,
        }),
        offsetY: -1.0, scaleX: 1.06, scaleY: 0.94,
      },
      {
        t: 0.8,
        pose: P({
          hip: -2, torso: 18, head: -8,
          thighR: 148, shinR: 48, footR: -98,
          thighL: 190, shinL: 40, footL: -94,
          upperArmR: 124, forearmR: -12, handR: -2,
          upperArmL: 186, forearmL: -10, handL: -2,
        }),
        offsetY: -0.5,
      },
      {
        t: 1,
        pose: P({
          hip: 0, torso: 8, head: -6,
          thighR: 158, shinR: 26, footR: -92,
          thighL: 198, shinL: 22, footL: -90,
          upperArmR: 134, forearmR: -30, handR: -8,
          upperArmL: 198, forearmL: -28, handL: -8,
        }),
        offsetY: -0.15,
      },
    ],
  },

  /**
   * Neutral air — the discus clothesline.
   *
   * SmashWiki: "Quickly spins around to perform discus clotheslines with both
   * arms, similarly to Spinning Kong." One turn about his *vertical* axis with
   * both arms locked out level, connecting clean on frame 10 (12%) and then
   * lingering weakly to frame 26 (9%) — a sex kick performed as a spin.
   *
   * ## The body goes flat, and that was the whole miss
   *
   * Round one drew this upright, and upright is not what it is. Frame-stepping
   * the hitbox GIF: frames 1-8 he is hunched and vertical with **one arm raised
   * straight up over his head**, elbow bent, fist clenched — and then on
   * **frame 9 he pitches his entire torso forward until it is roughly
   * horizontal**, chest down, head dropped and leading, **legs folded up under
   * his belly**, and spins like that. Prone, not standing. It is the reason
   * people describe this move as a helicopter, and a version of it drawn with
   * his feet under him is a different move with the same hitboxes.
   *
   * So the contact key lays 66° of accumulated spine over, tucks both knees to
   * the chest, and throws both arms out level. That silhouette — a horizontal
   * bar with a ball of legs under one end of it — is his and nothing else's.
   *
   * ## Drawing a vertical-axis turn in a side-on rig
   *
   * The spin itself is still a yaw, about the **world vertical**, and that
   * cannot be drawn directly. Clip-level `spin` rotates in the **screen**
   * plane, so `spin: 1` is a cartwheel, reading as tumble or as a launched
   * fighter. And the *strict* projection — the arm bar's apparent length
   * running to zero twice a revolution — buries both arms inside a brown barrel
   * for a third of the move, which here is thirteen frames of live hitbox with
   * nothing on screen.
   *
   * What is drawn is the legible half of that projection:
   *
   * - **which arm is in front trades ends.** Near arm forward and far arm back
   *   at contact, traded by frame 20, back by frame 27. That swap *is* the half
   *   turn, and it is the only unambiguous statement of yaw a side-on rig can
   *   make.
   * - **`scaleX` carries the quarter turns**, 1.15 broadside down to 0.62 edge
   *   on.
   * - **the pump does not start until frame 14.** The clean 12% hitbox is live
   *   on 10-13 and an edge-on frame inside that window is an arm bar drawn at
   *   62% of its length while the strongest hitbox in the move is out. So the
   *   clean window is one held, fully extended drawing and the turn is spent
   *   across the thirteen frames of weak tail — which is also what the frames
   *   do, since the spin stops around frame 21 and the last third of the active
   *   window is a decelerating arm retraction.
   *
   * The turn about the true axis is what `fx.ts` paints — the flat ring is the
   * circle his fists travel, and it is the one thing the pose cannot say.
   *
   * ## `strike: 9 / 38`
   *
   * The clean hitbox starts on frame 10, so `firstActive` is 9, and at
   * `strike = firstActive / total` the two-piece map in `poseTimeFor` collapses
   * to the identity. Every `t` below is literally its frame number over 38, so
   * the frame comments are checkable rather than approximate.
   */
  nair: {
    loop: false,
    strike: 9 / 38,
    keys: [
      // f0 — airborne, arms loose and low. `out` so he coils immediately
      // rather than sitting still for three frames of a ten-frame startup.
      {
        t: 0,
        pose: P({
          hip: 0, torso: 6, head: -4,
          thighR: 152, shinR: 46, footR: -80,
          thighL: 210, shinL: 42, footL: -76,
          upperArmR: 146, forearmR: -30, handR: -8,
          upperArmL: 214, forearmL: 28, handL: 8,
        }),
        ease: "out",
      },
      // f5 — the wind-up, and it is one-armed. The near fist goes straight up
      // over the crown with the elbow bent, the far arm stays low, and he is
      // still upright and hunched. The pair of fists wrapped in at the belt
      // that used to be here is a coil any fighter could do; a single arm
      // cocked overhead is the frame this move actually holds.
      {
        t: 5 / 38,
        pose: P({
          torso: 12, head: -8,
          thighR: 132, shinR: 80, footR: -70,
          thighL: 226, shinL: 72, footL: -66,
          upperArmR: 350, forearmR: 46, handR: 10,
          upperArmL: 168, forearmL: -34, handL: -8,
        }),
        offsetY: -0.1, scaleX: 0.92, scaleY: 1.05,
        ease: "in",
      },
      // f9 — contact, move frame 10. **The pitch-over.** Sixty-six degrees of
      // accumulated spine, both knees folded up under the belly, head dropped
      // and leading, and both arms thrown out and locked level. The widest,
      // flattest shape in his kit and the only prone one.
      {
        t: 9 / 38,
        pose: P({
          hip: 34, torso: 32, head: -21,
          thighR: 11, shinR: 150, footR: -70,
          thighL: 23, shinL: 148, footL: -66,
          upperArmR: 32, forearmR: 0, handR: 0,
          upperArmL: 202, forearmL: 0, handL: 0,
        }),
        offsetY: 0.35, scaleX: 1.15, scaleY: 0.93,
        ease: "out",
      },
      // Action frame 12 — move frame 13, the last frame the clean hitbox is
      // live. Still flat and still locked out, so the four frames 12% owns are
      // one held drawing at full span.
      //
      // This was authored at `13 / 38`, which under this clip's identity map is
      // action frame 13 and therefore move frame *14* — one past the window. On
      // a cubic `ease: "out"` that one frame costs 56% of the extension, so the
      // clean hitbox spent its last live frame with the arms already folding.
      {
        t: 12 / 38,
        pose: P({
          hip: 33, torso: 31, head: -20,
          thighR: 13, shinR: 148, footR: -70,
          thighL: 25, shinL: 146, footL: -66,
          upperArmR: 35, forearmR: 0, handR: 0,
          upperArmL: 199, forearmL: 0, handL: 0,
        }),
        offsetY: 0.34, scaleX: 1.12, scaleY: 0.94,
      },
      // f16 — edge on. A quarter turn: the bar has swung into the screen, so
      // what is left of it is 62% as wide. The body underneath keeps its span,
      // which is the depth cue — a rotating bar narrows, a squashing one does
      // not narrow *alone*.
      {
        t: 16 / 38,
        pose: P({
          hip: 32, torso: 30, head: -19,
          thighR: 16, shinR: 145, footR: -70,
          thighL: 28, shinL: 143, footL: -66,
          upperArmR: 40, forearmR: -4, handR: 0,
          upperArmL: 194, forearmL: 4, handL: 0,
        }),
        offsetY: 0.3, scaleX: 0.62, scaleY: 1.0,
      },
      // f20 — round the far side. The arms have traded ends: the hitbox is
      // still at x +5 and there is still an arm there, it is simply the other
      // one. This is the 9% half and it is drawn as the 9% half.
      {
        t: 20 / 38,
        pose: P({
          hip: 31, torso: 29, head: -18,
          thighR: 19, shinR: 142, footR: -70,
          thighL: 31, shinL: 140, footL: -66,
          upperArmR: 200, forearmR: 0, handR: 0,
          upperArmL: 36, forearmL: 0, handL: 0,
        }),
        scaleX: 1.1, scaleY: 0.95, offsetY: 0.26,
      },
      // f24 — edge on again, and the turn is already running down.
      {
        t: 24 / 38,
        pose: P({
          hip: 26, torso: 26, head: -14,
          thighR: 46, shinR: 118, footR: -74,
          thighL: 58, shinL: 114, footL: -70,
          upperArmR: 194, forearmR: 6, handR: 2,
          upperArmL: 44, forearmL: -6, handL: -2,
        }),
        scaleX: 0.66, scaleY: 1.0, offsetY: 0.18,
      },
      // f27 — last weak frame, and the spin is over: he is coming back up out
      // of prone with the arms drawing in, which is what the frames show for
      // the whole back third of the active window.
      {
        t: 27 / 38,
        pose: P({
          hip: 14, torso: 18, head: -6,
          thighR: 118, shinR: 74, footR: -78,
          thighL: 216, shinL: 60, footL: -74,
          upperArmR: 226, forearmR: 22, handR: 6,
          upperArmL: 118, forearmL: -22, handL: -6,
        }),
        scaleX: 1.02, scaleY: 0.99, offsetY: 0.06,
      },
      // f32 — out of it and upright again. Eleven frames of recovery need
      // somewhere to go, so the arms keep unwinding rather than parking.
      {
        t: 32 / 38,
        pose: P({
          hip: 4, torso: 8, head: -3,
          thighR: 146, shinR: 54, footR: -82,
          thighL: 206, shinL: 46, footL: -78,
          upperArmR: 218, forearmR: 26, handR: 6,
          upperArmL: 134, forearmL: -22, handL: -6,
        }),
      },
      // Terminator. He finishes half a turn from where he started — arms hung
      // the other way round — which is true of a fighter who has just spun once.
      {
        t: 1,
        pose: P({
          hip: 2, torso: 8, head: -6,
          thighR: 162, shinR: 34, footR: -84,
          thighL: 200, shinL: 30, footL: -80,
          upperArmR: 200, forearmR: 26, handR: 8,
          upperArmL: 162, forearmL: -26, handL: -8,
        }),
      },
    ],
  },

  /**
   * Back air — the mule kick.
   *
   * Frame 7 of 31, his fastest attack and his longest-reaching aerial: hitboxes
   * at `x: -9, y: 7`, clean on 7-8 and a weak tail out to 16. A piston, not a
   * wind-up — knees to the chest, then the near leg fires out behind him sole
   * first while four hundred pounds of upper body pitches forward as the
   * counterweight.
   *
   * **The leg cannot leave the body on its own.** Thigh + shin is 3.19 units
   * against a pelvis capsule 2.0 in radius whose cap is a circle, so only the
   * last 1.2 of shin and the foot ever clear the silhouette, at *every* angle.
   * What is left to spend is contrast: a tight tuck snapping through 190° in
   * four frames, plus `offsetX` running +0.35 → −0.55 so the sole covers more
   * ground on screen than the leg alone could. The pale sole is the read — it
   * is the only `skin` thing back there — so its angle is the frame.
   *
   * The kick is angled 30° up rather than level, because `y: 7` is two units
   * above his hip and a level kick puts the toe below the pelvis where it reads
   * as a foot he is standing on.
   */
  bair: {
    loop: false,
    strike: 0.24,
    keys: [
      // The tuck. Knee to the chest, ankle under the pelvis, shoulders already
      // dropping forward — everything loaded on one side of the hip. `in` is
      // cubic, so this is held flat through frames 0-3 and the whole kick
      // happens in 4, 5 and 6.
      {
        t: 0,
        pose: P({
          hip: 8, torso: 26, head: 2,
          thighR: 98, shinR: 110, footR: -88,
          thighL: 106, shinL: 102, footL: -86,
          upperArmR: 158, forearmR: -46, handR: -10,
          upperArmL: 166, forearmL: -40, handL: -10,
        }),
        offsetX: 0.35, offsetY: -0.15, scaleX: 0.97, scaleY: 1.02,
        ease: "in",
      },
      // Contact, move frame 7 — **flat out**, and this is round two's fix.
      //
      // The frames put the whole silhouette on one horizontal line: hands
      // reaching forward at the front with the head leading between them, torso
      // prone, and **one** leg snapped straight back along the same line. Drawn
      // with only 22° of spine, as this was, he is a hunched fighter kicking
      // backwards; at 62° accumulated the hands, the crown and the sole all sit
      // within a unit and a half of the same height and the shape is a bar.
      //
      // And it is one leg. The hitboxes run `footl` → `kneel` → `hip`, a single
      // chain, and the other foot is visibly tucked up under his belly. Both
      // legs thrown back — which is what this had — reads as a two-footed drop
      // kick, a move he does not have.
      {
        t: 0.24,
        pose: P({
          hip: 26, torso: 36, head: -22,
          thighR: 236, shinR: 0, footR: -92,
          thighL: 78, shinL: 104, footL: -70,
          upperArmR: 26, forearmR: 0, handR: 0,
          upperArmL: 20, forearmL: 4, handL: 0,
        }),
        offsetX: -0.55, offsetY: 0.15, scaleX: 1.14, scaleY: 0.97,
        ease: "out",
      },
      // Held. The weak hitbox is live to frame 16 — a third of the move — and
      // an `out` cubic would have the leg a third of the way home by frame 9.
      // The leg does not move here; the body unwinds around it.
      {
        t: 0.38,
        pose: P({
          hip: 24, torso: 34, head: -20,
          thighR: 236, shinR: 2, footR: -92,
          thighL: 82, shinL: 100, footL: -70,
          upperArmR: 32, forearmR: -2, handR: 0,
          upperArmL: 26, forearmL: 2, handL: 0,
        }),
        offsetX: -0.38, offsetY: 0.1, scaleX: 1.08, scaleY: 0.99,
      },
      // The sex-kick droop: the knee gives first and the leg sags behind him
      // while the spine starts to come back up under it, which is what an 8%
      // late hitbox is supposed to look like.
      {
        t: 0.56,
        pose: P({
          hip: 14, torso: 24, head: -12,
          thighR: 224, shinR: 22, footR: -94,
          thighL: 100, shinL: 88, footL: -76,
          upperArmR: 74, forearmR: -18, handR: -4,
          upperArmL: 68, forearmL: -14, handL: -4,
        }),
        offsetX: -0.2, offsetY: 0.04, scaleX: 1.03,
      },
      // Hauling the leg back under him. `autoCancelAfter: 31` means the last
      // frames are a landing shape, so he finishes hunched over his knuckles.
      {
        t: 0.78,
        pose: P({
          hip: 2, torso: 16, head: 6,
          thighR: 202, shinR: 40, footR: -88,
          thighL: 196, shinL: 38, footL: -86,
          upperArmR: 150, forearmR: -34,
          upperArmL: 160, forearmL: -30,
        }),
        offsetX: -0.06,
      },
      {
        t: 1,
        pose: P({
          hip: 2, torso: 16, head: 14,
          thighR: 172, shinR: 52, footR: -86,
          thighL: 188, shinL: 44, footL: -86,
          upperArmR: 164, forearmR: -34,
          upperArmL: 174, forearmL: -30,
        }),
      },
    ],
  },

  /**
   * Up air — the arcing headbutt.
   *
   * One hitbox at `x: 0, y: 17`, dead overhead and a unit and a half above his
   * crown, live on frames 6-10 of 37 — and his head is *intangible* on 5-10, so
   * the skull goes through whatever it meets. There are no arms in this move at
   * all, and that is the design problem: `paintFigure` draws the head circle
   * before the near limbs, so an arm anywhere near the face erases the one
   * thing the move is about. Both arms hang for the whole clip and the only
   * things that move are the neck, the spine and the offsets.
   *
   * SmashWiki: from Melee onward it is "a headbutt in an arc **starting from
   * behind**", which is why the crown sweeps back → apex → forward across the
   * active window rather than just tipping. `head: -38` on a spine arched to
   * −12 swings the dark brow prop to the very top of the head circle, and on
   * this rig the brow *is* the striking surface.
   *
   * The height comes from the stretch, not the angles — any head tilt lowers
   * the crown — so it is bought with `offsetY` −0.6 → +0.7 and `scaleY` 0.90 →
   * 1.18, which is 4.9 rig units of crown travel in five frames.
   */
  uair: {
    loop: false,
    strike: 0.24,
    keys: [
      // The gather. Knees up, spine curled, chin dropped — the whole animal
      // compressed a tenth so there is somewhere to uncoil from.
      {
        t: 0,
        pose: P({
          hip: 8, torso: 16, head: 6,
          thighR: 122, shinR: 76, footR: -84,
          thighL: 128, shinL: 70, footL: -82,
          upperArmR: 156, forearmR: -16, handR: -4,
          upperArmL: 166, forearmL: -12, handL: -4,
        }),
        offsetY: -0.6, scaleX: 1.06, scaleY: 0.9,
        ease: "in",
      },
      // Contact, move frame 6. Head snapped back and up off a spine arched the
      // other way, legs run out straight below, arms left hanging. Brow ridge
      // at the crown, muzzle level, throat open.
      {
        t: 0.24,
        pose: P({
          hip: 8, torso: -12, head: -38,
          thighR: 180, shinR: 14, footR: -62,
          thighL: 174, shinL: 18, footL: -64,
          upperArmR: 164, forearmR: -18, handR: -4,
          upperArmL: 174, forearmL: -14, handL: -4,
        }),
        offsetY: 0.7, scaleY: 1.18, scaleX: 0.93,
        ease: "out",
      },
      // Frame 8, the top of the arc and the highest the crown gets: the skull
      // passes vertical dead over the centreline, which is exactly where
      // `x: 0, y: 17` is. Still inside the active window, so the extension is
      // not being given back — it is being carried through.
      {
        t: 0.3,
        pose: P({
          hip: 6, torso: -6, head: -4,
          thighR: 184, shinR: 12, footR: -66,
          thighL: 178, shinL: 16, footL: -68,
          upperArmR: 170, forearmR: -14, handR: -4,
          upperArmL: 180, forearmL: -10, handL: -4,
        }),
        offsetY: 0.72, scaleY: 1.18, scaleX: 0.93,
      },
      // Frame 10, the last live frame: the head has come over the front of the
      // arc and the chin is dropping. Twenty-six recovery frames start here.
      {
        t: 0.38,
        pose: P({
          hip: 2, torso: 6, head: 24,
          thighR: 176, shinR: 22, footR: -74,
          thighL: 172, shinL: 24, footL: -76,
          upperArmR: 178, forearmR: -8, handR: -2,
          upperArmL: 188, forearmL: -4, handL: -2,
        }),
        offsetY: 0.45, scaleY: 1.1, scaleX: 0.96,
      },
      {
        t: 0.56,
        pose: P({
          hip: 0, torso: 12, head: 8,
          thighR: 172, shinR: 30, footR: -80,
          thighL: 178, shinL: 28, footL: -80,
          upperArmR: 174, forearmR: -14,
          upperArmL: 184, forearmL: -10,
        }),
        offsetY: 0.16, scaleY: 1.03,
      },
      // The knees come back up into a fall. `landingLag: 15`, so the tail is
      // him getting his feet under a body that is still going up.
      {
        t: 0.8,
        pose: P({
          hip: 2, torso: 8, head: -2,
          thighR: 146, shinR: 58, footR: -86,
          thighL: 170, shinL: 52, footL: -86,
          upperArmR: 162, forearmR: -30,
          upperArmL: 172, forearmL: -26,
        }),
        offsetY: 0.02,
      },
      {
        t: 1,
        pose: P({
          hip: 2, torso: 10, head: -2,
          thighR: 156, shinR: 48, footR: -86,
          thighL: 184, shinL: 40, footL: -86,
          upperArmR: 168, forearmR: -34,
          upperArmL: 178, forearmL: -30,
        }),
      },
    ],
  },

  /**
   * Forward air — the double axe handle.
   *
   * Both fists clasped into one club, hauled up over the crown and split down
   * in front of him like a man splitting wood. The two hitboxes are the arc:
   * 16% at `(8, 6)` on frames 18-20, then 15% at `(8, 3)` on 21-23 at a literal
   * angle 270 with `meteor`. So the club is still travelling *down* while it is
   * live, which is why there is a key at `t = 0.392` — the t frame 23 maps to —
   * and not just a strike key.
   *
   * The clasp is the whole read, and on this rig it is *not* the symmetric pair
   * every other clip uses. `upperArmL = 360 − upperArmR` puts one arm forward
   * and one back; here both have to arrive in the same place, so they are
   * twelve degrees apart at the shoulder and drawn back together at the elbow —
   * the far arm shows as a second edge just above the near one and the fists
   * land as one mass. The swing is thrown slightly forward of the centreline,
   * because a double axe handle down the middle passes through his face.
   */
  fair: {
    loop: false,
    strike: 0.3,
    keys: [
      // The gather. Hands together low in front of the belt, elbows out, knees
      // drawn up — everything that is about to go up is down.
      {
        t: 0,
        pose: P({
          hip: 2, torso: 18, head: -12,
          thighR: 150, shinR: 54, footR: -84,
          thighL: 164, shinL: 48, footL: -88,
          upperArmR: 140, forearmR: 34, handR: 10,
          upperArmL: 148, forearmL: 26, handL: 10,
        }),
        offsetY: -0.1,
        ease: "out",
      },
      // Halfway up, spine opening out of the crouch — so the rise reads as a
      // rise instead of the fists teleporting to the top of the hold.
      {
        t: 0.055,
        pose: P({
          hip: 2, torso: -6, head: 4,
          thighR: 168, shinR: 42, footR: -84,
          thighL: 180, shinL: 36, footL: -86,
          upperArmR: 84, forearmR: -12, handR: -4,
          upperArmL: 74, forearmL: -2, handL: -4,
        }),
        offsetX: -0.14, offsetY: 0.08, scaleY: 1.02,
        ease: "out",
      },
      // The top, held for frames 6-11 of an 18-frame startup. Fists above and
      // forward of the crown, spine arched twenty-six degrees back, legs
      // trailing. `hold`, because this is the drawing the opponent is meant to
      // have time to read and panic about.
      {
        t: 0.115,
        pose: P({
          hip: 4, torso: -26, head: 6,
          thighR: 186, shinR: 28, footR: -84,
          thighL: 198, shinL: 24, footL: -86,
          upperArmR: 66, forearmR: -22, handR: -8,
          upperArmL: 56, forearmL: -12, handL: -8,
        }),
        offsetX: -0.28, offsetY: 0.32, scaleY: 1.05,
        ease: "hold",
      },
      // The cut, and the commitment: the club tips over the top and the body
      // starts to unwind. Ninety degrees of arm in the last four frames.
      {
        t: 0.2,
        pose: P({
          hip: 4, torso: -18, head: 2,
          thighR: 180, shinR: 36, footR: -82,
          thighL: 192, shinL: 30, footL: -86,
          upperArmR: 68, forearmR: -8, handR: -6,
          upperArmL: 58, forearmL: 2, handL: -6,
        }),
        offsetX: -0.2, offsetY: 0.22, scaleY: 1.04,
        ease: "in",
      },
      // Contact, move frame 18. Fists driven out and down to chest height —
      // thirty-five degrees below horizontal, which is the `(8, 6)` box — the
      // trunk folded thirty over, knees pulled up into the swing.
      {
        t: 0.3,
        pose: P({
          hip: 0, torso: 30, head: -26,
          thighR: 146, shinR: 52, footR: -78,
          thighL: 158, shinL: 46, footL: -82,
          upperArmR: 100, forearmR: -5, handR: 0,
          upperArmL: 88, forearmL: 7, handL: 0,
        }),
        offsetX: 0.5, offsetY: -0.45, scaleX: 1.08, scaleY: 0.95,
        ease: "out",
      },
      // Frame 23 — the last live frame, and the meteor half. The spike gets its
      // own drawing instead of the recovery's first frame: fists to knee
      // height, and half that drop comes from the trunk folding to fifty rather
      // than from the shoulder, which is what a wood-splitting chop does.
      {
        t: 0.392,
        pose: P({
          hip: -2, torso: 50, head: -42,
          thighR: 138, shinR: 64, footR: -74,
          thighL: 150, shinL: 58, footL: -78,
          upperArmR: 94, forearmR: -6, handR: 0,
          upperArmL: 82, forearmL: 6, handL: 0,
        }),
        offsetX: 0.6, offsetY: -0.75, scaleX: 1.06, scaleY: 0.94,
        ease: "out",
      },
      // Through it. The club keeps going under him; the lowest the move gets.
      {
        t: 0.47,
        pose: P({
          hip: -4, torso: 56, head: -48,
          thighR: 142, shinR: 60, footR: -76,
          thighL: 154, shinL: 54, footL: -80,
          upperArmR: 110, forearmR: -6, handR: 0,
          upperArmL: 98, forearmL: 6, handL: 0,
        }),
        offsetX: 0.38, offsetY: -0.95, scaleY: 0.96,
      },
      // Hauling the spine back up. Thirty-two recovery frames and 17 of landing
      // lag need somewhere to go or they read as a freeze.
      {
        t: 0.63,
        pose: P({
          hip: 0, torso: 34, head: -28,
          thighR: 152, shinR: 48, footR: -80,
          thighL: 166, shinL: 42, footL: -84,
          upperArmR: 140, forearmR: -6, handR: 0,
          upperArmL: 128, forearmL: 6, handL: 0,
        }),
        offsetX: 0.2, offsetY: -0.55,
      },
      // The knuckle hang — arms straight down past his knees, which is the one
      // proportion `rig.ts` promises.
      {
        t: 0.88,
        pose: P({
          hip: 0, torso: 14, head: -10,
          thighR: 160, shinR: 38, footR: -84,
          thighL: 176, shinL: 32, footL: -88,
          upperArmR: 170, forearmR: -6, handR: 0,
          upperArmL: 158, forearmL: 6, handL: 0,
        }),
        offsetY: -0.2,
      },
      {
        t: 1,
        pose: P({
          hip: 0, torso: 10, head: -8,
          thighR: 164, shinR: 32, footR: -86,
          thighL: 180, shinL: 28, footL: -88,
          upperArmR: 172, forearmR: -6,
          upperArmL: 160, forearmL: 6,
        }),
        offsetY: -0.12,
      },
    ],
  },

  /**
   * Down air — the stomp.
   *
   * Knees to the chest, then both feet stamped straight down beneath him. The
   * sweetspot is at `(1, -2)`: **below his own soles at rest**, so the pose has
   * to actually put them there — legs locked out, toes angled down, body
   * dropped almost a unit on `offsetY`.
   *
   * This is the clip where `footL` and `footR` both resting at `-88` matters
   * most, because the feet *are* the move: both are written negative and only
   * fourteen degrees apart, and the toes point forward on every frame.
   *
   * ## The arms go up, not out
   *
   * The contact frame is a **vertical exclamation mark**: torso straight up and
   * down, **both arms thrown up and outward above his head in a shallow V**,
   * head tucked down between them, and both legs driven straight down together
   * with the feet stacked. He is *not* curled at contact — he curls in the
   * fourteen frames before it and then snaps out into a line.
   *
   * That is the correction round two made. The arms used to be thrown out
   * *level and wide*, which gave a wide top and a narrow bottom but also gave
   * him the same crucifix his neutral air already owns; and the feet were
   * staggered "so there are visibly two", which fights the one thing this move
   * has that no other does — a single mass of foot at the bottom of a straight
   * body. Arms up narrows the top and lengthens the whole figure, so the
   * silhouette becomes a spike with a pair of soles on the end of it, and the
   * two spread fists at the top read as a second, opposite pair.
   *
   * His legs are the shortest thing on him and they live inside a hip capsule
   * four units wide, so almost none of them ever leaves the silhouette — what a
   * player reads is the soles. Which is why they are what `fx.ts` puts a
   * shockwave under.
   */
  dair: {
    loop: false,
    strike: 0.28,
    keys: [
      // Falling, legs starting to fold. Fourteen frames of startup begins here.
      {
        t: 0,
        pose: P({
          hip: 0, torso: 10, head: -8,
          thighR: 148, shinR: 60, footR: -92,
          thighL: 164, shinL: 52, footL: -96,
          upperArmR: 112, forearmR: -10, handR: -6,
          upperArmL: 234, forearmL: 10, handL: 6,
        }),
        ease: "out",
      },
      // The tuck, held frames 6-10. Knees level with his chest, heels drawn in,
      // body curled and riding up — a ball, with both arms already cocking
      // upward so the snap into the line is one continuous throw rather than
      // two gestures. On this rig the legs barely leave the body, so the
      // *travel* of the soles is the whole animation and the tuck is where that
      // travel is bought.
      {
        t: 0.1,
        pose: P({
          hip: -6, torso: 20, head: -14,
          thighR: 88, shinR: 128, footR: -122,
          thighL: 102, shinL: 118, footL: -126,
          upperArmR: 76, forearmR: -22, handR: -8,
          upperArmL: 288, forearmL: 22, handL: 8,
        }),
        offsetY: 0.8, scaleY: 0.88, scaleX: 1.12,
        ease: "hold",
      },
      // Maximum compression, hips at their highest. `in`, so the four frames
      // that follow are the whole stamp.
      {
        t: 0.2,
        pose: P({
          hip: -8, torso: 24, head: -16,
          thighR: 80, shinR: 138, footR: -128,
          thighL: 94, shinL: 128, footL: -132,
          upperArmR: 62, forearmR: -26, handR: -8,
          upperArmL: 300, forearmL: 26, handL: 8,
        }),
        offsetY: 0.95, scaleY: 0.86, scaleX: 1.14,
        ease: "in",
      },
      // Contact, move frame 14. The exclamation mark: spine bolt upright, both
      // arms thrown up and out in a shallow V above the crown, head tucked
      // between them, both legs locked out straight down with the feet stacked.
      // Nearly five units of sole travel in four frames.
      {
        t: 0.28,
        pose: P({
          hip: 0, torso: 0, head: 6,
          thighR: 178, shinR: 2, footR: -80,
          thighL: 182, shinL: 0, footL: -80,
          upperArmR: 32, forearmR: -4, handR: 0,
          upperArmL: 328, forearmL: 4, handL: 0,
        }),
        offsetY: -0.9, scaleY: 1.18, scaleX: 0.9,
        ease: "out",
      },
      // Frame 16, the last live frame and the deepest point. A cubic `out`
      // would have given up two thirds of the extension by here on its own,
      // which is a spike put away while it is still hitting.
      {
        t: 0.315,
        pose: P({
          hip: 0, torso: -1, head: 7,
          thighR: 179, shinR: 1, footR: -80,
          thighL: 181, shinL: 0, footL: -80,
          upperArmR: 30, forearmR: -4, handR: 0,
          upperArmL: 330, forearmL: 4, handL: 0,
        }),
        offsetY: -1.1, scaleY: 1.17, scaleX: 0.9,
      },
      // The recoil. Knees soften and the arms come down out of the V.
      {
        t: 0.42,
        pose: P({
          hip: 0, torso: 2, head: 4,
          thighR: 166, shinR: 22, footR: -86,
          thighL: 190, shinL: 16, footL: -84,
          upperArmR: 62, forearmR: -12, handR: -2,
          upperArmL: 298, forearmL: 12, handL: 2,
        }),
        offsetY: -0.7, scaleY: 1.06, scaleX: 0.96,
      },
      {
        t: 0.6,
        pose: P({
          hip: 0, torso: 6, head: -4,
          thighR: 140, shinR: 64, footR: -94,
          thighL: 168, shinL: 40, footL: -88,
          upperArmR: 118, forearmR: -20, handR: -4,
          upperArmL: 234, forearmL: 20, handL: 4,
        }),
        offsetY: -0.3,
      },
      // Back to falling, knees up, arms in. Thirty-eight recovery frames and 14
      // of landing lag; he does not get to look ready.
      {
        t: 0.88,
        pose: P({
          hip: 0, torso: 10, head: -8,
          thighR: 130, shinR: 88, footR: -104,
          thighL: 150, shinL: 74, footL: -104,
          upperArmR: 138, forearmR: -34, handR: -6,
          upperArmL: 216, forearmL: 34, handL: 6,
        }),
        offsetY: -0.05,
      },
      {
        t: 1,
        pose: P({
          hip: 0, torso: 12, head: -10,
          thighR: 132, shinR: 84, footR: -102,
          thighL: 152, shinL: 70, footL: -102,
          upperArmR: 142, forearmR: -36,
          upperArmL: 212, forearmL: 36,
        }),
      },
    ],
  },
};
