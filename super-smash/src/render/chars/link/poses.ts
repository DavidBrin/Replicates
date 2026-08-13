/**
 * Link: the clips that are Link’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * Link earns nearly all of them, for one reason: he is a swordsman, and a sword
 * swing is not a punch played on a longer arm. The shared clips hold the blade
 * out in front and travel about eighty degrees with it over three frames, which
 * on a fighter who is holding four rig units of Master Sword reads as a man
 * pointing. Every clip below exists because the *blade path* is the move — an
 * overhead chop, a low sweep, a thrust, a whirl — and the blade path is the one
 * thing a rig cannot supply for free.
 *
 * Two of them are here for the opposite reason. Link’s neutral air is a flying
 * kick and his back air is two kicks, and the shared clips are a spread-legged
 * sex kick and a single back kick — close enough to be tempting and wrong about
 * how long the leg stays out, which for a move whose hitbox is live for
 * twenty-five of its thirty-eight frames is the whole move.
 *
 * Author against the real move: the frame data (ultimateframedata.com) says
 * when the hitbox is live, and `poseTimeFor` will put the clip’s `strike` key
 * on that frame whatever the numbers are, so the clip only has to be the right
 * *shape*. Where a move has **no** hitbox — the bow, the boomerang, the bomb —
 * there is no `strike`, no remap, and clip time is exactly `frame / totalFrames`:
 * those three place their release keys by hand, and the comments say where.
 *
 * The motions themselves are SmashWiki’s descriptions of the real animations,
 * quoted in each clip’s comment, checked against captures of this rig.
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/**
 * Link, standing — "Wait", the pose a player looks at more than any other, and
 * the one he did not have.
 *
 * The shared clip is a person standing to attention with their arms hanging,
 * ankles within a tenth of a unit of each other, breathing a degree and a half
 * of chest. On Link that puts four and a half rig units of Master Sword
 * pointing straight down *through his own shins*: the one prop that is supposed
 * to carry his silhouette is hidden inside his legs, and what is left is a
 * green man in a hat.
 *
 * Ultimate's Link — SmashWiki, verbatim — "has a new idle pose, reminiscent to
 * his battle stance when holding a broadsword and shield in Breath of the Wild;
 * his legs are positioned farther apart, his sword and shield are held up at
 * all times, and **he does not bounce in place**." Measured off SmashWiki's own
 * idle captures, as fractions of his crown-to-sole height:
 *
 * | | measured | here |
 * |---|---|---|
 * | ankle to ankle | 0.52 H | 0.32 H — see below |
 * | trail leg, off vertical | 33° back, knee flexed ~12° | 26° back, flexed 12° |
 * | lead leg, off vertical | 21° forward, shin vertical | 24° forward, flexed 24° |
 * | stance height vs upright | 6–7% lower | 5% lower |
 * | blade, off vertical | **29° up and BACK**, tip above the crown | 32° up and back, tip a hair over the crown |
 * | head travel over one cycle | **under 1% of H** | 0.4% |
 *
 * Four things follow, and three of them are the opposite of what the shared
 * clip does.
 *
 *   1. **The legs are an A-frame.** The lead leg drives its knee forward over
 *      the ankle; the trailing leg braces back nearly straight, flexed about a
 *      dozen degrees. Seven units of ankle separation — the measured 0.52 H —
 *      is not reachable: the pelvis is pinned four and a quarter units above
 *      the feet and the legs are four and a fifth long, so that much spread
 *      would need the splits. 4.3 units is reachable, and it is fifteen times
 *      the shared clip's tenth of a unit.
 *
 *      The **near** leg leads, which is the opposite of what the reference
 *      infers (it reads the shield-side left foot as forward, and flags that as
 *      inference rather than a source). It is deliberate and it is about this
 *      file rather than about Link: every one of the twenty other clips here
 *      already leads with the near leg, and a stance that led with the far one
 *      would cross his feet over during the last few frames of every single
 *      attack as the recovery converged on `STAND`. A shuffle-step at the end of
 *      every move costs more than the side the lead foot is on.
 *   2. **The sword points UP and BACK, not down.** This is the correction that
 *      matters most and the one that was least guessable: the hand is tucked
 *      low and behind at the trailing hip with the elbow closed to about 120°,
 *      and the blade rakes *up* over the trailing shoulder with the tip near
 *      head height behind him. It also happens to solve the geometry problem
 *      the down-pointing version has, which is that a four-and-a-half-unit
 *      blade hanging off a hand at hip height ends up inside the stage.
 *   3. **He does not bounce.** The difference map over the reference's wait
 *      frames has hot pixels in exactly two places — the sword hand and the
 *      head — and the crown moves one pixel in two hundred and sixty. So the
 *      whole breath is four degrees at the sword shoulder, a degree at the
 *      neck, and a hair of chest: `scaleY` moves four thousandths and `offsetY`
 *      fifteen thousandths of a unit. That is deliberately *less* life than the
 *      shared clip has, because standing dead still is the read.
 *      What keeps four thousandths from looking like a metronome is the shared
 *      clip's own trick, kept: four keys at uneven times so no two parts of the
 *      body turn round together, and only the inhale eased so the loop does not
 *      stall four times a cycle.
 *   4. **The off arm is closed and forward.** Ultimate's Link guards with the
 *      Hylian Shield on that arm through every frame of this animation — it is
 *      the second-strongest cue in his silhouette after the leg A-frame. Here
 *      the shield is slung across his back instead, because a prop is welded to
 *      a bone for every clip a fighter has and that same hand draws a bow,
 *      throws a boomerang and holds a bomb (`rig.ts`; and the report for this
 *      round asks for the shared change that would fix it). What survives is
 *      the arm: elbow closed, forearm angled up and across, hand at chest
 *      height in front. It is the shape the shield would be strapped to.
 */
const idleClip: PoseClip = {
  loop: true,
  period: 102,
  keys: [
    // The settle. Sword shoulder at the back of its four-degree drift.
    {
      t: 0,
      pose: P({
        hip: 0.6, torso: 7, head: -6,
        thighL: 213.4, shinL: 10, footL: -116,
        thighR: 129.4, shinR: 28, footR: -68,
        upperArmR: 200.4, forearmR: 120, handR: 0,
        upperArmL: 139.4, forearmL: -55,
      }),
      offsetY: -0.93,
      scaleY: 1.0,
    },
    // Top of the inhale, such as it is: four thousandths of stretch about the
    // feet. `scaleY` rather than `offsetY` because stretching leaves the soles
    // on the stage and translating lifts them off it.
    {
      t: 0.33,
      pose: P({
        hip: 0.4, torso: 6.4, head: -5.2,
        thighL: 213.6, shinL: 10.5, footL: -116,
        thighR: 129.85, shinR: 27, footR: -68,
        upperArmR: 198.4, forearmR: 121, handR: -1.2,
        upperArmL: 140.6, forearmL: -56,
      }),
      offsetY: -0.915,
      scaleY: 1.004,
      ease: "linear",
    },
    // The head arrives late — still coming up as the chest starts down — which
    // is the whole of "the head has its own rhythm" at this amplitude.
    {
      t: 0.57,
      pose: P({
        hip: 0.8, torso: 7.2, head: -7,
        thighL: 213.05, shinL: 9.5, footL: -116,
        thighR: 129.05, shinR: 29, footR: -68,
        upperArmR: 202.4, forearmR: 119, handR: 1,
        upperArmL: 138.8, forearmL: -54,
      }),
      offsetY: -0.925,
      scaleY: 1.001,
      ease: "linear",
    },
    // Lowest point of the cycle, a hair under key 0, so the last span is a
    // recovery into the settle rather than a fourth extreme.
    {
      t: 0.79,
      pose: P({
        hip: 0.65, torso: 7.3, head: -6.4,
        thighL: 213.35, shinL: 9.8, footL: -116,
        thighR: 129.35, shinR: 28.5, footR: -68,
        upperArmR: 201.2, forearmR: 119.6, handR: 0.2,
        upperArmL: 139.6, forearmL: -54.6,
      }),
      offsetY: -0.945,
      scaleY: 0.999,
      ease: "linear",
    },
  ],
};

