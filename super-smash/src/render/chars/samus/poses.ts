/**
 * Samus: the clips that are Samus’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB` for
 * the whole roster, which is the right default — fifty clips across eight rigs
 * instead of four hundred hand-authored ones — and the wrong answer for any move
 * whose *shape* is the character. For Samus that is almost the entire moveset,
 * because almost the entire moveset is the arm cannon, and the shared clips are
 * written for a fighter with two fists.
 *
 * What the moves actually are, per SmashWiki’s move list — this is the source
 * every clip below was authored against, and it disagrees with the shared
 * library nearly everywhere:
 *
 * | slot | the real motion |
 * |---|---|
 * | jab | a **left-handed** jab, then a forearm club with the cannon |
 * | ftilt | a roundhouse **kick** (shared clip: an arm thrust) |
 * | utilt | an **axe kick** (shared: an arm raise) |
 * | dtilt | kneels and thrusts the **cannon** down to fire a blast |
 * | dashAttack | a **shoulder tackle**, the Shinespark |
 * | fsmash | thrusts the **cannon** forward and fires |
 * | usmash | **five blasts in an overhead arc** |
 * | dsmash | a low spinning **legsweep**, front then back |
 * | nair | a **spinning** roundhouse kick |
 * | fair | five blasts in a slow **downward** arc |
 * | bair | a back kick |
 * | uair | a diagonal **corkscrew** flying kick |
 * | dair | swings the **cannon** down in an arc — not a stomp |
 * | neutralB | charges a ball of energy in the cannon and fires it |
 * | sideB | fires a missile from the cannon |
 * | upB | leaps into a rising **somersault** discharging energy |
 * | downB | rolls into **Morph Ball** and drops a bomb |
 * | grab | fires the **Grapple Beam** — a tether, not a hand |
 * | uthrow | hoists them up and fires **point blank** |
 *
 * ## Timing: read this before moving a key
 *
 * `poseTimeFor` only remaps a clip onto its contact frame when the move has a
 * **hitbox**. Charge Shot, Missile and Bomb have none — their whole output is a
 * projectile — so for those three `strike` is inert and clip time is exactly
 * `actionFrame / totalFrames`. Their keys are therefore placed at hand-computed
 * fractions and the `strike` value is documentation, not machinery. Every other
 * clip here is anchored properly and only has to be the right *shape*.
 *
 * The other timing fact that decides a whole clip: **while Charge Shot is being
 * charged the engine pins `actionFrame` to 1**, so `neutralB` is sampled at
 * t ≈ 0.023 for as long as the button is held. Its `t = 0` key is not a wind-up,
 * it is the charge stance, and it is the pose players will spend more time
 * looking at than any other frame she has.
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/**
 * The cannon levelled forward.
 *
 * Written once because eight of these clips end up here and the value has to be
 * the same in all of them: an arm at 90° points straight forward, and the
 * cannon prop runs along the forearm, so `upperArmR ≈ 88` with the forearm a
 * few degrees under puts the muzzle level with her chest and pointing at the
 * opponent. Two degrees of drift between moves is the difference between a
 * weapon and a limb that happens to be out.
 */
const CANNON_LEVEL = { upperArmR: 88, forearmR: -4 } as const;