/**
 * The stance every grounded clip converges towards — `idleClip`'s settle key,
 * written once, with the height its folded legs are owed.
 *
 * A terminator at `t = 1` is never drawn, but the frames before it *travel*
 * towards it, so it decides what the last tenth of every recovery looks like.
 * While Link used the shared idle these all ended on the shared library's
 * arms-hanging stand, which was very nearly the pose he was about to be in.
 * Now it is not: his stance is an A-frame two thirds of a unit lower than
 * standing upright, with the blade raked back over his shoulder. A recovery
 * aimed at the old stand straightens his legs, lifts him, and swings the sword
 * down through his shins for the last few frames of every attack, and then the
 * four-frame cross-fade in `blend.ts` drags it all back out again.
 *
 * `offsetY` travels with the pose and is not optional: the stance folds its
 * legs, so a terminator that took the angles and left the offset at zero would
 * end every attack with Link standing two thirds of a unit above the stage.
 *
 * Not used by the crouching recoveries (`dtilt`, `dsmash`, `dthrow`), which
 * deliberately converge on a kneel, nor by the aerials, which are followed by
 * a fall and not by standing.
 */
const STAND = {
  hip: 0.6, torso: 7, head: -6,
  thighL: 213.4, shinL: 10, footL: -116,
  thighR: 129.4, shinR: 28, footR: -68,
  upperArmR: 200.4, forearmR: 120, handR: 0,
  upperArmL: 139.4, forearmL: -55,
} as const;

/** How far the stance's folded legs lower the body. See `STAND`. */
const STAND_Y = -0.93;

/** The terminator every grounded clip ends on: the stance, at the stance's height. */
const standKey = { t: 1, pose: P(STAND), offsetY: STAND_Y } as const;

/** Link, jab: a fast downward slash from over the shoulder. */
const jabClip: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 8,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 200, shinL: 20, footL: -84,
        upperArmR: 300, forearmR: 35,
        upperArmL: 150, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 14, head: -10,
        thighR: 152, shinR: 22, footR: -86,
        thighL: 208, shinL: 20, footL: -82,
        upperArmR: 72, forearmR: -4,
        upperArmL: 205, forearmL: -55,
      }),
      offsetX: 0.3,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.4,
      pose: P({
        torso: 6, head: -4,
        thighR: 154, shinR: 22, footR: -86,
        thighL: 204, shinL: 20, footL: -83,
        upperArmR: 108, forearmR: 4,
        upperArmL: 192, forearmL: -46,
      }),
      offsetX: 0.16,
    },
    standKey,
  ],
};

/** Link, forward tilt: a lunging downward slash. */
const ftiltClip: PoseClip = {
  loop: false,
  strike: 0.32,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -16, head: 10,
        thighR: 162, shinR: 26, footR: -86,
        thighL: 200, shinL: 24, footL: -82,
        upperArmR: 318, forearmR: 30,
        upperArmL: 156, forearmL: -26,
      }),
      offsetX: -0.3,
      ease: "in",
    },
    {
      t: 0.32,
      pose: P({
        torso: 16, head: -12, hip: -4,
        thighR: 132, shinR: 40, footR: -80,
        thighL: 224, shinL: 18, footL: -74,
        upperArmR: 74, forearmR: -6,
        upperArmL: 226, forearmL: -58,
      }),
      offsetX: 0.75,
      offsetY: -0.35,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 8, head: -6,
        thighR: 136, shinR: 38, footR: -80,
        thighL: 218, shinL: 18, footL: -76,
        upperArmR: 112, forearmR: 5,
        upperArmL: 212, forearmL: -48,
      }),
      offsetX: 0.45,
      offsetY: -0.3,
    },
    {
      t: 0.66,
      pose: P({
        torso: 6, head: -2,
        thighR: 144, shinR: 30, footR: -84,
        thighL: 210, shinL: 20, footL: -78,
        upperArmR: 140, forearmR: 10,
        upperArmL: 200, forearmL: -40,
      }),
      offsetX: 0.2,
      offsetY: -0.15,
    },
    standKey,
  ],
};

/** Link, up tilt: an overhead arcing slash that starts from behind him. */
const utiltClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 150, shinR: 40, footR: -84,
        thighL: 204, shinL: 34, footL: -82,
        upperArmR: 216, forearmR: 20,
        upperArmL: 216, forearmL: -36,
      }),
      offsetY: -0.5,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -8, head: 10,
        thighR: 168, shinR: 14, footR: -88,
        thighL: 194, shinL: 12, footL: -86,
        upperArmR: 18, forearmR: 2,
        upperArmL: 344, forearmL: 6,
      }),
      offsetY: 0.3,
      scaleY: 1.1,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 2, head: 2,
        thighR: 162, shinR: 20, footR: -86,
        thighL: 198, shinL: 18, footL: -84,
        upperArmR: 88, forearmR: 2,
        upperArmL: 306, forearmL: -8,
      }),
      offsetY: 0.1,
    },
    {
      t: 0.62,
      pose: P({
        torso: 6, head: -2,
        thighR: 156, shinR: 26, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 132, forearmR: 8,
        upperArmL: 252, forearmL: -24,
      }),
    },
    standKey,
  ],
};

/** Link, down tilt: a kneeling inward slash along the ground. */
const dtiltClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 20, head: -16,
        thighR: 136, shinR: 90, footR: -80,
        thighL: 144, shinL: 86, footL: -78,
        upperArmR: 320, forearmR: 10,
        upperArmL: 330, forearmL: -20,
      }),
      offsetY: -1.5,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 24, head: -18, hip: -6,
        thighR: 122, shinR: 96, footR: -76,
        thighL: 148, shinL: 94, footL: -74,
        upperArmR: 84, forearmR: 4,
        upperArmL: 300, forearmL: -34,
      }),
      offsetX: 0.35,
      offsetY: -1.95,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 22, head: -16,
        thighR: 126, shinR: 94, footR: -78,
        thighL: 148, shinL: 92, footL: -74,
        upperArmR: 122, forearmR: 6,
        upperArmL: 290, forearmL: -30,
      }),
      offsetX: 0.16,
      offsetY: -1.85,
    },
    {
      t: 0.66,
      pose: P({
        torso: 20, head: -14,
        thighR: 132, shinR: 88, footR: -80,
        thighL: 146, shinL: 86, footL: -76,
        upperArmR: 156, forearmR: 8,
        upperArmL: 316, forearmL: -24,
      }),
      offsetY: -1.65,
    },
    { t: 1, pose: P({ torso: 18, thighR: 136, shinR: 90, thighL: 146, shinL: 86, upperArmR: 160, forearmR: 8 }), offsetY: -1.5 },
  ],
};

/** Link, dash attack — the Jump Slash: a hop into a downward slash. */
const dashAttackClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 24, head: -16,
        thighR: 140, shinR: 50, footR: -80,
        thighL: 214, shinL: 30, footL: -74,
        upperArmR: 300, forearmR: 32,
        upperArmL: 150, forearmL: -34,
      }),
      offsetX: 0.2,
      ease: "in",
    },
    {
      t: 0.18,
      pose: P({
        torso: 10, head: -6,
        thighR: 128, shinR: 74, footR: -70,
        thighL: 150, shinL: 70, footL: -70,
        upperArmR: 320, forearmR: 26,
        upperArmL: 160, forearmL: -30,
      }),
      offsetX: 0.6,
      offsetY: 0.7,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 26, head: -20, hip: -8,
        thighR: 132, shinR: 34, footR: -80,
        thighL: 222, shinL: 26, footL: -72,
        upperArmR: 76, forearmR: -8,
        upperArmL: 232, forearmL: -56,
      }),
      offsetX: 1.25,
      offsetY: 0.15,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 18, head: -12,
        thighR: 138, shinR: 34, footR: -82,
        thighL: 214, shinL: 26, footL: -74,
        upperArmR: 122, forearmR: 5,
        upperArmL: 214, forearmL: -46,
      }),
      offsetX: 0.85,
    },
    {
      t: 0.66,
      pose: P({
        torso: 12, head: -6,
        thighR: 146, shinR: 30, footR: -84,
        thighL: 206, shinL: 22, footL: -78,
        upperArmR: 152, forearmR: 8,
        upperArmL: 200, forearmL: -38,
      }),
      offsetX: 0.4,
    },
    standKey,
  ],
};
/**
 * Link, forward smash — スマッシュ斬り, a two-handed lunging overhead chop.
 *
 * The one move on his card that is really two moves. SmashWiki: hit one is *"a
 * two-handed, lunging downward slash"*; press attack again and hit two is *"a
 * single-handed outward slash"*. Only the first is simulated here — the engine
 * gives `fsmash` one hitbox window, frames 17–18 of 50 — so the animation's job
 * is to say, without lying about a hitbox, that a second swing is sitting
 * there. It does that with the shape the real move actually holds.
 *
 * The beats, stepped off SmashWiki's own hitbox capture. Their frame numbers
 * are the game's, one ahead of `actionFrame`; the `t` column is where
 * `poseTimeFor` puts each one given `strike: 0.3` and a first active frame of
 * 17.
 *
 * | game f | t | what |
 * |---|---|---|
 * | 5–11 | 0.06–0.19 | the hilt rises up and behind the head while the **blade keeps pointing forward** — it ends lying flat over his own skull with the tip out in front at head height |
 * | **9–10** | **0.165** | **the charge locks here.** `poseTimeFor` parks a charging smash at `strike × 0.55`, which is exactly this key, and the real move charges on exactly these frames |
 * | 12–14 | 0.24 | the left hand joins the hilt; both arms lift and the blade rotates *backwards* over him, tip going forward → up → up-back |
 * | 15 | 0.2625 | apex: arms locked out overhead, blade near horizontal pointing straight back |
 * | 16 | 0.281 | the torso pitches violently forward; the blade starts over |
 * | **17** | **0.30** | **contact.** Deep split lunge, rear leg stretched back, front knee folded, blade horizontal forward at chest height — which is where both this move's hitboxes are (y = 7.5 of a 14-unit fighter) |
 * | 18 | 0.32 | the arc carries on down; tip near the ground |
 * | 22–36 | 0.40–0.69 | **the second-hit window.** He *holds the lunge* and retracts the blade to a low trailing position behind him, which is the wind-up hit two fires from |
 * | 37+ | 0.84+ | nobody pressed: he comes up out of the lunge |
 *
 * Two things this gets right that the previous version had backwards.
 *
 * **The charge pose.** A charging smash is frozen on one frame for as long as
 * the player holds the button, so it is the single most-looked-at frame of the
 * move, and it was a generic coil with the blade tucked behind the shoulder.
 * The real one is unmistakable and nobody else on the roster has it: hilt above
 * and behind the head, **blade lying flat forward over his own skull**, point
 * out in front at head height. The arm that does it is a closed elbow with the
 * upper arm swept up and back — the wrist is cocked about sixty-five degrees,
 * which is a lot, and is what carrying a sword over your shoulder costs.
 *
 * **The hold during the input window.** It was cocked *up in front*, which is
 * neither what the move does nor a shape that means anything. The real
 * animation drags the sword *back and low behind him* over frames 19–36 and
 * stays down in the lunge until 37 — the retraction is literally hit two's
 * wind-up. So the window now reads as a fighter still loaded, and the frames
 * are not identical: the blade rakes fifteen degrees further back across the
 * window and the front knee eases, so it is held rather than frozen.
 *
 * The lunge is the other thing worth having. Measured off the reference it
 * covers about six tenths of his own height, which is not expressible here —
 * `offsetX` moves the drawing and not the hurtbox, so a large one detaches the
 * fighter from what can hit him. Two rig units of `offsetX` plus a genuinely
 * split stance (front thigh sixty degrees forward, rear leg raked thirty-eight
 * back, ankles five units apart) carries most of the read at a tenth of the
 * cost.
 */
const fsmashClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    // Frame 0. Leaving the stance: sword still raked back over the shoulder,
    // knees softening. Attacks are not cross-faded into — `blend.ts` cuts to
    // them, because a jab whose hitbox is out on frame 2 cannot afford four
    // frames of arriving — so frame 0 has to already be where standing left off.
    {
      t: 0,
      pose: P({
        hip: 1, torso: 6, head: -6,
        thighL: 205, shinL: 12, footL: -112,
        thighR: 137, shinR: 24, footR: -72,
        upperArmR: 201, forearmR: 112, handR: 0,
        upperArmL: 145, forearmL: -100,
      }),
      offsetY: -0.65,
      ease: "in",
    },
    // Frame ~3. The hilt lifts and the blade swings up through vertical, tip
    // high. The weight goes back off the front foot.
    //
    // Ten degrees *behind* vertical rather than ten in front, and the reason is
    // the HUD. The blade reaches five units above his head here, which is above
    // the crown, and the port tag is drawn after the fighter and directly over
    // it — so a tip that goes straight up spends four frames behind a red
    // parallelogram with `P1` written on it. Raked back it clears the tag
    // horizontally instead. The tag is readability and a fighter should move
    // out of its way rather than fight it.
    {
      t: 0.06,
      pose: P({
        hip: 2, torso: 2, head: -2,
        thighL: 200, shinL: 14, footL: -112,
        thighR: 138, shinR: 22, footR: -74,
        upperArmR: 300, forearmR: 50, handR: -14,
        upperArmL: 148, forearmL: -85,
      }),
      offsetX: -0.4,
      offsetY: -0.7,
      ease: "in",
    },
    // Frames 9–10, and the pose a charging smash parks on. Hilt above and
    // behind the head, blade lying flat forward over the skull with the point
    // out in front at head height, one hand on the grip, the off arm dropped
    // forward as a counterweight. Coiled and low.
    {
      t: 0.165,
      pose: P({
        hip: 6, torso: -4, head: 6,
        thighL: 202, shinL: 14, footL: -114,
        thighR: 136, shinR: 26, footR: -78,
        upperArmR: 299, forearmR: 92, handR: 67,
        upperArmL: 126, forearmL: -40,
      }),
      offsetX: -0.75,
      offsetY: -0.8,
      scaleX: 0.96,
      ease: "in",
    },
    // Frame ~13. The off hand takes the hilt and both arms lift; the blade
    // rotates back over him, tip travelling forward → up → up-and-behind.
    {
      t: 0.244,
      pose: P({
        hip: 4, torso: -14, head: 12,
        thighL: 203, shinL: 13, footL: -113,
        thighR: 137, shinR: 25, footR: -76,
        upperArmR: -20, forearmR: 10, handR: -30,
        upperArmL: -15, forearmL: 5,
      }),
      offsetX: -0.5,
      offsetY: -0.6,
      ease: "in",
    },
    // Frame 15. The apex, and the tallest shape in the move: both arms locked
    // out overhead, blade near horizontal pointing straight back over him.
    {
      t: 0.2625,
      pose: P({
        hip: 6, torso: -18, head: 14,
        thighL: 199, shinL: 14, footL: -112,
        thighR: 139, shinR: 24, footR: -76,
        upperArmR: -3, forearmR: -5, handR: -50,
        upperArmL: 2, forearmL: -12,
      }),
      offsetX: -0.6,
      offsetY: -0.5,
      scaleX: 0.92,
      scaleY: 1.06,
      ease: "in",
    },
    // Frame 16. The torso pitches forward and the blade starts over the top.
    // The single largest frame-to-frame rotation in the move is the next one.
    {
      t: 0.281,
      pose: P({
        hip: -2, torso: 20, head: -14,
        thighL: 210, shinL: 8, footL: -116,
        thighR: 126, shinR: 34, footR: -78,
        upperArmR: 332, forearmR: 0, handR: -30,
        upperArmL: 336, forearmL: -6,
      }),
      offsetX: 0.4,
      offsetY: -0.7,
      ease: "in",
    },
    // Frame 17: contact. A deep split lunge — front thigh sixty degrees
    // forward with the knee folded, rear leg stretched thirty-eight degrees
    // back, chest out over the front knee — with both hands driving the blade
    // through horizontal at chest height, which is the line both hitboxes sit
    // on.
    {
      t: 0.3,
      pose: P({
        hip: -8, torso: 30, head: -22,
        thighL: 226, shinL: 2, footL: -120,
        thighR: 130, shinR: 44, footR: -76,
        upperArmR: 117, forearmR: -95, handR: 51,
        upperArmL: 122, forearmL: -84,
      }),
      // The hands ride a unit higher than the reference's, which drops them to
      // the front knee. This move's two hitboxes are both at `y = 7.5` of a
      // 14-unit fighter — chest height — and a blade drawn at knee height while
      // the box that hits is at chest height is the graphic lying about where
      // the move reaches. `scaleY` is nearly 1 for the same reason: squashing
      // the contact frame pulled the blade a further half-unit below its box.
      offsetX: 2.0,
      offsetY: -0.95,
      scaleX: 1.12,
      scaleY: 0.99,
      ease: "out",
    },
    // Frame 18, the second active frame. The arc carries on down and the tip
    // finishes near the stage in front of him.
    {
      t: 0.322,
      pose: P({
        hip: -6, torso: 24, head: -16,
        thighL: 222, shinL: 4, footL: -119,
        thighR: 128, shinR: 42, footR: -76,
        upperArmR: 118, forearmR: -40, handR: 39,
        upperArmL: 124, forearmL: -60,
      }),
      offsetX: 1.5,
      offsetY: -0.9,
      scaleX: 1.06,
    },
    // Frame ~19, and a key that exists for one reason: the blade is 4.6 units
    // long and the hand sits at hip height, so *any* frame where the point is
    // aimed straight down puts it through the stage. Going from the
    // forward-down finish to the low trailing hold in one span passes through
    // exactly that, and the tip spent two frames under the floor. Lifting the
    // hand to chest height for the turn keeps the point above the boards the
    // whole way round.
    {
      t: 0.36,
      pose: P({
        hip: -4, torso: 22, head: -14,
        thighL: 218, shinL: 4, footL: -119,
        thighR: 128, shinR: 42, footR: -77,
        upperArmR: 77, forearmR: 116.35, handR: -36.4,
        upperArmL: 132, forearmL: -56,
      }),
      offsetX: 1.35,
      offsetY: -0.9,
      scaleX: 1.03,
    },
    // Frame ~22. The second-hit window opens. The lunge is *held* and the blade
    // has been dragged back and down behind him — the position hit two's
    // one-handed outward slash scoops forward out of. The off hand comes off
    // the hilt and opens.
    {
      t: 0.4,
      pose: P({
        hip: 0, torso: 14, head: -10,
        thighL: 214, shinL: 4, footL: -118,
        thighR: 128, shinR: 40, footR: -78,
        upperArmR: 192, forearmR: 23, handR: 3,
        upperArmL: 140, forearmL: -50,
      }),
      offsetX: 1.2,
      offsetY: -0.9,
      // Linear, not the default `smooth`. Smoothstep is zero-velocity at both
      // ends, so easing the hold makes the fifteen frames the second input is
      // read in stall at each end — which is exactly what a frozen frame looks
      // like. A constant quarter-degree a frame reads as a fighter still
      // loaded and waiting.
      ease: "linear",
    },
    // Frame ~28, mid-window. Held, not frozen: the blade rakes a few degrees
    // further back and the front knee eases, which is the difference between a
    // fighter waiting and a dropped frame.
    {
      t: 0.55,
      pose: P({
        hip: 0, torso: 12, head: -8,
        thighL: 211, shinL: 6, footL: -117,
        thighR: 131, shinR: 38, footR: -78,
        upperArmR: 196, forearmR: 26, handR: 4,
        upperArmL: 144, forearmL: -54,
      }),
      offsetX: 1.05,
      offsetY: -0.85,
      ease: "linear",
    },
    // Frame ~36, the last frame the second input is read on, and the furthest
    // back the blade gets.
    {
      t: 0.69,
      pose: P({
        hip: 0, torso: 10, head: -6,
        thighL: 209, shinL: 8, footL: -116,
        thighR: 134, shinR: 34, footR: -78,
        upperArmR: 202, forearmR: 29, handR: 4,
        upperArmL: 148, forearmL: -58,
      }),
      offsetX: 0.85,
      offsetY: -0.82,
      ease: "out",
    },
    // Frame ~42. Nobody pressed: he comes up out of the lunge and the sword
    // swings back up to where standing carries it.
    {
      t: 0.84,
      pose: P({
        hip: 0.4, torso: 8.5, head: -6.5,
        thighL: 205.6, shinL: 10, footL: -113,
        thighR: 136.6, shinR: 28, footR: -74,
        upperArmR: 200, forearmR: 66, handR: 5,
        upperArmL: 146, forearmL: -80,
      }),
      offsetX: 0.35,
      offsetY: -0.72,
    },
    // Terminator, never drawn — Link's own stance, so the last frame of the
    // recovery is already standing.
    standKey,
  ],
};

/** Link, up smash: three overhead arcing slashes, alternating direction. */
const usmashClip: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 138, shinR: 78, footR: -84,
        thighL: 146, shinL: 74, footL: -82,
        upperArmR: 222, forearmR: 14,
        upperArmL: 230, forearmL: -40,
      }),
      offsetY: -1.1,
      ease: "in",
    },
    {
      t: 0.24,
      pose: P({
        torso: -6, head: 8,
        thighR: 168, shinR: 12, footR: -88,
        thighL: 194, shinL: 12, footL: -86,
        upperArmR: 22, forearmR: 4,
        upperArmL: 340, forearmL: 8,
      }),
      offsetY: 0.35,
      scaleY: 1.12,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.32,
      pose: P({
        torso: 6, head: -2,
        thighR: 160, shinR: 18, footR: -86,
        thighL: 198, shinL: 16, footL: -84,
        upperArmR: 96, forearmR: 3,
        upperArmL: 300, forearmL: -10,
      }),
      offsetY: 0.1,
      ease: "in",
    },
    {
      t: 0.41,
      pose: P({
        torso: -4, head: 6,
        thighR: 166, shinR: 12, footR: -88,
        thighL: 195, shinL: 12, footL: -86,
        upperArmR: 6, forearmR: 3,
        upperArmL: 348, forearmL: 6,
      }),
      offsetY: 0.3,
      scaleY: 1.1,
      scaleX: 0.95,
      ease: "out",
    },
    {
      t: 0.49,
      pose: P({
        torso: 0, head: 2,
        thighR: 162, shinR: 16, footR: -86,
        thighL: 197, shinL: 14, footL: -85,
        upperArmR: 288, forearmR: 12,
        upperArmL: 316, forearmL: -8,
      }),
      offsetY: 0.15,
      ease: "in",
    },
    {
      t: 0.59,
      pose: P({
        torso: -10, head: 10,
        thighR: 170, shinR: 10, footR: -88,
        thighL: 192, shinL: 10, footL: -87,
        upperArmR: 22, forearmR: 2,
        upperArmL: 338, forearmL: 8,
      }),
      offsetY: 0.55,
      scaleY: 1.18,
      scaleX: 0.9,
      ease: "out",
    },
    {
      t: 0.7,
      pose: P({
        torso: 4, head: -2,
        thighR: 160, shinR: 18, footR: -86,
        thighL: 198, shinL: 16, footL: -84,
        upperArmR: 92, forearmR: 4,
        upperArmL: 292, forearmL: -12,
      }),
      offsetY: 0.1,
      scaleY: 1.04,
    },
    {
      t: 0.84,
      pose: P({
        torso: 6, head: -4,
        thighR: 154, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 138, forearmR: 12,
        upperArmL: 248, forearmL: -30,
      }),
    },
    standKey,
  ],
};