export const poses: Partial<Record<PoseName, PoseClip>> = {
  /* --------------------------------------------------------------- stand -- */

  /**
   * The standing loop.
   *
   * ## Why she needs her own
   *
   * The shared `idle` hangs both arms straight down, and on every other fighter
   * that is a pair of arms. On Samus the near one carries a prop 4.2 rig units
   * across — nearly her torso's width — mounted **perpendicular to the bone**,
   * so an arm pointing at the floor turns the Arm Cannon into a horizontal slab
   * lying across her hips with its gunmetal muzzle collar as the only part that
   * has a colour of its own. A contact sheet of it is a dark bar across an
   * orange lozenge: the most identifying prop on the roster, drawn as a belt.
   * This is the pose a player looks at more than any other, and it was the
   * single worst frame she had.
   *
   * ## What fixes it
   *
   * Bend the elbow and bring the cannon **out in front of her hip**. The barrel
   * then runs forward and down instead of across, the muzzle and the bore are
   * clear of her silhouette against the background rather than buried in it, and
   * the shape says *weapon held at the ready*, which is also what SmashWiki
   * describes: she stands at an angle with the Arm Cannon carried a little lower
   * than in the earlier games. The elbow stays low and tucked — a cannon raised
   * to chest height is `fsmash`'s wind-up, not a stand, and a fighter who idles
   * in her own aiming pose has nowhere to go when she aims.
   *
   * ## The numbers, and where they come from
   *
   * A reference pass over the game's own idle GIFs frame by frame gives four
   * things this clip is built to, and only the first was guessable:
   *
   *  - the **elbow is bent to about 110°** and the cannon runs down and forward
   *    at **25–35° under the horizontal**, with the muzzle ending up over the
   *    leading thigh at hip height. Not level, not at her side.
   *  - the **torso is pitched 15–20° forward** of vertical with **both knees
   *    visibly bent** — a low athletic ready stance, not a parade rest. The
   *    shared clip's five degrees is a person queueing.
   *  - the **free hand is in front of the abdomen**, just above and behind the
   *    barrel, rather than hanging at her side. Two of her three idle flourishes
   *    are "traces her fingertips over her arm cannon" and "drops her arm cannon
   *    for a moment", and both start from a hand that is already there.
   *  - the **head is all but locked**. The whole body's bob measures about 1% of
   *    her height, and none of it is the helmet.
   *
   * The legs are also staggered far wider than the shared clip's two degrees: at
   * her proportions two legs a degree apart are one leg, and a fighter with one
   * leg reads as a fighter standing on a pole. The shins straighten back under
   * her so that both ankles stay within a tenth of a unit of the floor while the
   * thighs carry the stagger.
   *
   * ## The breath
   *
   * Four keys and the shared clip's cadence, kept deliberately: a 37-frame
   * inhale eased `smooth` against a 71-frame exhale drifting `linear` through
   * three unequal beats, so nothing in the body turns round at the same instant
   * as anything else and the cycle has no countable beat. What is Samus's is
   * what the cannon does over it — the arm carries a gun the size of her torso,
   * so the muzzle **lags the chest and sinks further than it rises**, drifting a
   * five degrees and arriving late. A weapon that breathes in time with the
   * ribs is a weapon that weighs nothing.
   *
   * The *lift* is deliberately smaller than the shared clip's. Measured off a
   * match-scale capture, the shared amplitudes moved her whole silhouette by
   * about seven percent of her height with every part of her arriving together,
   * which reads as one drawing on a lift rather than as a body breathing. Half
   * the translation and twice the swing in the arms is the same amount of life
   * spent where an eye can see it articulate.
   */
  idle: {
    loop: true,
    period: 108,
    keys: [
      {
        // The settle at the end of the exhale: chest low, cannon at the bottom
        // of its drift.
        t: 0,
        pose: P({
          hip: 1.0, torso: 13.0, head: -11.0,
          thighR: 163, shinR: 26, thighL: 195, shinL: -5,
          // Elbow at ~110°, forearm forward and 30° under the horizontal, so the
          // barrel clears the torso and the bore sits over the leading thigh.
          upperArmR: 171, forearmR: -60,
          // The free hand in front of the abdomen, hovering above the barrel.
          upperArmL: 168, forearmL: -62,
        }),
        offsetY: 0.02,
        scaleY: 1.0,
      },
      {
        // Top of the inhale. The chest is at its highest here and the cannon is
        // still on its way up — it arrives at key 2.
        t: 0.34,
        pose: P({
          hip: 0.2, torso: 11.4, head: -10.2,
          thighR: 162.4, shinR: 27.5, thighL: 195.6, shinL: -6.5,
          upperArmR: 168.4, forearmR: -63.4,
          upperArmL: 165.2, forearmL: -66.0,
        }),
        offsetY: 0.06,
        scaleY: 1.012,
        ease: "linear",
      },
      {
        // The head and the cannon both arrive late, a quarter cycle behind the
        // chest, which is already on its way back down.
        t: 0.58,
        pose: P({
          hip: -0.6, torso: 12.4, head: -12.4,
          thighR: 164, shinR: 24.5, thighL: 194.2, shinL: -3.5,
          upperArmR: 166.6, forearmR: -64.6,
          upperArmL: 162.4, forearmL: -64.4,
        }),
        offsetY: 0.035,
        scaleY: 1.006,
        ease: "linear",
      },
      {
        // Lowest point of the cycle, a hair under key 0, and the muzzle at the
        // bottom of its sink — the recovery into the settle is the last span.
        t: 0.8,
        pose: P({
          hip: 0.4, torso: 13.4, head: -11.4,
          thighR: 163.3, shinR: 25.4, thighL: 195.2, shinL: -4.4,
          upperArmR: 173.6, forearmR: -56.4,
          upperArmL: 170.4, forearmL: -58.4,
        }),
        offsetY: 0.0,
        scaleY: 0.997,
        ease: "linear",
      },
    ],
  },

  /* ------------------------------------------------------------ specials -- */

  /**
   * Charge Shot.
   *
   * `t = 0` is the **charge stance** and is held for up to 125 real frames, so
   * it is authored as a finished pose rather than as anticipation. The span
   * leaving it eases `in`, which means the shot is still 96% of this shape at
   * the t ≈ 0.023 the charge parks on — the stance does not creep while it is
   * held.
   *
   * ## What the stance is, and what it is not
   *
   * It was upright, weight sat back over the rear leg, with a note saying a
   * coiled version would read as flinching. Frame-stepping the game's own
   * footage says the opposite in every particular: she drops into a **deep,
   * wide, forward-braced lunge and holds it there**. The hips come down to
   * roughly knee height, the rear leg is extended a long way back and nearly
   * straight, the front knee is bent to about 110°, the torso is pitched hard
   * forward over the front leg, the chin is tucked and the visor is sighting
   * along the barrel. The cannon is out level with the elbow all but locked,
   * and the free arm is **not** braced across the chest — it is tucked back and
   * down against her hip. She does not rock; all the motion is in the ball.
   *
   * The lunge is not flinching, it is bracing, and it is the difference between
   * a fighter charging a gun and a fighter waiting for a bus. It also earns
   * something the upright version could not: the muzzle ends up at roughly
   * (7, 6.6) rig units, which is where `fighters/samus.ts` spawns the plasma
   * from — an upright stance held the barrel a unit and a half above its own
   * projectile.
   *
   * The shot itself has to land at t ≈ 0.07 because the plasma leaves on move
   * frame 3 of 44 and there is no hitbox for `strike` to anchor to. The whole
   * remaining 93% of the clip is recovery, which is why the recoil is spent
   * over three keys instead of snapping back: thirty-eight frames of a single
   * ease reads as a freeze.
   */
  neutralB: {
    loop: false,
    strike: 0.07,
    keys: [
      {
        t: 0,
        pose: P({
          // Pitched hard forward over the front leg, chin tucked, sighting
          // along the barrel.
          torso: 26, head: -22, hip: 4,
          // Front knee bent to about 110°, hips down to knee height.
          thighR: 122, shinR: 98, footR: -74,
          // Rear leg driven a long way back and close to straight, on the toe.
          // 45° rather than the 64° a human lunge would use: her legs are 4.1
          // units on a 12.2-unit body, so a leg thrown that far back cannot
          // also reach the floor, and the toe ends up hanging a unit in the air.
          thighL: 221, shinL: -12, footL: -96,
          // The cannon level and the elbow nearly locked. Bone angles
          // accumulate, so with the torso 30° over these come out at a forearm
          // pointing along the firing line rather than down it.
          upperArmR: 68, forearmR: -6,
          // Tucked back and down against her hip — not across the chest.
          upperArmL: 186, forearmL: -46,
        }),
        offsetX: 0.35,
        // Repaid against the fold: with the legs bent this far the ankles ride
        // half a unit clear of the floor, so half a unit is exactly what the
        // body may sink before her boots leave the stage.
        offsetY: -0.5,
        ease: "in",
      },
      {
        // The shot. The cannon kicks *up* (a smaller arm angle is higher) and
        // the whole body is shoved backwards along the ground — she stays down
        // in the lunge through it, which is what the recoil looks like: the
        // shove is in the feet, not in the spine.
        t: 0.07,
        pose: P({
          torso: 20, head: -16, hip: 8,
          thighR: 128, shinR: 92, footR: -72,
          thighL: 218, shinL: -10, footL: -94,
          upperArmR: 50, forearmR: 2,
          upperArmL: 176, forearmL: -52,
        }),
        offsetX: -0.55,
        offsetY: -0.56,
        scaleX: 0.94,
        // Crawl, not `out`, because the next key is the same shape: the brace
        // has to still be a brace while the plasma is leaving. See below.
        ease: "linear",
      },
      {
        /**
         * The brace, held.
         *
         * The plasma leaves on move frame 3 and the muzzle flash runs to frame
         * 9 — t = 0.068 to 0.205 on this clip, since Charge Shot has no hitbox
         * for `strike` to anchor and clip time is exactly `frame / 44`. A
         * cubic `out` off the recoil key is 70% recovered by frame 5, so she
         * was straightening up while her own shot was still in the barrel.
         * This key is the recoil pose again at frame 7, and it is the whole
         * difference between a recoil and a twitch.
         */
        t: 0.16,
        pose: P({
          torso: 19, head: -15, hip: 8,
          thighR: 129, shinR: 90, footR: -72,
          thighL: 217, shinL: -9, footL: -94,
          upperArmR: 48, forearmR: 3,
          upperArmL: 174, forearmL: -52,
        }),
        offsetX: -0.6,
        offsetY: -0.55,
        scaleX: 0.95,
        ease: "out",
      },
      {
        // Coming up out of the lunge with the cannon still riding high — the
        // barrel keeps climbing to about 50° above the horizontal before it
        // comes down, which is the follow-through the real recoil has.
        t: 0.28,
        pose: P({
          torso: 10, head: -8, hip: 4,
          thighR: 138, shinR: 62, footR: -78,
          thighL: 212, shinL: 6, footL: -88,
          upperArmR: 38, forearmR: 4,
          upperArmL: 160, forearmL: -56,
        }),
        offsetX: -0.4,
        offsetY: -0.3,
      },
      {
        t: 0.55,
        pose: P({
          torso: 0, head: 0,
          upperArmR: 108, forearmR: -14,
          upperArmL: 168, forearmL: -40,
        }),
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 140, forearmR: -22, upperArmL: 186, forearmL: -28 }) },
    ],
  },

  /**
   * Missile.
   *
   * Also hitbox-less, so the launch key is placed by hand at 18/54 ≈ 0.33. The
   * shape that distinguishes it from Charge Shot is the **cross-body draw**:
   * the cannon comes in across her chest and is pushed out along the firing
   * line rather than simply being raised, which is what makes the launch read
   * as a launch and not as a second poke.
   */
  sideB: {
    loop: false,
    strike: 0.33,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 10, head: -8, hip: -4,
          thighR: 150, shinR: 44, footR: -82,
          thighL: 204, shinL: 38, footL: -80,
          // Drawn in tight across the chest — the elbow is the wind-up here.
          upperArmR: 126, forearmR: -76,
          upperArmL: 152, forearmL: -50,
        }),
        offsetY: -0.5,
        ease: "in",
      },
      {
        t: 0.33,
        pose: P({
          torso: 6, head: -4, hip: -2,
          thighR: 142, shinR: 28, footR: -86,
          thighL: 214, shinL: 26, footL: -78,
          ...CANNON_LEVEL,
          upperArmL: 196, forearmL: -54,
        }),
        offsetX: 0.5,
        offsetY: -0.1,
        scaleX: 1.06,
        ease: "linear",
      },
      {
        // The launch, held. The missile is generated on frame 18 and the
        // exhaust hangs at the muzzle to frame 24; 0.40 is frame 21.6, so the
        // cannon is still out along the firing line while its own smoke is.
        t: 0.4,
        pose: P({
          torso: 4, head: -3, hip: -1,
          thighR: 143, shinR: 28, footR: -86,
          thighL: 213, shinL: 26, footL: -78,
          upperArmR: 86, forearmR: -2,
          upperArmL: 194, forearmL: -54,
        }),
        offsetX: 0.42,
        offsetY: -0.08,
        scaleX: 1.04,
        ease: "out",
      },
      {
        // The kick back off the launch rail.
        t: 0.5,
        pose: P({
          torso: -8, head: 8,
          thighR: 148, shinR: 30, footR: -84,
          upperArmR: 78, forearmR: 4,
          upperArmL: 186, forearmL: -46,
        }),
        offsetX: -0.15,
      },
      {
        t: 0.62,
        pose: P({ torso: 0, upperArmR: 96, forearmR: -6, upperArmL: 180, forearmL: -40 }),
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 138, forearmR: -24, upperArmL: 188, forearmL: -30 }) },
    ],
  },

  /**
   * Screw Attack.
   *
   * ## Why this does not use `spin`
   *
   * It did, and `spin: 4` is what put a fighter on her side in the middle of
   * her own recovery move. `spin` is a **screen-plane** rotation integrated
   * linearly over clip time: it cartwheels the rig head over heels, it cannot
   * stop when the hits do, and because clip time never reaches 1 it leaves her
   * at an arbitrary angle for the whole fall — measured here, frame 39 came out
   * at 2.9 turns, which is a splayed fighter lying at 38° with her legs open.
   *
   * Screw Attack is not a somersault. It is a corkscrew about her **long axis**,
   * and a rig with no depth cannot rotate about that axis at all. What flat
   * animation has always done instead, and what this does, is sell the turn by
   * **width**: `scaleX` collapses to a third as she goes edge-on and opens back
   * out as she comes round, four half-turns across the drilling frames, with
   * the two arms swapping sides at each half-turn so the cannon crosses her
   * body every time she comes back face-on. `linear` throughout — a corkscrew
   * runs at constant rate, and easing each half-turn makes it stutter.
   *
   * The half-turns are placed on the multihit's own frames (7, 11½, 16, 20½,
   * 25) rather than on round numbers, so the widest frames are hit frames.
   *
   * Everything underneath that is **stay tucked**. A spinning figure with limbs
   * out is a ragdoll; a spinning figure balled up is a drill, and the drill is
   * what the energy rings are wrapped around.
   */
  upB: {
    loop: false,
    strike: 0.14,
    keys: [
      {
        // Crouch and load. Three frames of it, so it snaps rather than eases.
        t: 0,
        pose: P({
          torso: 20, head: -18, hip: -8,
          thighR: 134, shinR: 88, footR: -76,
          thighL: 142, shinL: 84, footL: -74,
          upperArmR: 150, forearmR: -50,
          upperArmL: 214, forearmL: -50,
        }),
        offsetY: -1.6,
        ease: "in",
      },
      {
        // Frame 3, the launcher hit. Knees to the chest and the cannon crossed
        // in front: the tightest silhouette the rig can make, and the one a
        // helix reads around.
        t: 0.14,
        pose: P({
          torso: 4, head: -2,
          thighR: 122, shinR: 96, footR: -66,
          thighL: 130, shinL: 92, footL: -64,
          upperArmR: 132, forearmR: -88,
          upperArmL: 226, forearmL: -84,
        }),
        offsetY: 0.9,
        scaleX: 1.04,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 7 — the multihit opens. Face-on, arms as they started.
        t: 0.205,
        pose: P({
          torso: 3, head: -1,
          thighR: 122, shinR: 96, footR: -66,
          thighL: 130, shinL: 92, footL: -64,
          upperArmR: 130, forearmR: -88,
          upperArmL: 228, forearmL: -84,
        }),
        offsetY: 1.0,
        scaleX: 1.06,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 11½ — edge-on. Everything folded onto the centreline, because
        // at a third of her width there is nothing to see but the rings.
        t: 0.278,
        pose: P({
          torso: 0, head: 0,
          thighR: 172, shinR: 94, footR: -64,
          thighL: 176, shinL: 94, footL: -64,
          upperArmR: 178, forearmR: -86,
          upperArmL: 182, forearmL: -86,
        }),
        offsetY: 1.05,
        scaleX: 0.32,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 16 — face-on again, and round the other way: the cannon is now
        // the far arm. This swap is the half-turn.
        t: 0.351,
        pose: P({
          torso: -3, head: 1,
          thighR: 130, shinR: 92, footR: -64,
          thighL: 122, shinL: 96, footL: -66,
          upperArmR: 228, forearmR: -84,
          upperArmL: 130, forearmL: -88,
        }),
        offsetY: 1.0,
        scaleX: 1.06,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 20½ — edge-on.
        t: 0.424,
        pose: P({
          torso: 0, head: 0,
          thighR: 176, shinR: 94, footR: -64,
          thighL: 172, shinL: 94, footL: -64,
          upperArmR: 182, forearmR: -86,
          upperArmL: 178, forearmL: -86,
        }),
        offsetY: 0.95,
        scaleX: 0.32,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 25, the launcher hit that ends it: face-on, arms back where
        // they began, and the drill stops here rather than carrying an
        // arbitrary angle into the fall.
        t: 0.497,
        pose: P({
          torso: 2, head: 0,
          thighR: 124, shinR: 92, footR: -68,
          thighL: 132, shinL: 90, footL: -66,
          upperArmR: 134, forearmR: -86,
          upperArmL: 224, forearmL: -82,
        }),
        offsetY: 0.85,
        scaleX: 1.04,
        scaleY: 0.96,
        ease: "out",
      },
      {
        // Unfurling out of the last hit, into the fall.
        t: 0.66,
        pose: P({
          torso: -6, head: 6,
          thighR: 158, shinR: 44, footR: -78,
          thighL: 198, shinL: 40, footL: -78,
          upperArmR: 60, forearmR: 18,
          upperArmL: 300, forearmL: -18,
        }),
        offsetY: 0.35,
      },
      { t: 1, pose: P({ torso: -2, thighR: 166, shinR: 26, thighL: 196, shinL: 24, upperArmR: 52, upperArmL: 308 }) },
    ],
  },

  /**
   * Bomb.
   *
   * The Morph Ball itself is painted by `fx.ts`, which hides the figure for the
   * frames the ball is out — a humanoid rig folded up is not a sphere and no
   * amount of folding will make it one. What the clip owns is the *transition*
   * either side, and that is the part that sells it: she has to visibly collapse
   * into the ball and visibly come back out of it, or the ball is a cutaway.
   *
   * Both curl keys are `hold`. The ball has to exist as a fixed shape for a run
   * of frames rather than be travelled through, and an eased curl spends its
   * frames halfway between a woman and a sphere, which is the one thing it must
   * never look like.
   */
  downB: {
    loop: false,
    strike: 0.23,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 16, head: -14,
          thighR: 148, shinR: 56, footR: -84,
          thighL: 202, shinL: 52, footL: -82,
          upperArmR: 150, forearmR: -40,
          upperArmL: 212, forearmL: -40,
        }),
        ease: "in",
      },
      {
        // Collapsed: knees to the chin, arms wrapped, the body scaled down to
        // roughly the ball's diameter so the hand-off to the painted sphere is
        // not a jump in size.
        t: 0.09,
        pose: P({
          torso: 40, head: -34, hip: -14,
          thighR: 112, shinR: 128, footR: -60,
          thighL: 118, shinL: 124, footL: -58,
          upperArmR: 128, forearmR: -120,
          upperArmL: 232, forearmL: -118,
        }),
        offsetY: -3.4,
        scaleX: 1.1,
        scaleY: 0.72,
        ease: "hold",
      },
      {
        t: 0.58,
        pose: P({
          torso: 40, head: -34, hip: -14,
          thighR: 112, shinR: 128, footR: -60,
          thighL: 118, shinL: 124, footL: -58,
          upperArmR: 128, forearmR: -120,
          upperArmL: 232, forearmL: -118,
        }),
        offsetY: -3.4,
        scaleX: 1.1,
        scaleY: 0.72,
        ease: "out",
      },
      {
        t: 0.78,
        pose: P({
          torso: 22, head: -18, hip: -6,
          thighR: 138, shinR: 78, footR: -80,
          thighL: 148, shinL: 74, footL: -78,
          upperArmR: 146, forearmR: -54,
          upperArmL: 216, forearmL: -52,
        }),
        offsetY: -1.5,
      },
      { t: 1, pose: P({ torso: 8, thighR: 158, shinR: 34, thighL: 200, shinL: 30 }), offsetY: -0.3 },
    ],
  },

  /* -------------------------------------------------------------- smashes -- */

  /**
   * Forward smash: the cannon thrust.
   *
   * A charging smash parks at `strike * 0.55`, so the wind-up key has to be
   * legible as a *held* pose too — this is the shape a player stares at while
   * deciding whether to shield. The cannon is drawn back past her hip and the
   * whole body is wound away from the target, which is both the real animation
   * and the only wind-up that leaves anywhere for a thrust to travel.
   */
  fsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -24, head: 18, hip: 10,
          thighR: 166, shinR: 36, footR: -84,
          thighL: 208, shinL: 32, footL: -76,
          // Cannon cocked back beside the hip, muzzle still pointing forward.
          upperArmR: 186, forearmR: -84,
          upperArmL: 150, forearmL: -40,
        }),
        offsetX: -0.55,
        offsetY: -0.35,
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          torso: 18, head: -12, hip: -4,
          thighR: 132, shinR: 24, footR: -90,
          thighL: 224, shinL: 28, footL: -70,
          ...CANNON_LEVEL,
          upperArmL: 228, forearmL: -60,
        }),
        offsetX: 1.05,
        offsetY: -0.45,
        scaleX: 1.16,
        ease: "linear",
      },
      {
        // Frame 11 — the second and last frame the muzzle hitbox is live.
        // Without this key the cubic `out` off the strike has her a third of
        // the way home on the frame she is still hitting people on.
        t: 0.318,
        pose: P({
          torso: 17, head: -11, hip: -4,
          thighR: 133, shinR: 24, footR: -90,
          thighL: 223, shinL: 28, footL: -70,
          upperArmR: 87, forearmR: -3,
          upperArmL: 227, forearmL: -60,
        }),
        offsetX: 1.02,
        offsetY: -0.45,
        scaleX: 1.15,
        ease: "out",
      },
      {
        // The cannon stays out while the body unwinds under it — that is what
        // a recoiling gun does, and it is also what tells the opponent the
        // move is over.
        t: 0.44,
        pose: P({
          torso: 6, head: -4,
          thighR: 140, shinR: 26, footR: -88,
          thighL: 216, shinL: 28, footL: -74,
          upperArmR: 80, forearmR: 6,
          upperArmL: 214, forearmL: -48,
        }),
        offsetX: 0.6,
        offsetY: -0.35,
      },
      {
        // Two more recovery keys because a smash has thirty-nine frames after
        // contact, and a single ease across all of them is under a degree a
        // frame — which the eye reads as the game having stopped.
        t: 0.62,
        pose: P({
          torso: 0, head: 0,
          thighR: 148, shinR: 28, footR: -86,
          thighL: 208, shinL: 28, footL: -78,
          upperArmR: 96, forearmR: 0,
          upperArmL: 204, forearmL: -44,
        }),
        offsetX: 0.3,
        offsetY: -0.2,
      },
      {
        t: 0.82,
        pose: P({ torso: 4, upperArmR: 114, forearmR: -14, upperArmL: 200, forearmL: -40 }),
        offsetX: 0.1,
      },
      { t: 1, pose: P({ torso: 6, upperArmR: 128, forearmR: -26, upperArmL: 198, forearmL: -38 }), offsetY: -0.25 },
    ],
  },

  /**
   * Up smash: five blasts in an overhead arc.
   *
   * The move is not a jump and not a Screw Attack — she plants, brings the
   * cannon up in front of her and **sweeps it back over her head**, firing all
   * the way. So the clip is a single continuous arc of one arm, and the five
   * hits between frames 11 and 28 are spread along it rather than stacked on
   * one key. `fx.ts` puts the blasts on the arc; the pose has to put the arc
   * somewhere they can sit.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 22, head: -18, hip: -8,
          thighR: 138, shinR: 76, footR: -82,
          thighL: 146, shinL: 72, footL: -80,
          // Cannon low and forward, at the bottom of the arc.
          upperArmR: 128, forearmR: -22,
          upperArmL: 206, forearmL: -46,
        }),
        offsetY: -1.5,
        ease: "in",
      },
      {
        // First blast: cannon up and forward, body opening out of the crouch.
        t: 0.3,
        pose: P({
          torso: 4, head: -4,
          thighR: 158, shinR: 26, footR: -86,
          thighL: 200, shinL: 24, footL: -84,
          upperArmR: 42, forearmR: -10,
          upperArmL: 322, forearmL: 14,
        }),
        offsetY: 0.15,
        scaleY: 1.08,
        // `linear` for the rest of the arc. This is a sweep, not a strike: the
        // five blasts are spread along it and the arm has to travel between
        // them at a constant rate, which is what puts each blast on a *moving*
        // cannon rather than on a cannon that has already arrived.
        ease: "linear",
      },
      {
        // Overhead, the middle of the sweep — frame 19, the third blast.
        // `poseTimeFor` maps frame 19 to t = 0.437 on this move, and the three
        // arc keys are placed on the blast frames rather than on round numbers
        // so the graphic and the pose are never in different places. Before
        // this the arm reached the back of the arc on frame 35, eight frames
        // after the last shot had already been fired.
        t: 0.437,
        pose: P({
          torso: -6, head: 8,
          thighR: 166, shinR: 16, footR: -88,
          thighL: 196, shinL: 14, footL: -86,
          upperArmR: 2, forearmR: -4,
          upperArmL: 336, forearmL: 10,
        }),
        offsetY: 0.4,
        scaleY: 1.12,
        scaleX: 0.94,
        ease: "linear",
      },
      {
        // Frame 27, the fifth and last blast: over and slightly behind, the far
        // end of the arc.
        t: 0.559,
        pose: P({
          torso: -14, head: 14,
          thighR: 170, shinR: 14, footR: -88,
          thighL: 194, shinL: 12, footL: -86,
          upperArmR: 330, forearmR: 12,
          upperArmL: 316, forearmL: 8,
        }),
        offsetY: 0.25,
        scaleY: 1.06,
        ease: "out",
      },
      {
        // Twenty-eight frames of recovery, so it needs a shape of its own or
        // the last third of the move is one motionless drawing.
        t: 0.74,
        pose: P({
          torso: -4, head: 6,
          thighR: 162, shinR: 22, footR: -86,
          thighL: 198, shinL: 20, footL: -84,
          upperArmR: 8, forearmR: -6,
          upperArmL: 306, forearmL: 18,
        }),
        offsetY: 0.05,
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 120, forearmR: -34, upperArmL: 240, forearmL: 34 }) },
    ],
  },

  /**
   * Down smash: the spinning legsweep.
   *
   * Front first on frame 9, then **behind** on frame 17, and that is the whole
   * move — it is why the thing is the edgeguarding tool it is. The shared clip
   * is a split kick that hits both sides at once, which loses the sequence. Here
   * the same leg goes forward, the body turns through, and it comes back round
   * behind her; `strike` puts the front sweep on frame 9 and the recovery
   * stretch puts the second key almost exactly on frame 17.
   */
  dsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 18, head: -14,
          thighR: 140, shinR: 78, footR: -80,
          thighL: 148, shinL: 74, footL: -78,
          upperArmR: 140, forearmR: -50,
          upperArmL: 220, forearmL: -50,
        }),
        offsetY: -1.3,
        ease: "in",
      },
      {
        // Front sweep: the leg out low and nearly straight, hip dropped, the
        // body braced on the hands. Wide and flat — a sweep is a horizontal
        // shape and the squash is what says so.
        t: 0.3,
        pose: P({
          torso: 14, head: -10, hip: -8,
          thighR: 110, shinR: -6, footR: -74,
          thighL: 150, shinL: 116, footL: -62,
          upperArmR: 158, forearmR: -30,
          upperArmL: 236, forearmL: -34,
        }),
        offsetY: -2.4,
        offsetX: 0.3,
        scaleX: 1.24,
        scaleY: 0.8,
        ease: "linear",
      },
      {
        // Frame 10, the second and last frame of the front hitbox. Held.
        t: 0.32,
        pose: P({
          torso: 15, head: -11, hip: -8,
          thighR: 112, shinR: -4, footR: -74,
          thighL: 150, shinL: 116, footL: -62,
          upperArmR: 158, forearmR: -30,
          upperArmL: 236, forearmL: -34,
        }),
        offsetY: -2.4,
        offsetX: 0.28,
        scaleX: 1.23,
        scaleY: 0.8,
        ease: "out",
      },
      {
        // Through the turn — the leg passes underneath her.
        t: 0.4,
        pose: P({
          torso: 20, head: -14, hip: -6,
          thighR: 172, shinR: 20, footR: -78,
          thighL: 158, shinL: 108, footL: -64,
          upperArmR: 168, forearmR: -24,
          upperArmL: 228, forearmL: -30,
        }),
        offsetY: -2.5,
        scaleX: 1.08,
        scaleY: 0.82,
      },
      {
        // Back sweep. The second hitbox is live on move frames 17–18, which
        // is t = 0.456 to 0.475 here — not the 0.46 this key used to sit at,
        // which was a frame and a half late and landed between them.
        t: 0.4556,
        pose: P({
          torso: 24, head: -18, hip: -6,
          // 270 is horizontal *behind* her for a leg, and 180 is straight
          // down: 242 is the mirror of the front sweep's 110, which is what
          // makes the two halves read as the same leg going both ways.
          thighR: 242, shinR: -4, footR: -78,
          thighL: 146, shinL: 112, footL: -62,
          upperArmR: 120, forearmR: -20,
          upperArmL: 196, forearmL: -26,
        }),
        offsetY: -2.4,
        offsetX: -0.25,
        scaleX: 1.24,
        scaleY: 0.8,
        ease: "linear",
      },
      {
        // Move frame 18, the back hitbox's last frame. Held, for the same
        // reason the front one is.
        t: 0.475,
        pose: P({
          torso: 24, head: -18, hip: -6,
          thighR: 246, shinR: -2, footR: -78,
          thighL: 146, shinL: 112, footL: -62,
          upperArmR: 122, forearmR: -20,
          upperArmL: 196, forearmL: -26,
        }),
        offsetY: -2.4,
        offsetX: -0.28,
        scaleX: 1.23,
        scaleY: 0.8,
        ease: "out",
      },
      {
        t: 0.64,
        pose: P({
          torso: 18, head: -14,
          thighR: 200, shinR: 44, footR: -78,
          thighL: 150, shinL: 96, footL: -70,
        }),
        offsetY: -2.0,
        scaleX: 1.06,
      },
      { t: 1, pose: P({ torso: 12, thighR: 148, shinR: 68, thighL: 154, shinL: 64 }), offsetY: -1.3 },
    ],
  },

  /* -------------------------------------------------------------- aerials -- */

  /**
   * Neutral air: the spinning roundhouse.
   *
   * **No `spin`, and no held leg either.** A roundhouse rotates about the
   * fighter's *vertical* axis; `spin` rotates about the axis pointing at the
   * camera, which is the only one a side-on rig has, so setting it here tipped
   * her flat onto her back and made the move a fighter lying down and slowly
   * revolving. The first correction — one leg out and level, held for the whole
   * active window — was worse in a different way: fifteen frames of a
   * motionless fighter with a leg out is not a spinning kick, it is a fighter
   * with a leg out, and that is what the contact sheet showed.
   *
   * What carries a turn about the vertical axis in flat animation is **width**.
   * `scaleX` opens to 1.18 when she is face-on and collapses to 0.4 as she goes
   * edge-on; the extended leg is horizontal throughout, so at 0.4 it is a
   * foreshortened stub, which is exactly what a leg pointing at the camera
   * looks like. Meanwhile the leg itself steps round the hip **90° per key** —
   * forward, down, back, up, forward — which is the only way a chain of keys
   * can express more than half a revolution, since `lerpAngle` takes the short
   * way between any pair. The arms swap sides at each half-turn.
   *
   * The steps are placed on the multihit's own frames: 7 (first hitbox), 11,
   * 14½, 18, 21 (last hitbox). `linear` throughout — a spin runs at a constant
   * rate and easing each quarter turn makes it lurch.
   */
  nair: {
    loop: false,
    strike: 0.22,
    keys: [
      {
        t: 0,
        pose: P({ torso: 10, head: -8, thighR: 148, shinR: 62, thighL: 206, shinL: 52 }),
        ease: "in",
      },
      {
        // Frame 7. Face-on, the kicking leg straight out and level in front.
        t: 0.22,
        pose: P({
          torso: 2, head: 0,
          thighR: 96, shinR: -6, footR: -70,
          thighL: 224, shinL: 62, footL: -70,
          upperArmR: 140, forearmR: -66,
          upperArmL: 222, forearmL: -62,
        }),
        scaleX: 1.18,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 11. Edge-on: a quarter turn later the leg reads as pointing at
        // the camera, which is a stub at hip height — a horizontal leg at 40%
        // width. Written as 186° so the chain keeps turning the same way.
        t: 0.302,
        pose: P({
          torso: 0, head: 0,
          thighR: 186, shinR: 4, footR: -78,
          thighL: 196, shinL: 70, footL: -72,
          upperArmR: 180, forearmR: -60,
          upperArmL: 184, forearmL: -60,
        }),
        offsetY: 0.15,
        scaleX: 0.4,
        scaleY: 0.98,
        ease: "linear",
      },
      {
        // Frame 14½. Face-on again and round the other way — the leg is now
        // extended behind her and the arms have swapped sides.
        t: 0.374,
        pose: P({
          torso: -2, head: 2,
          thighR: 276, shinR: -6, footR: -86,
          thighL: 168, shinL: 74, footL: -70,
          upperArmR: 222, forearmR: -62,
          upperArmL: 140, forearmL: -66,
        }),
        scaleX: 1.18,
        scaleY: 0.94,
        ease: "linear",
      },
      {
        // Frame 18. Edge-on, the leg swinging up and over the back.
        t: 0.446,
        pose: P({
          torso: 0, head: 0,
          thighR: 366, shinR: 22, footR: -70,
          thighL: 188, shinL: 68, footL: -72,
          upperArmR: 180, forearmR: -60,
          upperArmL: 184, forearmL: -60,
        }),
        offsetY: 0.15,
        scaleX: 0.4,
        scaleY: 0.98,
        ease: "linear",
      },
      {
        // Frame 21, the last active frame: back to face-on with the leg out in
        // front, a full revolution on from where it started. 456 is 96 plus a
        // turn, and it has to be written that way — 96 would make this key and
        // the first one the same key and unwind the whole spin.
        t: 0.507,
        pose: P({
          torso: 2, head: 0,
          thighR: 456, shinR: -6, footR: -70,
          thighL: 224, shinL: 62, footL: -70,
          upperArmR: 140, forearmR: -66,
          upperArmL: 222, forearmL: -62,
        }),
        scaleX: 1.18,
        scaleY: 0.94,
        ease: "out",
      },
      {
        // Out of it and into the fall. 504 is 144 — the leg keeps turning the
        // way it was going rather than snapping back through the floor.
        t: 0.68,
        pose: P({
          torso: 6, head: -4,
          thighR: 504, shinR: 34, footR: -80,
          thighL: 212, shinL: 44, footL: -76,
          upperArmR: 134, forearmR: -50,
          upperArmL: 228, forearmL: -48,
        }),
        scaleX: 1.05,
      },
      { t: 1, pose: P({ torso: 4, thighR: 504, shinR: 40, thighL: 208, shinL: 34, upperArmR: 130, upperArmL: 232 }) },
    ],
  },

  /**
   * Forward air: five blasts down a slow arc.
   *
   * The distinctive thing is that it is **slow and long** — the multihit runs
   * frames 12 to 25 — and that it travels *downward*. So the arc is authored
   * across four keys instead of the library's one strike key: the cannon starts
   * high in front, and the whole active window is spent walking it down. A
   * single key at full extension would put the entire move on one frame and
   * leave twenty-five frames of nothing, which is what it does today.
   */
  fair: {
    loop: false,
    strike: 0.14,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -14, head: 10,
          thighR: 156, shinR: 44, footR: -78,
          thighL: 202, shinL: 40, footL: -78,
          upperArmR: 348, forearmR: 22,
          upperArmL: 172, forearmL: -34,
        }),
        ease: "in",
      },
      {
        // First blast, frame 6: cannon high and forward. `linear` from here to
        // the last blast — the whole point of the move is that the cannon is
        // *travelling* through the multihit, and the five keys below are the
        // five blast frames, 6, 12, 18, 24 and 30, mapped through this move's
        // own timing so the pose is where the graphic is on every one of them.
        t: 0.14,
        pose: P({
          torso: -4, head: 4,
          thighR: 150, shinR: 40, footR: -76,
          thighL: 206, shinL: 38, footL: -76,
          upperArmR: 46, forearmR: -6,
          upperArmL: 190, forearmL: -40,
        }),
        offsetX: 0.25,
        ease: "linear",
      },
      {
        // Frame 12.
        t: 0.2515,
        pose: P({
          torso: 0, head: 0,
          thighR: 148, shinR: 41, footR: -75,
          thighL: 204, shinL: 38, footL: -76,
          upperArmR: 64, forearmR: -6,
          upperArmL: 194, forearmL: -42,
        }),
        offsetX: 0.3,
        ease: "linear",
      },
      {
        // Frame 18 — level, the middle of the multihit.
        t: 0.347,
        pose: P({
          torso: 6, head: -4,
          thighR: 146, shinR: 42, footR: -74,
          thighL: 202, shinL: 40, footL: -74,
          upperArmR: 84, forearmR: -6,
          upperArmL: 198, forearmL: -44,
        }),
        offsetX: 0.35,
        ease: "linear",
      },
      {
        // Frame 24.
        t: 0.4426,
        pose: P({
          torso: 14, head: -10, hip: -2,
          thighR: 150, shinR: 44, footR: -72,
          thighL: 200, shinL: 42, footL: -73,
          upperArmR: 105, forearmR: -10,
          upperArmL: 202, forearmL: -42,
        }),
        offsetX: 0.38,
        scaleX: 1.03,
        ease: "linear",
      },
      {
        // Frame 30, the last hit: down and forward, and the body follows the
        // cannon over.
        t: 0.5381,
        pose: P({
          torso: 22, head: -16, hip: -4,
          thighR: 154, shinR: 46, footR: -70,
          thighL: 198, shinL: 44, footL: -72,
          upperArmR: 126, forearmR: -14,
          upperArmL: 206, forearmL: -40,
        }),
        offsetX: 0.4,
        scaleX: 1.06,
        ease: "out",
      },
      {
        t: 0.72,
        pose: P({ torso: 12, head: -8, upperArmR: 142, forearmR: -22, upperArmL: 204, forearmL: -34 }),
        offsetX: 0.18,
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 148, forearmR: -26, upperArmL: 206, forearmL: -30 }) },
    ],
  },

  /**
   * Back air: a back kick.
   *
   * One leg, not two. The shared clip fires both legs behind her, which reads as
   * a dropkick; hers is a single hard kick with the body pitched forward as the
   * counterweight, and the counterweight is what makes 14% on the knee look like
   * 14%.
   */
  bair: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 8, head: -8,
          thighR: 156, shinR: 66, footR: -78,
          thighL: 168, shinL: 58, footL: -78,
          upperArmR: 150, forearmR: -40,
          upperArmL: 200, forearmL: -40,
        }),
        ease: "in",
      },
      {
        t: 0.26,
        pose: P({
          torso: 34, head: -28, hip: 10,
          // The kick: straight out behind, and the only limb that is straight.
          thighR: 256, shinR: -4, footR: -96,
          thighL: 168, shinL: 92, footL: -70,
          upperArmR: 118, forearmR: -46,
          upperArmL: 152, forearmL: -44,
        }),
        offsetX: -0.55,
        scaleX: 1.2,
        ease: "linear",
      },
      {
        // Frame 14, the last active frame. The kick is live for six frames and
        // without this key the cubic `out` has the leg two-thirds home before
        // the fourth of them.
        t: 0.372,
        pose: P({
          torso: 32, head: -26, hip: 9,
          thighR: 252, shinR: -2, footR: -94,
          thighL: 166, shinL: 90, footL: -70,
          upperArmR: 120, forearmR: -46,
          upperArmL: 154, forearmL: -44,
        }),
        offsetX: -0.5,
        scaleX: 1.18,
        ease: "out",
      },
      {
        t: 0.52,
        pose: P({
          torso: 24, head: -18,
          thighR: 232, shinR: 18, footR: -84,
          thighL: 162, shinL: 76, footL: -74,
        }),
        offsetX: -0.26,
        scaleX: 1.07,
      },
      { t: 1, pose: P({ torso: 8, thighR: 190, shinR: 34, thighL: 176, shinL: 40 }) },
    ],
  },

  /**
   * Up air: the corkscrew kick.
   *
   * Two separate things were wrong here and only one of them was `spin`.
   *
   * The corkscrew is about her long axis, so `spin` cannot express it — tipping
   * her over is not a corkscrew, it is a fall — and it is carried the same way
   * `nair` and `upB` carry theirs: `scaleX` collapsing to a third as she goes
   * edge-on and opening again, four half-turns across the multihit, the arms
   * swapping sides at each one. The half-turns sit on frames 4, 7, 10, 13 and
   * 16, which are the multihit's own frames.
   *
   * The second thing is the one the contact sheet showed: **with the torso
   * upright, both legs raised to 42° are invisible.** Thigh plus shin is 4.1
   * rig units from a pelvis at 4.2, so a leg pointing straight up reaches y ≈
   * 9.3 — below the centre of her own head — and lands inside the torso
   * capsule, where it is drawn behind it and never seen. The whole move was an
   * orange lozenge with nothing sticking out of it. The fix is the same one
   * `utilt` already needed: **arch the torso hard back** so the pelvis leads and
   * the raised legs project up and *forward*, clear of both torso and helmet.
   * Everything about a drill is that you can see the drill.
   */
  uair: {
    loop: false,
    strike: 0.2,
    keys: [
      {
        t: 0,
        pose: P({ torso: 14, head: -12, thighR: 152, shinR: 58, thighL: 204, shinL: 52 }),
        ease: "in",
      },
      {
        // Frame 4, the first hit. Arched back, both legs up and together and
        // out in front of the helmet, knees all but straight: one hard diagonal
        // from her trailing shoulder to her toes.
        t: 0.2,
        pose: P({
          torso: -72, head: 50, hip: 20,
          thighR: 18, shinR: 6, footR: -100,
          thighL: 24, shinL: 4, footL: -98,
          upperArmR: 152, forearmR: -70,
          upperArmL: 208, forearmL: -68,
        }),
        offsetY: 0.5,
        scaleY: 1.2,
        scaleX: 1.0,
        ease: "linear",
      },
      {
        // Frame 7 — edge-on.
        t: 0.2686,
        pose: P({
          torso: -70, head: 48, hip: 20,
          thighR: 12, shinR: 6, footR: -100,
          thighL: 14, shinL: 4, footL: -98,
          upperArmR: 178, forearmR: -66,
          upperArmL: 182, forearmL: -66,
        }),
        offsetY: 0.55,
        scaleY: 1.2,
        scaleX: 0.36,
        ease: "linear",
      },
      {
        // Frame 10 — face-on the other way round: the cannon has crossed to
        // the far side, which is the half-turn.
        t: 0.3371,
        pose: P({
          torso: -72, head: 50, hip: 20,
          thighR: 24, shinR: 6, footR: -100,
          thighL: 18, shinL: 4, footL: -98,
          upperArmR: 208, forearmR: -68,
          upperArmL: 152, forearmL: -70,
        }),
        offsetY: 0.52,
        scaleY: 1.2,
        scaleX: 1.0,
        ease: "linear",
      },
      {
        // Frame 13 — edge-on.
        t: 0.4057,
        pose: P({
          torso: -70, head: 48, hip: 20,
          thighR: 14, shinR: 6, footR: -100,
          thighL: 12, shinL: 4, footL: -98,
          upperArmR: 182, forearmR: -66,
          upperArmL: 178, forearmL: -66,
        }),
        offsetY: 0.5,
        scaleY: 1.2,
        scaleX: 0.36,
        ease: "linear",
      },
      {
        // Frame 16, the last hit — face-on, arms as they started.
        t: 0.4743,
        pose: P({
          torso: -70, head: 48, hip: 20,
          thighR: 20, shinR: 8, footR: -100,
          thighL: 26, shinL: 6, footL: -98,
          upperArmR: 152, forearmR: -70,
          upperArmL: 208, forearmL: -68,
        }),
        offsetY: 0.46,
        scaleY: 1.18,
        scaleX: 1.0,
        ease: "out",
      },
      {
        // Down out of the arch and into the fall.
        t: 0.68,
        pose: P({
          torso: -8, head: 8, hip: 4,
          thighR: 104, shinR: 30, footR: -88,
          thighL: 128, shinL: 26, footL: -86,
          upperArmR: 146, forearmR: -54,
          upperArmL: 212, forearmL: -52,
        }),
        offsetY: 0.2,
        scaleY: 1.06,
      },
      { t: 1, pose: P({ torso: 0, thighR: 150, shinR: 32, thighL: 202, shinL: 28 }) },
    ],
  },

  /**
   * Down air: the cannon swung down, not a stomp.
   *
   * This is the biggest single disagreement with the shared library. The library
   * gives every fighter a two-footed drop; hers is an **arm** move — the cannon
   * comes over from behind her shoulder and arcs down past her feet, and the
   * meteor is the middle of that arc on frames 19–21. Drawn as a stomp it is
   * indistinguishable from four other fighters.
   */
  dair: {
    loop: false,
    strike: 0.34,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -18, head: 14,
          thighR: 152, shinR: 60, footR: -78,
          thighL: 200, shinL: 56, footL: -78,
          // Cannon cocked up and behind the shoulder — the top of the arc.
          upperArmR: 318, forearmR: 26,
          upperArmL: 186, forearmL: -34,
        }),
        ease: "in",
      },
      {
        t: 0.34,
        pose: P({
          torso: 30, head: -24, hip: -6,
          // Legs swept back out of the way so the arm has the space, which is
          // also what stops this reading as a stomp.
          thighR: 208, shinR: 34, footR: -74,
          thighL: 216, shinL: 30, footL: -74,
          // Cannon down and forward, aimed along the line from her shoulder to
          // the meteor hitbox at (1, −2) — a unit in front of her and two below
          // her feet. Bone angles accumulate down the chain, so 118 here is
          // 118 *plus the torso's 30*; writing 180 points it backwards, which
          // is what the first pass did.
          //
          // The 35° off vertical is not a stylistic choice, it is the whole
          // legibility of the move. The cannon prop is 4.2 rig units across the
          // bone and 3.9 along it, so an arm pointing *straight* down renders it
          // as a horizontal slab lying over her own thigh, which is exactly what
          // a zoomed capture of the meteor frame showed: a dark bar at her waist
          // and no weapon anywhere. Tilted forward it clears the legs — which
          // this key has already swept back — and the barrel, the muzzle collar
          // and the bore are all against the background.
          upperArmR: 118, forearmR: 0,
          upperArmL: 244, forearmL: 34,
        }),
        offsetY: -0.4,
        // Not squashed. `scaleX: 0.9` shrank the cannon's projection by a tenth
        // on the exact frames it has to be legible against the background, and
        // there is nothing about a downward swing that narrows a fighter.
        scaleX: 1.02,
        scaleY: 1.12,
        ease: "linear",
      },
      {
        // Frame 22 — the last frame any of the three hitboxes is live, and one
        // past the meteor. The frames that take a stock are the ones the cannon
        // has to be *down* on, and a cubic `out` off the strike key had it 83%
        // of the way home by the first of them.
        t: 0.4638,
        pose: P({
          torso: 28, head: -22, hip: -6,
          thighR: 206, shinR: 34, footR: -74,
          thighL: 214, shinL: 30, footL: -74,
          upperArmR: 122, forearmR: -2,
          upperArmL: 242, forearmL: 32,
        }),
        offsetY: -0.36,
        scaleX: 1.01,
        scaleY: 1.11,
        ease: "out",
      },
      {
        t: 0.56,
        pose: P({
          torso: 20, head: -16,
          thighR: 194, shinR: 40, footR: -76,
          thighL: 206, shinL: 36, footL: -76,
          upperArmR: 152, forearmR: -14,
          upperArmL: 232, forearmL: 22,
        }),
        offsetY: -0.18,
        scaleY: 1.06,
      },
      { t: 1, pose: P({ torso: 6, thighR: 168, shinR: 30, thighL: 196, shinL: 26, upperArmR: 160, upperArmL: 210 }) },
    ],
  },

  /* --------------------------------------------------------- ground normals -- */

  /**
   * Jab.
   *
   * One clip serves jab 1 and jab 2, so it has to carry both halves of "a
   * left-handed jab followed by a forearm club with the Arm Cannon". The answer
   * is to punch with the **left** — which is already the half nobody else on the
   * roster does — while the cannon stays cocked high and back, loaded for the
   * club. Read on jab 1 it is the jab; read on jab 2 it is the wind-up the club
   * comes out of.
   */
  jab: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ torso: -6, head: 4, upperArmL: 142, forearmL: -58, upperArmR: 200, forearmR: -60 }),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          torso: 12, head: -8,
          thighR: 156, shinR: 22, footR: -86,
          thighL: 204, shinL: 20, footL: -82,
          upperArmL: 90, forearmL: -2,
          // Cannon held high and back: the second hit is already loaded.
          upperArmR: 214, forearmR: -70,
        }),
        offsetX: 0.32,
        scaleX: 1.05,
        ease: "linear",
      },
      {
        // This clip serves jab 1 and jab 2, whose hitboxes are frames 3–4 and
        // 6–9 respectively. `poseTimeFor` stretches each move separately, and
        // t = 0.36 is frame 3.3 of jab 1 and frame 7.1 of jab 2 — inside both
        // active windows, which is why one hold key can serve them both.
        t: 0.36,
        pose: P({
          torso: 11, head: -7,
          thighR: 156, shinR: 22, footR: -86,
          thighL: 204, shinL: 20, footL: -82,
          upperArmL: 92, forearmL: -1,
          upperArmR: 212, forearmR: -68,
        }),
        offsetX: 0.3,
        scaleX: 1.04,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({
          torso: 4, head: -2,
          upperArmL: 100, forearmL: 4,
          upperArmR: 198, forearmR: -58,
        }),
        offsetX: 0.18,
      },
      { t: 1, pose: P({ torso: 2, upperArmL: 150, forearmL: -34, upperArmR: 176, forearmR: -40 }) },
    ],
  },

  /** Forward tilt: a roundhouse kick, angleable. The shared clip is an arm. */
  ftilt: {
    loop: false,
    strike: 0.32,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -8, head: 6,
          // Chambered: knee up, foot back under her.
          thighR: 138, shinR: 92, footR: -72,
          thighL: 196, shinL: 22, footL: -84,
          upperArmR: 152, forearmR: -54,
          upperArmL: 206, forearmL: -46,
        }),
        offsetX: -0.2,
        ease: "in",
      },
      {
        t: 0.32,
        pose: P({
          torso: 16, head: -12, hip: -6,
          // Out flat at chest height, the shin straightening through it.
          thighR: 104, shinR: -12, footR: -68,
          thighL: 200, shinL: 12, footL: -86,
          upperArmR: 168, forearmR: -40,
          upperArmL: 226, forearmL: -44,
        }),
        offsetX: 0.45,
        scaleX: 1.14,
        ease: "linear",
      },
      {
        // Frame 10, the last active frame. Held.
        t: 0.372,
        pose: P({
          torso: 15, head: -11, hip: -6,
          thighR: 106, shinR: -10, footR: -68,
          thighL: 200, shinL: 13, footL: -86,
          upperArmR: 167, forearmR: -40,
          upperArmL: 225, forearmL: -44,
        }),
        offsetX: 0.43,
        scaleX: 1.13,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({
          torso: 8, head: -6,
          thighR: 126, shinR: 32, footR: -76,
          thighL: 198, shinL: 16, footL: -86,
        }),
        offsetX: 0.24,
        scaleX: 1.05,
      },
      { t: 1, pose: P({ torso: 4, thighR: 158, shinR: 30, thighL: 196, shinL: 22 }) },
    ],
  },

  /**
   * Up tilt: the axe kick.
   *
   * The hitbox is over her head on frames 15–18 at angle 270, so the strike key
   * is the leg at the **top** of the arc and the chop is the follow-through —
   * which is why the move meteors a grounded opponent and reads as a bug until
   * you watch it. Authored in that order, the meteor explains itself.
   */
  utilt: {
    loop: false,
    strike: 0.32,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 14, head: -12,
          thighR: 146, shinR: 62, footR: -80,
          thighL: 198, shinL: 24, footL: -84,
          upperArmR: 160, forearmR: -44,
          upperArmL: 214, forearmL: -44,
        }),
        ease: "in",
      },
      {
        // Top of the swing: the leg vertical, the body arched hard back under
        // it. The arch has to be extreme — her thigh and shin together are a
        // third of her height, so a leg raised from an upright torso only
        // reaches her own chest and the kick reads as a knee lift. Leaning the
        // torso out from under it is the only way the foot clears her head.
        t: 0.32,
        pose: P({
          torso: -38, head: 32, hip: 16,
          thighR: 8, shinR: 6, footR: -104,
          thighL: 196, shinL: 8, footL: -86,
          upperArmR: 224, forearmR: -26,
          upperArmL: 262, forearmL: 22,
        }),
        offsetY: 0.5,
        offsetX: -0.3,
        scaleY: 1.16,
        scaleX: 0.86,
        ease: "linear",
      },
      {
        // Frame 18, the last of the four active frames. The foot has to still
        // be at the top of the arc on it.
        t: 0.4016,
        pose: P({
          torso: -36, head: 30, hip: 15,
          thighR: 12, shinR: 6, footR: -104,
          thighL: 196, shinL: 8, footL: -86,
          upperArmR: 222, forearmR: -26,
          upperArmL: 260, forearmL: 22,
        }),
        offsetY: 0.48,
        offsetX: -0.28,
        scaleY: 1.15,
        scaleX: 0.87,
        ease: "out",
      },
      {
        // The chop. This is the half that does the meteoring.
        t: 0.54,
        pose: P({
          torso: 26, head: -20, hip: -8,
          thighR: 146, shinR: 16, footR: -96,
          thighL: 200, shinL: 26, footL: -82,
          upperArmR: 178, forearmR: -30,
          upperArmL: 222, forearmL: -30,
        }),
        offsetY: -0.7,
        scaleY: 0.94,
      },
      { t: 1, pose: P({ torso: 8, thighR: 154, shinR: 34, thighL: 198, shinL: 26 }) },
    ],
  },

  /** Down tilt: kneel, cannon thrust low and forward, and a blast off the end. */
  dtilt: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 20, head: -16,
          thighR: 136, shinR: 92, footR: -80,
          thighL: 144, shinL: 88, footL: -78,
          upperArmR: 148, forearmR: -56,
          upperArmL: 212, forearmL: -50,
        }),
        offsetY: -1.7,
        ease: "in",
      },
      {
        // Down on the back knee, cannon punched out just off the floor. The
        // hitbox is at y = 1.5, which is ankle height — the arm has to be that
        // low or the effect and the hitbox are in different places.
        t: 0.3,
        pose: P({
          torso: 28, head: -22, hip: -8,
          thighR: 116, shinR: 4, footR: -84,
          thighL: 152, shinL: 128, footL: -60,
          upperArmR: 126, forearmR: -22,
          upperArmL: 208, forearmL: -44,
        }),
        offsetY: -2.6,
        offsetX: 0.45,
        scaleX: 1.12,
        scaleY: 0.86,
        ease: "linear",
      },
      {
        // Frame 8, the last active frame — and the last frame the blast in
        // `fx.ts` is at full brightness. Held.
        t: 0.336,
        pose: P({
          torso: 27, head: -21, hip: -8,
          thighR: 117, shinR: 5, footR: -84,
          thighL: 152, shinL: 127, footL: -60,
          upperArmR: 127, forearmR: -22,
          upperArmL: 208, forearmL: -44,
        }),
        offsetY: -2.6,
        offsetX: 0.43,
        scaleX: 1.11,
        scaleY: 0.86,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({
          torso: 24, head: -18,
          thighR: 124, shinR: 20, footR: -84,
          thighL: 150, shinL: 118, footL: -64,
          upperArmR: 134, forearmR: -30,
        }),
        offsetY: -2.4,
        offsetX: 0.2,
      },
      { t: 1, pose: P({ torso: 18, thighR: 136, shinR: 90, thighL: 146, shinL: 86 }), offsetY: -1.6 },
    ],
  },

  /**
   * Dash attack: the shoulder tackle.
   *
   * The Shinespark — she drops her shoulder and drives through, body nearly
   * horizontal, arms trailing. The shared clip is a two-armed lunge, which is a
   * shove; the difference is where the leading edge of the silhouette is, and
   * hers is a shoulder.
   */
  dashAttack: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 26, head: -18,
          thighR: 142, shinR: 54, footR: -82,
          thighL: 214, shinL: 44, footL: -76,
          upperArmR: 196, forearmR: -50,
          upperArmL: 178, forearmL: -46,
        }),
        offsetX: 0.2,
        ease: "in",
      },
      {
        t: 0.28,
        pose: P({
          // Pitched right over, so the pauldron is the front of the shape.
          torso: 58, head: -44, hip: -14,
          thighR: 130, shinR: 52, footR: -70,
          thighL: 228, shinL: 34, footL: -64,
          // Both arms swept back along the body: nothing in front of the
          // shoulder, which is the entire point of the pose.
          upperArmR: 238, forearmR: -18,
          upperArmL: 246, forearmL: -16,
        }),
        offsetX: 1.25,
        offsetY: -0.9,
        scaleX: 1.2,
        scaleY: 0.9,
        ease: "linear",
      },
      {
        // Frame 18. The tackle is live from frame 8 to frame 18 — eleven
        // frames, a quarter of the move — so this is not a strike key with a
        // recovery after it, it is a shape that has to survive the whole
        // charge. It travels a little and leans a little; it does not stand up.
        t: 0.4918,
        pose: P({
          torso: 54, head: -41, hip: -13,
          thighR: 133, shinR: 50, footR: -70,
          thighL: 226, shinL: 35, footL: -64,
          upperArmR: 236, forearmR: -19,
          upperArmL: 244, forearmL: -17,
        }),
        offsetX: 1.15,
        offsetY: -0.85,
        scaleX: 1.18,
        scaleY: 0.9,
        ease: "out",
      },
      {
        t: 0.62,
        pose: P({
          torso: 40, head: -30,
          thighR: 136, shinR: 46, footR: -74,
          thighL: 218, shinL: 34, footL: -70,
          upperArmR: 216, forearmR: -30,
          upperArmL: 222, forearmL: -28,
        }),
        offsetX: 0.7,
        offsetY: -0.7,
      },
      { t: 1, pose: P({ torso: 16, upperArmR: 170, forearmR: -34, upperArmL: 196, forearmL: -32 }), offsetY: -0.4 },
    ],
  },

  /* --------------------------------------------------------- grab & throw -- */

  /**
   * Grapple Beam.
   *
   * The one tether on the roster, and the reason it grabs on frame 15 instead of
   * frame 6: the beam has fourteen world units to travel. The pose is only half
   * the move — `fx.ts` draws the beam itself — but the half it owns matters,
   * because a fighter reaching with an *empty hand* while a beam comes out of
   * her other arm is worse than no beam at all. So the cannon is what goes
   * forward, the body leans out along it, and the free arm counterweights back.
   */
  grab: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -12, head: 8,
          thighR: 160, shinR: 30, footR: -84,
          thighL: 206, shinL: 28, footL: -80,
          upperArmR: 172, forearmR: -76,
          upperArmL: 158, forearmL: -44,
        }),
        offsetX: -0.3,
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          torso: 14, head: -8, hip: -2,
          thighR: 138, shinR: 24, footR: -88,
          thighL: 220, shinL: 26, footL: -76,
          ...CANNON_LEVEL,
          upperArmL: 232, forearmL: -54,
        }),
        offsetX: 0.7,
        scaleX: 1.1,
        ease: "linear",
      },
      {
        // Held: the beam is live frames 15–22 and she is committed for all of
        // them. Nothing moves but the beam. Frame 22 is t = 0.409 on this
        // move, not 0.46 — 0.46 was frame 24, two frames after the tether had
        // already snapped back.
        t: 0.409,
        pose: P({
          torso: 12, head: -6,
          thighR: 140, shinR: 24, footR: -88,
          thighL: 218, shinL: 26, footL: -76,
          upperArmR: 90, forearmR: -2,
          upperArmL: 228, forearmL: -50,
        }),
        offsetX: 0.6,
        scaleX: 1.06,
        ease: "out",
      },
      {
        // The recoil of the beam coming home, over frames 23–30.
        t: 0.56,
        pose: P({
          torso: 0, head: 2,
          thighR: 150, shinR: 26, footR: -86,
          thighL: 210, shinL: 26, footL: -78,
          upperArmR: 108, forearmR: -16,
          upperArmL: 210, forearmL: -44,
        }),
        offsetX: 0.24,
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 126, forearmR: -28, upperArmL: 194, forearmL: -36 }) },
    ],
  },

  /**
   * Up throw: hoist, then fire point blank.
   *
   * The shared clip throws with both arms, which is right for most of the
   * roster and wrong here — the damage comes out of the cannon. The left arm
   * lifts them, the cannon comes up under them, and `fx.ts` puts the muzzle
   * flash on the contact frame.
   */
  uthrow: {
    loop: false,
    strike: 0.35,
    keys: [
      {
        t: 0,
        pose: P({ torso: 12, head: -10, upperArmL: 118, forearmL: -52, upperArmR: 150, forearmR: -46 }),
        offsetY: -0.6,
        ease: "in",
      },
      {
        t: 0.35,
        pose: P({
          torso: -10, head: 12,
          thighR: 164, shinR: 16, footR: -86,
          thighL: 198, shinL: 14, footL: -84,
          // Left arm holds them up; the cannon comes up alongside and fires.
          upperArmL: 352, forearmL: 4,
          upperArmR: 8, forearmR: -6,
        }),
        offsetY: 0.6,
        scaleY: 1.12,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({
          torso: -2, head: 6,
          upperArmL: 336, forearmL: 8,
          upperArmR: 26, forearmR: 2,
        }),
        offsetY: 0.28,
        scaleY: 1.04,
      },
      { t: 1, pose: P({ torso: 2, upperArmL: 300, forearmL: -18, upperArmR: 62, forearmR: 18 }) },
    ],
  },
};