/** Link, down smash: a kneeling inward slash in front, then one behind. */
const dsmashClip: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 18, head: -14,
        thighR: 138, shinR: 88, footR: -80,
        thighL: 146, shinL: 84, footL: -78,
        upperArmR: 300, forearmR: 12,
        upperArmL: 320, forearmL: -20,
      }),
      offsetY: -1.6,
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 22, head: -16, hip: -4,
        thighR: 126, shinR: 96, footR: -76,
        thighL: 150, shinL: 92, footL: -74,
        upperArmR: 84, forearmR: 4,
        upperArmL: 300, forearmL: -34,
      }),
      offsetX: 0.35,
      offsetY: -1.95,
      scaleX: 1.14,
      scaleY: 0.9,
      ease: "out",
    },
    {
      t: 0.35,
      pose: P({
        torso: 20, head: -12,
        thighR: 128, shinR: 94, footR: -76,
        thighL: 150, shinL: 90, footL: -74,
        upperArmR: 140, forearmR: 8,
        upperArmL: 286, forearmL: -30,
      }),
      offsetX: 0.1,
      offsetY: -1.95,
      ease: "in",
    },
    {
      t: 0.457,
      pose: P({
        torso: 6, head: 8, hip: -4,
        thighR: 132, shinR: 92, footR: -76,
        thighL: 152, shinL: 88, footL: -74,
        upperArmR: 236, forearmR: 8,
        upperArmL: 130, forearmL: -40,
      }),
      offsetX: -0.35,
      offsetY: -1.95,
      scaleX: 1.14,
      scaleY: 0.9,
      ease: "out",
    },
    {
      t: 0.58,
      pose: P({
        torso: 10, head: 2,
        thighR: 134, shinR: 90, footR: -78,
        thighL: 150, shinL: 86, footL: -76,
        upperArmR: 278, forearmR: 10,
        upperArmL: 160, forearmL: -34,
      }),
      offsetX: -0.16,
      offsetY: -1.8,
    },
    {
      t: 0.75,
      pose: P({
        torso: 14, head: -6,
        thighR: 140, shinR: 76, footR: -80,
        thighL: 148, shinL: 72, footL: -78,
        upperArmR: 204, forearmR: 4,
        upperArmL: 200, forearmL: -30,
      }),
      offsetY: -1.4,
    },
    { t: 1, pose: P({ torso: 10, thighR: 148, shinR: 60, thighL: 154, shinL: 56, upperArmR: 158, forearmR: 8 }), offsetY: -0.9 },
  ],
};

/**
 * Link, neutral air: a flying kick — not a sword move (his nair hitboxes carry
 * no slash effect, which agrees). The clean hit is frames 7–8 and the weak tail
 * runs to frame 31 of 38, so the leg has to stay out for four fifths of the
 * clip rather than snapping back after the contact key.
 */
const nairClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -4,
        thighR: 150, shinR: 60, footR: -80,
        thighL: 200, shinL: 50, footL: -78,
        upperArmR: 200, forearmR: 20,
        upperArmL: 200, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 6, head: -2,
        thighR: 90, shinR: -14, footR: 16,
        thighL: 236, shinL: 52, footL: -60,
        upperArmR: 250, forearmR: 22,
        upperArmL: 120, forearmL: -22,
      }),
      scaleX: 1.12,
      scaleY: 0.94,
      ease: "out",
    },
    {
      t: 0.34,
      pose: P({
        torso: 4,
        thighR: 96, shinR: -8, footR: 12,
        thighL: 230, shinL: 50, footL: -62,
        upperArmR: 244, forearmR: 20,
        upperArmL: 124, forearmL: -20,
      }),
      scaleX: 1.08,
    },
    {
      t: 0.6,
      pose: P({
        torso: 2,
        thighR: 104, shinR: -4, footR: 8,
        thighL: 224, shinL: 48, footL: -64,
        upperArmR: 236, forearmR: 18,
        upperArmL: 132, forearmL: -18,
      }),
      scaleX: 1.04,
    },
    {
      t: 0.825,
      pose: P({
        torso: 2,
        thighR: 118, shinR: 6, footR: -4,
        thighL: 216, shinL: 44, footL: -66,
        upperArmR: 224, forearmR: 16,
        upperArmL: 144, forearmL: -18,
      }),
    },
    {
      t: 0.92,
      pose: P({
        torso: 2,
        thighR: 138, shinR: 26, footR: -40,
        thighL: 208, shinL: 38, footL: -70,
        upperArmR: 200, forearmR: 12,
        upperArmL: 172, forearmL: -22,
      }),
    },
    { t: 1, pose: P({ torso: 2, thighR: 146, shinR: 34, thighL: 206, shinL: 30, upperArmR: 176, upperArmL: 196 }) },
  ],
};

/**
 * Link, forward air: two alternating outward slashes. The first comes down
 * across the front (frames 16–17), the second comes back up through it
 * (frames 24–25) — alternating, so the blade never has to rewind.
 */
const fairClip: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -12, head: 10,
        thighR: 152, shinR: 44, footR: -76,
        thighL: 204, shinL: 40, footL: -74,
        upperArmR: 328, forearmR: 22,
        upperArmL: 160, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: 16, head: -12, hip: -4,
        thighR: 144, shinR: 40, footR: -72,
        thighL: 208, shinL: 36, footL: -72,
        upperArmR: 88, forearmR: -4,
        upperArmL: 216, forearmL: -50,
      }),
      offsetX: 0.3,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.36,
      pose: P({
        torso: 12, head: -8,
        thighR: 148, shinR: 40, footR: -74,
        thighL: 206, shinL: 36, footL: -72,
        upperArmR: 148, forearmR: 8,
        upperArmL: 206, forearmL: -44,
      }),
      offsetX: 0.16,
      ease: "in",
    },
    {
      t: 0.44,
      pose: P({
        torso: 4, head: -2, hip: -2,
        thighR: 150, shinR: 38, footR: -74,
        thighL: 206, shinL: 34, footL: -72,
        upperArmR: 74, forearmR: -6,
        upperArmL: 220, forearmL: -48,
      }),
      offsetX: 0.3,
      scaleX: 1.08,
      ease: "out",
    },
    {
      t: 0.56,
      pose: P({
        torso: -2, head: 4,
        thighR: 152, shinR: 36, footR: -76,
        thighL: 204, shinL: 32, footL: -74,
        upperArmR: 20, forearmR: 2,
        upperArmL: 200, forearmL: -40,
      }),
      offsetX: 0.14,
    },
    {
      t: 0.76,
      pose: P({
        torso: 4,
        thighR: 150, shinR: 34, footR: -76,
        thighL: 204, shinL: 30, footL: -74,
        upperArmR: 106, forearmR: 6,
        upperArmL: 196, forearmL: -34,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 152, forearmR: 8, upperArmL: 194, forearmL: -30 }) },
  ],
};

/**
 * Link, back air: a hook kick followed by a mid-level roundhouse — two kicks,
 * no sword, one per hitbox window (frames 6–8 and 15–17 of 30).
 */
const bairClip: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -12,
        thighR: 140, shinR: 70, footR: -74,
        thighL: 148, shinL: 66, footL: -72,
        upperArmR: 150, forearmR: -30,
        upperArmL: 150, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.24,
      pose: P({
        torso: 30, head: -24, hip: 8,
        thighR: 290, shinR: -6, footR: -30,
        thighL: 176, shinL: 46, footL: -70,
        upperArmR: 120, forearmR: -40,
        upperArmL: 116, forearmL: -38,
      }),
      offsetX: -0.4,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.36,
      pose: P({
        torso: 18, head: -14,
        thighR: 220, shinR: 40, footR: -60,
        thighL: 200, shinL: 30, footL: -70,
        upperArmR: 140, forearmR: -34,
        upperArmL: 140, forearmL: -32,
      }),
      offsetX: -0.15,
      ease: "in",
    },
    {
      t: 0.514,
      pose: P({
        torso: 28, head: -22, hip: 6,
        thighR: 190, shinR: 30, footR: -70,
        thighL: 292, shinL: -4, footL: -30,
        upperArmR: 118, forearmR: -38,
        upperArmL: 122, forearmL: -40,
      }),
      offsetX: -0.4,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.72,
      pose: P({
        torso: 14, head: -10,
        thighR: 178, shinR: 34, footR: -74,
        thighL: 212, shinL: 30, footL: -68,
        upperArmR: 150, forearmR: -26,
        upperArmL: 152, forearmL: -28,
      }),
      offsetX: -0.15,
    },
    { t: 1, pose: P({ torso: 8, thighR: 172, shinR: 32, thighL: 204, shinL: 28, upperArmR: 166, upperArmL: 176 }) },
  ],
};

/**
 * Link, up air — the Jump Thrust: the sword driven straight up in both hands.
 * The hitbox lives from frame 11 to frame 40 of 59, so the blade stays up for
 * two thirds of the clip; a thrust that retracts on the contact frame is a
 * thrust that spends most of the move claiming nothing.
 */
const uairClip: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 148, shinR: 58, footR: -78,
        thighL: 200, shinL: 52, footL: -76,
        upperArmR: 200, forearmR: 30,
        upperArmL: 206, forearmL: -26,
      }),
      ease: "in",
    },
    {
      t: 0.22,
      pose: P({
        torso: -8, head: 8,
        thighR: 172, shinR: 10, footR: -84,
        thighL: 190, shinL: 10, footL: -84,
        upperArmR: 10, forearmR: -2,
        upperArmL: 350, forearmL: 2,
      }),
      offsetY: 0.35,
      scaleY: 1.16,
      scaleX: 0.9,
      ease: "out",
    },
    {
      t: 0.42,
      pose: P({
        torso: -4, head: 6,
        thighR: 170, shinR: 12, footR: -84,
        thighL: 192, shinL: 12, footL: -84,
        upperArmR: 14, forearmR: -2,
        upperArmL: 346, forearmL: 2,
      }),
      offsetY: 0.2,
      scaleY: 1.1,
      scaleX: 0.93,
    },
    {
      t: 0.698,
      pose: P({
        torso: 0, head: 4,
        thighR: 166, shinR: 16, footR: -84,
        thighL: 194, shinL: 14, footL: -84,
        upperArmR: 22, forearmR: 0,
        upperArmL: 338, forearmL: 4,
      }),
      offsetY: 0.08,
      scaleY: 1.04,
    },
    {
      t: 0.86,
      pose: P({
        torso: 6, head: -2,
        thighR: 158, shinR: 26, footR: -82,
        thighL: 200, shinL: 22, footL: -80,
        upperArmR: 86, forearmR: 6,
        upperArmL: 290, forearmL: -12,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 150, forearmR: 8, upperArmL: 226, forearmL: -26 }) },
  ],
};

/**
 * Link, down air — the Down Thrust: the sword point driven straight down under
 * him, held there. The meteor window is frames 14–19 and the weak tail runs to
 * frame 64 of 79, so the blade is down for four fifths of the clip; the legs
 * fold back out of its way rather than hanging through it.
 */
const dairClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 8,
        thighR: 146, shinR: 70, footR: -78,
        thighL: 200, shinL: 66, footL: -76,
        upperArmR: 300, forearmR: 40,
        upperArmL: 214, forearmL: 20,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 4, head: -2,
        thighR: 208, shinR: 66, footR: -66,
        thighL: 222, shinL: 62, footL: -64,
        upperArmR: 158, forearmR: 8,
        upperArmL: 176, forearmL: 6,
      }),
      offsetY: -0.2,
      scaleY: 1.16,
      scaleX: 0.86,
      ease: "out",
    },
    {
      t: 0.45,
      pose: P({
        torso: 2,
        thighR: 212, shinR: 62, footR: -66,
        thighL: 224, shinL: 60, footL: -64,
        upperArmR: 162, forearmR: 8,
        upperArmL: 178, forearmL: 6,
      }),
      offsetY: -0.12,
      scaleY: 1.1,
      scaleX: 0.9,
    },
    {
      t: 0.818,
      pose: P({
        torso: 0,
        thighR: 206, shinR: 58, footR: -68,
        thighL: 220, shinL: 56, footL: -66,
        upperArmR: 166, forearmR: 8,
        upperArmL: 182, forearmL: 6,
      }),
      scaleY: 1.06,
      scaleX: 0.94,
    },
    {
      t: 0.92,
      pose: P({
        torso: 0,
        thighR: 190, shinR: 44, footR: -74,
        thighL: 208, shinL: 42, footL: -72,
        upperArmR: 160, forearmR: 8,
        upperArmL: 196, forearmL: 4,
      }),
    },
    { t: 1, pose: P({ torso: 0, thighR: 176, shinR: 32, thighL: 198, shinL: 30, upperArmR: 156, upperArmL: 196 }) },
  ],
};

/**
 * Link, Hero's Bow.
 *
 * The bow has **no hitbox**, so `strike` never fires and clip time is exactly
 * `frame / 44`. The arrow leaves on frame 16, so the loose is authored at
 * t = 16/44 ≈ 0.364 and nowhere else.
 *
 * The bow is held in the **left** hand and the string drawn with the right.
 * That is the wrong hand for the real Link and the only one that works here:
 * the sword is a prop welded to `handR` and is drawn whatever the pose does, so
 * a bow in the right hand is a bow with a sword through it — which is exactly
 * what the first capture showed. With the draw hand at his cheek the blade
 * instead rakes back over his shoulder, out of the shot and out of the way.
 */
const neutralBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 158, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 250, forearmR: 40,
        upperArmL: 128, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 0, head: 0,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 210, shinL: 22, footL: -82,
        upperArmR: 288, forearmR: 26,
        upperArmL: 88, forearmL: 2,
      }),
      offsetX: 0.1,
      ease: "in",
    },
    {
      t: 0.364,
      pose: P({
        torso: 4, head: -4,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 212, shinL: 22, footL: -82,
        upperArmR: 302, forearmR: 18,
        upperArmL: 86, forearmL: 2,
      }),
      offsetX: 0.18,
      scaleX: 1.04,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 2, head: -2,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 208, shinL: 22, footL: -83,
        upperArmR: 268, forearmR: 8,
        upperArmL: 104, forearmL: 4,
      }),
      offsetX: 0.08,
    },
    {
      t: 0.76,
      pose: P({
        torso: 4,
        thighR: 154, shinR: 22, footR: -86,
        thighL: 204, shinL: 20, footL: -84,
        upperArmR: 208, forearmR: 8,
        upperArmL: 140, forearmL: -16,
      }),
    },
    standKey,
  ],
};

/**
 * Link, Boomerang: an overhand hurl with the left hand.
 *
 * No hitbox, so `strike` never fires and clip time is exactly `frame / 45`.
 * The boomerang leaves on frame 27, so the release is authored at t = 0.6 and
 * nowhere else — three fifths of this move is wind-up, which is why it is the
 * one special of his that can be seen coming.
 *
 * Thrown left-handed, which the real Link does not do. The sword is welded to
 * `handR`, so a right-handed throw is a thrown sword; moving the shield off the
 * left forearm and onto his back (see `rig.ts`) is what frees the hand that
 * this, the bomb and the grab all need.
 *
 * Overhand, and the wind-up is now **behind** the head rather than in front of
 * it. Ultimate throws this with a full torso coil — his back turns to the
 * camera, he folds forward at the waist, and the arm cocks above and behind the
 * skull before whipping forward into a lunge. Round one could not draw that:
 * move effects were painted under the fighter with no way out, so a boomerang
 * wound up behind his shoulder was a boomerang behind his cap, and two capture
 * rounds had nothing visible until frame 24. It was solved by moving the
 * wind-up in *front* of his head, which was the right call with the tools of
 * the time and the wrong shape. `over` is the tool that was missing.
 *
 * A side-view rig cannot turn a torso, so what survives of the coil is the
 * rest of it: weight back and chest opened away through frames 10-22, then the
 * arm whipping down and forward into a deep lunge for the release on 27, and
 * the throwing arm held straight out at chin height through the follow-through.
 */
const sideBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 202, shinL: 20, footL: -84,
        upperArmR: 196, forearmR: 10,
        upperArmL: 40, forearmL: -24,
      }),
      ease: "in",
    },
    // Frames ~10-22: the coil, and the read of the whole move. Ultimate turns
    // his back to the camera and bends him deeply at the waist while the
    // throwing arm cocks *above and behind the skull*, arm nearly straight. A
    // side-view rig cannot turn a torso, so what is expressible is the rest:
    // weight back, chest opened away, and the boomerang a head's width past the
    // back of his head — where `over` can now paint it.
    {
      t: 0.35,
      pose: P({
        torso: -16, head: 12,
        thighR: 168, shinR: 26, footR: -86,
        thighL: 196, shinL: 22, footL: -80,
        upperArmR: 202, forearmR: 10,
        upperArmL: -26, forearmL: -4,
      }),
      offsetX: -0.5,
      ease: "in",
    },
    {
      t: 0.6,
      pose: P({
        torso: 26, head: -20, hip: -6,
        thighR: 132, shinR: 36, footR: -82,
        thighL: 224, shinL: 20, footL: -74,
        upperArmR: 214, forearmR: 12,
        upperArmL: 54, forearmL: 16,
      }),
      offsetX: 0.9,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.75,
      pose: P({
        torso: 12, head: -8,
        thighR: 138, shinR: 32, footR: -83,
        thighL: 218, shinL: 20, footL: -76,
        upperArmR: 200, forearmR: 10,
        upperArmL: 66, forearmL: 12,
      }),
      offsetX: 0.55,
    },
    {
      t: 0.88,
      pose: P({
        torso: 8, head: -4,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 206, shinL: 20, footL: -82,
        upperArmR: 182, forearmR: 8,
        upperArmL: 150, forearmL: -18,
      }),
      offsetX: 0.14,
    },
    standKey,
  ],
};

/**
 * Link, Spin Attack: the blade whirls a full turn around him, twice, over the
 * long active window (frames 7–39 of 76), and he rises as it does.
 *
 * The rotation is in the *arm*, not in the clip's `spin`. `spin` turns the whole
 * body about its middle, which in a side view is a cartwheel — and Spin Attack
 * is a pirouette about the vertical axis, which a side view cannot show at all.
 * What a player actually reads is the blade going round, so the blade goes
 * round: successive keys step the accumulated hand angle by ninety degrees, each
 * step well under the half-turn at which shortest-path interpolation would flip
 * direction, which is what lets a chain of keys express a rotation that a single
 * pair never could.
 */
const upBClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 12, head: -10,
        thighR: 140, shinR: 74, footR: -80,
        thighL: 148, shinL: 70, footL: -78,
        upperArmR: 226, forearmR: 14,
        upperArmL: 220, forearmL: -34,
      }),
      offsetY: -1.0,
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 4, head: -2,
        thighR: 156, shinR: 40, footR: -84,
        thighL: 200, shinL: 36, footL: -82,
        upperArmR: 96, forearmR: 2,
        upperArmL: 268, forearmL: -10,
      }),
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.26,
      pose: P({
        torso: 2,
        thighR: 164, shinR: 28, footR: -86,
        thighL: 196, shinL: 26, footL: -84,
        upperArmR: 186, forearmR: 2,
        upperArmL: 358, forearmL: -6,
      }),
      offsetY: 0.2,
      ease: "linear",
    },
    {
      t: 0.32,
      pose: P({
        torso: 2,
        thighR: 168, shinR: 22, footR: -86,
        thighL: 194, shinL: 20, footL: -85,
        upperArmR: 276, forearmR: 2,
        upperArmL: 88, forearmL: -6,
      }),
      offsetY: 0.34,
      ease: "linear",
    },
    {
      t: 0.38,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 18, footR: -87,
        thighL: 192, shinL: 18, footL: -86,
        upperArmR: 4, forearmR: 2,
        upperArmL: 176, forearmL: -6,
      }),
      offsetY: 0.46,
      ease: "linear",
    },
    {
      t: 0.44,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -87,
        thighL: 192, shinL: 16, footL: -86,
        upperArmR: 94, forearmR: 2,
        upperArmL: 266, forearmL: -6,
      }),
      offsetY: 0.56,
      ease: "linear",
    },
    {
      t: 0.5,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -87,
        thighL: 192, shinL: 16, footL: -86,
        upperArmR: 184, forearmR: 2,
        upperArmL: 356, forearmL: -6,
      }),
      offsetY: 0.62,
      ease: "linear",
    },
    {
      t: 0.577,
      pose: P({
        torso: 2,
        thighR: 168, shinR: 18, footR: -86,
        thighL: 194, shinL: 18, footL: -85,
        upperArmR: 274, forearmR: 2,
        upperArmL: 86, forearmL: -6,
      }),
      offsetY: 0.64,
      ease: "linear",
    },
    {
      t: 0.66,
      pose: P({
        torso: 4,
        thighR: 164, shinR: 24, footR: -86,
        thighL: 196, shinL: 22, footL: -84,
        upperArmR: 4, forearmR: 4,
        upperArmL: 174, forearmL: -8,
      }),
      offsetY: 0.54,
    },
    {
      t: 0.78,
      pose: P({
        torso: 6, head: -4,
        thighR: 156, shinR: 34, footR: -84,
        thighL: 202, shinL: 30, footL: -82,
        upperArmR: 96, forearmR: 6,
        upperArmL: 248, forearmL: -20,
      }),
      offsetY: 0.32,
    },
    {
      t: 0.9,
      pose: P({
        torso: 8, head: -6,
        thighR: 150, shinR: 44, footR: -82,
        thighL: 206, shinL: 38, footL: -80,
        upperArmR: 144, forearmR: 8,
        upperArmL: 218, forearmL: -28,
      }),
      offsetY: 0.12,
    },
    standKey,
  ],
};

/**
 * Link, Remote Bomb: the Sheikah Slate held out, a bomb materialising in the
 * off hand and dropped forward.
 *
 * No hitbox, so clip time is `frame / 39`; the bomb exists from frame 17, which
 * is t ≈ 0.436. This is the one special that must not look like a throw — in
 * Ultimate the bomb is *made*, not launched, and detonating it is a separate
 * input entirely.
 */
const downBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -6,
        thighR: 156, shinR: 26, footR: -86,
        thighL: 202, shinL: 24, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 150, forearmL: -62,
      }),
      ease: "in",
    },
    {
      t: 0.25,
      pose: P({
        torso: 4, head: -2,
        thighR: 154, shinR: 26, footR: -86,
        thighL: 204, shinL: 24, footL: -84,
        upperArmR: 182, forearmR: 10,
        upperArmL: 100, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.436,
      pose: P({
        torso: 12, head: -8,
        thighR: 150, shinR: 26, footR: -86,
        thighL: 210, shinL: 24, footL: -82,
        upperArmR: 186, forearmR: 10,
        upperArmL: 84, forearmL: -18,
      }),
      offsetX: 0.25,
      scaleX: 1.04,
      ease: "out",
    },
    {
      t: 0.6,
      pose: P({
        torso: 6, head: -4,
        thighR: 152, shinR: 26, footR: -86,
        thighL: 206, shinL: 24, footL: -83,
        upperArmR: 180, forearmR: 10,
        upperArmL: 108, forearmL: 4,
      }),
      offsetX: 0.12,
    },
    {
      t: 0.8,
      pose: P({
        torso: 4,
        thighR: 154, shinR: 24, footR: -86,
        thighL: 204, shinL: 22, footL: -84,
        upperArmR: 170, forearmR: 8,
        upperArmL: 150, forearmL: -20,
      }),
    },
    standKey,
  ],
};

/**
 * Link, grab: reaches out with one hand — the left, because the right is
 * holding a sword and a two-armed lunge with the Master Sword in it is a stab,
 * not a grab.
 *
 * The terminator keeps the arm out rather than returning to guard: this clip is
 * also the `grabHold` and `pummel` pose, so whatever it converges towards is
 * what a fighter holding an opponent stands in.
 */
const grabClip: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 202, shinL: 20, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 150, forearmL: -40,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: 12, head: -8,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 212, shinL: 22, footL: -80,
        upperArmR: 205, forearmR: 6,
        upperArmL: 86, forearmL: 0,
      }),
      offsetX: 0.4,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.45,
      pose: P({
        torso: 8, head: -4,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 208, shinL: 22, footL: -82,
        upperArmR: 198, forearmR: 8,
        upperArmL: 94, forearmL: -4,
      }),
      offsetX: 0.2,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 190, forearmR: 8, upperArmL: 100, forearmL: -8 }) },
  ],
};

/** Link, forward throw: a front kick. The sword never enters it. */
const fthrowClip: PoseClip = {
  loop: false,
  strike: 0.35,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 184, forearmR: 10,
        upperArmL: 110, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.35,
      pose: P({
        torso: -12, head: 12, hip: 6,
        thighR: 96, shinR: -10, footR: 18,
        thighL: 196, shinL: 16, footL: -80,
        upperArmR: 200, forearmR: 12,
        upperArmL: 96, forearmL: -20,
      }),
      offsetX: 0.3,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: -4, head: 6,
        thighR: 124, shinR: 16, footR: -30,
        thighL: 198, shinL: 18, footL: -80,
        upperArmR: 192, forearmR: 10,
        upperArmL: 118, forearmL: -14,
      }),
      offsetX: 0.16,
    },
    standKey,
  ],
};

/** Link, back throw: a side kick, delivered behind him. */
const bthrowClip: PoseClip = {
  loop: false,
  strike: 0.37,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 180, forearmR: 10,
        upperArmL: 116, forearmL: -44,
      }),
      ease: "in",
    },
    {
      t: 0.37,
      pose: P({
        torso: 28, head: -22, hip: 8,
        thighR: 268, shinR: -8, footR: -26,
        thighL: 176, shinL: 34, footL: -78,
        upperArmR: 148, forearmR: -20,
        upperArmL: 132, forearmL: -30,
      }),
      offsetX: -0.4,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.55,
      pose: P({
        torso: 18, head: -14,
        thighR: 232, shinR: 18, footR: -56,
        thighL: 188, shinL: 28, footL: -80,
        upperArmR: 166, forearmR: -8,
        upperArmL: 150, forearmL: -26,
      }),
      offsetX: -0.18,
    },
    standKey,
  ],
};

/** Link, up throw: raises the opponent overhead, then slashes them upward. */
const uthrowClip: PoseClip = {
  loop: false,
  strike: 0.5,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 210, forearmR: 12,
        upperArmL: 120, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: -6, head: 6,
        thighR: 160, shinR: 20, footR: -86,
        thighL: 198, shinL: 18, footL: -84,
        upperArmR: 250, forearmR: 20,
        upperArmL: 20, forearmL: -10,
      }),
      offsetY: 0.12,
      ease: "in",
    },
    {
      t: 0.5,
      pose: P({
        torso: -8, head: 10,
        thighR: 168, shinR: 12, footR: -88,
        thighL: 192, shinL: 12, footL: -86,
        upperArmR: 8, forearmR: -4,
        upperArmL: 350, forearmL: 4,
      }),
      offsetY: 0.35,
      scaleY: 1.12,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.66,
      pose: P({
        torso: 0, head: 4,
        thighR: 162, shinR: 18, footR: -86,
        thighL: 196, shinL: 16, footL: -85,
        upperArmR: 80, forearmR: 6,
        upperArmL: 306, forearmL: -10,
      }),
      offsetY: 0.12,
    },
    standKey,
  ],
};

/** Link, down throw: pins the opponent, hops, and drops an elbow on them. */
const dthrowClip: PoseClip = {
  loop: false,
  strike: 0.48,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 8,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 128, forearmL: -46,
      }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -4, head: 4,
        thighR: 120, shinR: 90, footR: -66,
        thighL: 130, shinL: 86, footL: -64,
        upperArmR: 320, forearmR: 96,
        upperArmL: 150, forearmL: -60,
      }),
      offsetY: 0.8,
      ease: "in",
    },
    {
      t: 0.48,
      pose: P({
        torso: 34, head: -26, hip: -10,
        thighR: 128, shinR: 96, footR: -74,
        thighL: 138, shinL: 92, footL: -72,
        upperArmR: 150, forearmR: -88,
        upperArmL: 168, forearmL: -30,
      }),
      offsetY: -1.9,
      scaleX: 1.1,
      scaleY: 0.88,
      ease: "out",
    },
    {
      t: 0.62,
      pose: P({
        torso: 26, head: -18,
        thighR: 132, shinR: 92, footR: -76,
        thighL: 142, shinL: 88, footL: -74,
        upperArmR: 164, forearmR: -60,
        upperArmL: 176, forearmL: -22,
      }),
      offsetY: -1.7,
    },
    { t: 1, pose: P({ torso: 14, thighR: 146, shinR: 62, thighL: 152, shinL: 58, upperArmR: 172, forearmR: 8 }), offsetY: -1.0 },
  ],
};

export const poses: Partial<Record<PoseName, PoseClip>> = {
  idle: idleClip,
  jab: jabClip,
  ftilt: ftiltClip,
  utilt: utiltClip,
  dtilt: dtiltClip,
  dashAttack: dashAttackClip,
  fsmash: fsmashClip,
  usmash: usmashClip,
  dsmash: dsmashClip,
  nair: nairClip,
  fair: fairClip,
  bair: bairClip,
  uair: uairClip,
  dair: dairClip,
  neutralB: neutralBClip,
  sideB: sideBClip,
  upB: upBClip,
  downB: downBClip,
  grab: grabClip,
  fthrow: fthrowClip,
  bthrow: bthrowClip,
  uthrow: uthrowClip,
  dthrow: dthrowClip,
};
