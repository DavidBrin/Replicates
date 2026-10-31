/**
 * Mario — fighter 01, and the yardstick the other seven are read against.
 *
 * Nothing about Mario is extreme: weight 98 against a cast spanning 62–135,
 * middling speed, middling gravity, a fireball that is useful and never
 * oppressive. That is the point of putting him first — every other fighter in
 * this directory is legible as a deviation from these numbers.
 *
 * ── where the numbers come from ────────────────────────────────────────────
 *
 * **Attributes** are SmashWiki's stats table for Mario (SSBU).
 *
 * **Startup, active frames, FAF and landing lag** are Ultimate Frame Data.
 *
 * **Angle, base knockback and knockback growth** are *not published by either
 * site* — this trips up everyone who tries. UFD's per-move columns are startup,
 * total frames, landing lag, damage, shield lag, shield stun and shield
 * advantage; a careless read of that table returns shield lag and shield stun
 * wearing the names "base knockback" and "knockback growth", which is how you
 * end up asserting that Mario's forward smash has BKB 11 (it is 25). These
 * values are read from the game's own ACMD scripts for patch 13.0.1 — the
 * `ATTACK(Damage=, Angle=, KBG=, BKB=, Size=, X=, Y=, Z=)` calls that the
 * community's frame data is ultimately derived from.
 *
 * ── conventions ───────────────────────────────────────────────────────────
 *
 * `baseKnockback` and `knockbackGrowth` hold the game's **raw** values, not
 * pre-divided ones: growth 99 means 99, and SPEC §4's formula divides by 100.
 * `angle` 361 is the Sakurai angle, which resolves differently for grounded and
 * airborne victims, and on the ground by the hit's knockback — see
 * `SAKURAI_ANGLE` in `engine/constants.ts`.
 *
 * Hitbox `x`/`y` are facing-relative offsets from the fighter's origin, which
 * sits between the feet, in the same units as the stage. The ACMD data gives
 * these relative to a *bone* — and for the root bone its forward axis is Z, not
 * X, which is why a jab reads `X=0.0, Z=6.0` in the raw script and `x: fx(6.0)`
 * here. Where a hitbox hangs off a limb bone, its position is the bone's
 * resting place plus the script's offset along it; those are marked
 * `POSITION: estimated`, because a bone's position during a swing depends on the
 * animation, and animations are not in any dump. Radii are the script's `Size`
 * verbatim.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef, ProjectileDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { MARIO } from "./acmd/generated/mario";
import { FIGHTER_PARAMS } from "./params";

/** Mario's hurtbox is about eleven units tall — a shade over a seventh of
 * Battlefield's width, which is the scale the whole game is drawn at.
 * UNVERIFIED: hurtbox dimensions are not published by SmashWiki, UFD or the
 * ACMD dump; these are read off his model's proportions against the hitbox
 * coordinates above (his down air's landing hitbox is centred at y 6.8 with a
 * radius of 11, and his jab sits at chest height y 6.3). */
const HEIGHT = 11.0;
const HALF_WIDTH = 2.0;

/**
 * One F.L.U.D.D. pump (Plan 5, Task 6), a windbox projectile.
 *
 * - The box: rubendal Data Viewer 13.0.1, `mario_pumpwater` `Regular`
 *   (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json):
 *   `Damage=0.0, Angle=55, KBG=100, FKB=70, BKB=0, Size=4.0`,
 *   `Clang_Rebound=ATTACK_SETOFF_KIND_OFF` (transcendent), `Reflectable=true`,
 *   `Flinchless=true, DisableHitlag=true` (a windbox). SmashWiki "Mario
 *   (SSBU)/Down special" (https://www.ssbwiki.com/Mario_(SSBU)/Down_special)
 *   has the same row (`fkv=70`, `clang=f`, `flinchless=t`, `reflectable=t`).
 * - The charge (P5-R5): the row's note, "Base knockback can increase up to 55
 *   depending on charge", is base knockback beside the set knockback, which the
 *   set-knockback formula adds (`computeKnockback`). The same page: "Initial
 *   speed 4.3", "Maximum additional speed 4.3", "Minimum size multiplier 0.8",
 *   "Maximum size multiplier 1.2" (radius 4 × 0.8 to × 1.2). UNVERIFIED: that
 *   all three grow linearly with the charge, and that the added speed is along
 *   the aim, so `vy` grows with `vx`.
 * - The flight: "Default shot angle 12°", "Lifetime 12 frames", "Gravity 0.17".
 *   Its "Falling speed 3" is never reached in its 12 frames (0.894 − 11 × 0.17).
 * - UNVERIFIED: the spawn point, 6.5 in front and 9.7 up: the nozzle's mouth
 *   in his hands beside his head (SmashWiki "F.L.U.D.D.",
 *   https://www.ssbwiki.com/F.L.U.D.D.: "In Smash, it is shown being used next
 *   to his head, with Mario grabbing the nozzle"). No number is published: the
 *   script places the box on the water's own origin (`X=0.0, Y=0.0, Z=0.0`),
 *   and the page's "Vertical offset 0.5u" names no origin. The height is
 *   SmashWiki's hitbox picture (https://www.ssbwiki.com/File:MarioDSpecialSSBU.png)
 *   worked back to the spawn: its two spheres sit 7.95 units apart along 12.4°,
 *   two frames of their 4.3-a-frame speed difference, so it shows the pumps two
 *   frames out, and two frames back the water is about 9.5-10 up (Plan 5, Task
 *   6 fix round 1, ruling (b)). At this height the water passes over a
 *   standing Kirby, and over a standing Pikachu but point-blank; whether
 *   Ultimate's does is not published.
 * - UNVERIFIED: that a pump is gone after its first hit. Not modelled: the
 *   stick's aim ("Maximum upward deviation 50°", "Maximum downward deviation
 *   18°", "Deviation per frame 1.9°").
 */
function waterPump(spawnFrame: number): ProjectileDef {
  return {
    id: "water",
    spawnFrame,
    offsetX: fx(6.5),
    offsetY: fx(9.7),
    vx: fx(4.206), // 4.3 · cos 12°
    vy: fx(0.894), // 4.3 · sin 12°
    gravity: fx(0.17),
    lifetime: 12,
    destroyOnHit: true,
    visual: "spark",
    reflectable: true,
    // 8.6 along 12°: 8.6 · cos 12°, 8.6 · sin 12°.
    charged: { vx: fx(8.412), vy: fx(1.788), hitbox: { baseKnockback: fx(55), radius: fx(4.8) } },
    hitbox: {
      id: 0,
      startFrame: 0,
      endFrame: 11,
      x: fx(0),
      y: fx(0),
      radius: fx(3.2),
      damage: fx(0),
      angle: fx(55),
      baseKnockback: fx(0),
      knockbackGrowth: fx(100),
      fixedKnockback: fx(70),
      transcendent: true,
      windbox: true,
    },
  };
}

/** The hand-authored moveset; `mario` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "mario",
  name: "Mario",
  series: "Super Mario",
  number: 1,

  attributes: {
    weight: 98,
    walkSpeed: fx(1.155),
    initialDashSpeed: fx(1.936),
    runSpeed: fx(1.76),
    airSpeed: fx(1.208),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.07),
    gravity: fx(0.087),
    fallSpeed: fx(1.5),
    fastFallSpeed: fx(2.4),
    traction: fx(0.102),
    // Ultimate publishes jump *heights*, not launch velocities. Under constant
    // gravity a jump peaks at v^2/2g, so v = sqrt(2gh): full hop 36.33 units at
    // gravity 0.087 gives 2.514. Same derivation for every fighter here.
    fullHopVelocity: fx(2.514),
    shortHopVelocity: fx(1.747),
    airJumpVelocity: fx(2.514),
    jumps: 2,
    canWallJump: true,
    // SmashWiki "Wall jump" (https://www.ssbwiki.com/Wall_jump), "Wall jump height
    // rankings", Ultimate: 29.263 (revision 2065734, 2026-10-25, the corrected table).
    wallJumpHeight: fx(29.263),
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
    // Air dodges (Plan 3, Task 20c): fudgepop01/amiibo_research
    // `fighter_param_motion.xml` @523374aa, the `fighter_kind_mario` entry (L5):
    // L26 `escape_air_stiff_frame`, L22-23 `escape_air_hit_xlu_frame` /
    // `_hit_normal_frame`, L114-116 `escape_air_slide_stiff_frame` / `_u_` /
    // `_d_`, L29-30 `escape_air_slide_hit_xlu_frame` / `_hit_normal_frame`.
    airDodge: {
      neutralFrames: 52,
      neutralIntangible: [3, 27],
      sideFrames: 86,
      upFrames: 115,
      downFrames: 71,
      directionalIntangible: [3, 19],
    },
    // Spot dodge and rolls (Plan 3 final wave): UltimateFrameData,
    // https://ultimateframedata.com/mario, "Dodges / Rolls": each "Total frames"
    // and "Intangible on frame a-b", fresh. The spot dodge is the second of
    // UFD's "20/25"; the first is its cancel, not modelled (`GroundDodgeAttributes`).
    groundDodge: {
      spotDodge: { frames: 25, intangible: [3, 17] },
      forwardRoll: { frames: 29, intangible: [4, 15] },
      backRoll: { frames: 34, intangible: [5, 16] },
    },
  },

  params: FIGHTER_PARAMS.mario,

  moves: {
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 19,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 3,
          x: fx(6.0),
          y: fx(6.3),
          radius: fx(1.5),
          damage: fx(2.2),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(30),
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Straight",
      totalFrames: 21,
      followUp: "jab3",
      hitboxes: [
        {
          id: 0,
          // POSITION: estimated — the script mounts this on `armr` at X=4.2,
          // i.e. 4.2 units down an arm whose shoulder sits around y 7.6.
          startFrame: 2,
          endFrame: 3,
          x: fx(5.4),
          y: fx(6.9),
          radius: fx(2.0),
          damage: fx(1.7),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(30),
        },
      ],
    },

    jab3: {
      slot: "jab3",
      name: "Roundhouse",
      totalFrames: 33,
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 4,
          x: fx(4.6),
          y: fx(7.5),
          radius: fx(4.3),
          damage: fx(4.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(80),
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 25,
      hitboxes: [
        {
          id: 0,
          // POSITION: estimated — `kneer` at X=4.6, a leg kick at hip height.
          startFrame: 5,
          endFrame: 7,
          x: fx(6.4),
          y: fx(4.4),
          radius: fx(3.8),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(55),
          knockbackGrowth: fx(70),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 29,
      hitboxes: [
        {
          id: 0,
          // Seven active frames and knockback growth of 130 on 5.5% — this is
          // the shape of a combo starter, not a finisher.
          startFrame: 5,
          endFrame: 11,
          x: fx(1.4),
          y: fx(10.6),
          radius: fx(4.2),
          damage: fx(5.5),
          angle: fx(96),
          baseKnockback: fx(28),
          knockbackGrowth: fx(130),
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 27,
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 7,
          x: fx(3.4),
          y: fx(1.6),
          radius: fx(3.2),
          damage: fx(7.0),
          angle: fx(80),
          baseKnockback: fx(35),
          knockbackGrowth: fx(80),
        },
        {
          // The outer foot is the weaker half — 5% rather than 7%. It carries a
          // 40% trip chance in the script, which this schema has no field for.
          id: 1,
          startFrame: 5,
          endFrame: 7,
          x: fx(6.2),
          y: fx(1.0),
          radius: fx(4.2),
          damage: fx(5.0),
          angle: fx(80),
          baseKnockback: fx(35),
          knockbackGrowth: fx(80),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 37,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 9,
          x: fx(3.6),
          y: fx(4.5),
          radius: fx(3.5),
          damage: fx(8.0),
          angle: fx(50),
          baseKnockback: fx(100),
          knockbackGrowth: fx(43),
        },
        {
          id: 1,
          startFrame: 10,
          endFrame: 25,
          x: fx(3.6),
          y: fx(4.5),
          radius: fx(2.7),
          damage: fx(6.0),
          angle: fx(48),
          baseKnockback: fx(100),
          knockbackGrowth: fx(30),
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 47,
      chargeable: true,
      // Held on the published first frame of its "Charges between 5-6" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Mario (SSBU)/Forward smash",
      // https://www.ssbwiki.com/Mario_(SSBU)/Forward_smash, revision 1956447).
      smashHold: 5,
      hitboxes: [
        {
          // Lower id wins, and the *close* hit is the weak one — get too near
          // and the fire blast is replaced by 14.7% of forearm. That inversion
          // is deliberate in the original and worth preserving.
          id: 0,
          startFrame: 15,
          endFrame: 17,
          x: fx(3.2),
          y: fx(7.6),
          radius: fx(2.0),
          damage: fx(14.7),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(105),
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 17,
          x: fx(8.6),
          y: fx(6.9),
          radius: fx(5.0),
          damage: fx(17.8),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(99),
          effect: "fire",
          // `game_attacks4` id 1 (all three angles): `ATTACK_SETOFF_KIND_OFF`; SmashWiki
          // "Priority" lists Mario's forward smash sweetspot (Plan 5, Task 13c).
          transcendent: true,
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 39,
      chargeable: true,
      // Held on the published first frame of its "Charges between 6-7" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Mario (SSBU)/Up smash",
      // https://www.ssbwiki.com/Mario_(SSBU)/Up_smash, revision 2046199).
      smashHold: 6,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 12,
          x: fx(2.5),
          y: fx(10.3),
          radius: fx(5.0),
          damage: fx(14.0),
          angle: fx(83),
          baseKnockback: fx(32),
          knockbackGrowth: fx(94),
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 43,
      chargeable: true,
      hitboxes: [
        {
          // A breakdance sweep: front on frame 5, back on frame 14, and the
          // *back* half hits harder — 12% against 10%.
          id: 0,
          startFrame: 5,
          endFrame: 6,
          x: fx(4.8),
          y: fx(1.8),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(32),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 14,
          x: fx(-4.8),
          y: fx(1.8),
          radius: fx(4.0),
          damage: fx(12.0),
          angle: fx(30),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 45,
      landingLag: 6,
      autoCancelBefore: 2,
      autoCancelAfter: 39,
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 5,
          x: fx(2.8),
          y: fx(4.6),
          radius: fx(4.0),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          // The "sex kick" decay: the same leg, twenty-two frames longer, for
          // five percent instead of eight.
          id: 1,
          startFrame: 6,
          endFrame: 27,
          x: fx(2.8),
          y: fx(4.6),
          radius: fx(2.8),
          damage: fx(5.0),
          angle: fx(361),
          baseKnockback: fx(13),
          knockbackGrowth: fx(90),
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 59,
      landingLag: 17,
      autoCancelAfter: 45,
      hitboxes: [
        {
          id: 0,
          startFrame: 16,
          endFrame: 16,
          x: fx(5.0),
          y: fx(7.4),
          radius: fx(3.0),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(80),
        },
        {
          // Frames 17-20 at angle 280 — this is the meteor, and the reason a
          // Mario who reads your recovery ends the stock on the spot.
          id: 1,
          startFrame: 17,
          endFrame: 20,
          x: fx(5.2),
          y: fx(6.4),
          radius: fx(4.6),
          damage: fx(14.0),
          angle: fx(280),
          baseKnockback: fx(32),
          knockbackGrowth: fx(78),
          meteor: true,
        },
        {
          id: 2,
          startFrame: 21,
          endFrame: 21,
          x: fx(5.0),
          y: fx(6.4),
          radius: fx(4.6),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(80),
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 33,
      landingLag: 6,
      autoCancelBefore: 5,
      autoCancelAfter: 19,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(-6.4),
          y: fx(5.2),
          radius: fx(4.5),
          damage: fx(10.5),
          angle: fx(361),
          baseKnockback: fx(12),
          knockbackGrowth: fx(106),
        },
        {
          id: 1,
          startFrame: 8,
          endFrame: 10,
          x: fx(-6.4),
          y: fx(5.2),
          radius: fx(4.5),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(7),
          knockbackGrowth: fx(90),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 30,
      landingLag: 6,
      autoCancelBefore: 3,
      autoCancelAfter: 24,
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 7,
          x: fx(1.6),
          y: fx(11.4),
          radius: fx(5.5),
          damage: fx(7.0),
          angle: fx(75),
          baseKnockback: fx(10),
          knockbackGrowth: fx(135),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 37,
      landingLag: 15,
      hitboxes: [
        // A drill: five weak hits on odd frames that hold the victim in place
        // (the script marks them set-weight so they land the same on everyone),
        // then one real hit on frame 23 that launches. The five are base
        // knockback 50 and growth 15 under set weight, not set knockback:
        // `game_attackairlw` has `kbg: 15, bkb: 50, setWeight: true` and no `fkb`
        // (fighters/acmd/generated/mario.ts; Plan 3, Task 16b).
        {
          id: 0,
          startFrame: 5,
          endFrame: 5,
          x: fx(0),
          y: fx(-0.5),
          radius: fx(4.0),
          damage: fx(1.4),
          angle: fx(94),
          baseKnockback: fx(50),
          knockbackGrowth: fx(15),
          setWeight: true,
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 7,
          x: fx(0),
          y: fx(-0.5),
          radius: fx(4.0),
          damage: fx(1.4),
          angle: fx(94),
          baseKnockback: fx(50),
          knockbackGrowth: fx(15),
          setWeight: true,
        },
        {
          id: 2,
          startFrame: 9,
          endFrame: 9,
          x: fx(0),
          y: fx(-0.5),
          radius: fx(4.0),
          damage: fx(1.4),
          angle: fx(94),
          baseKnockback: fx(50),
          knockbackGrowth: fx(15),
          setWeight: true,
        },
        {
          id: 3,
          startFrame: 11,
          endFrame: 11,
          x: fx(0),
          y: fx(-0.5),
          radius: fx(4.0),
          damage: fx(1.4),
          angle: fx(94),
          baseKnockback: fx(50),
          knockbackGrowth: fx(15),
          setWeight: true,
        },
        {
          id: 4,
          startFrame: 13,
          endFrame: 13,
          x: fx(0),
          y: fx(-0.5),
          radius: fx(4.0),
          damage: fx(1.4),
          angle: fx(94),
          baseKnockback: fx(50),
          knockbackGrowth: fx(15),
          setWeight: true,
        },
        {
          id: 5,
          startFrame: 23,
          endFrame: 23,
          x: fx(0),
          y: fx(6.8),
          radius: fx(11.0),
          damage: fx(5.5),
          angle: fx(75),
          baseKnockback: fx(80),
          knockbackGrowth: fx(100),
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Fireball",
      totalFrames: 49,
      // The move itself has no hitbox at all — Mario's hand never hurts anyone.
      // Everything this move does belongs to the fireball it throws.
      hitboxes: [],
      projectiles: [
        {
          // Thrown underarm on frame 17 and pulled down by gravity, so it
          // bounces along the ground rather than flying flat — which is the
          // whole character of the move. It dies on contact. Reflectable and
          // absorbable. It lives 70 frames, 17-86 (SmashWiki "Mario
          // (SSBU)/Neutral special", https://www.ssbwiki.com/Mario_(SSBU)/Neutral_special:
          // "Lifetime 70 frames", "Latest hit 47-86").
          //
          // Its flight is the same page's "Fireball parameters" (Task 13c fix round
          // 1, ruling R-T13c-e): "Initial speed 1.4" at "Initial angle −10°" (1.4 cos
          // 10°, −1.4 sin 10°), "Gravity 0.1"; a floor bounces it ×0.97 along it,
          // "Minimum vertical speed after bounce 1.4", "Maximum vertical speed after
          // bounce 1.6" (`hop`), and "Number of bounces before disappearing 7". Its
          // "Maximum wall angle to bounce off 60°" is read as the steepest surface it
          // bounces up off as a floor; a steeper one, a wall, sends it back the way
          // it came (SmashWiki "Fireball", https://www.ssbwiki.com/Fireball: "When
          // firing at a wall or upward slope, the balls will bounce backward"), as
          // does an underside, each spending a bounce (UNVERIFIED for the underside,
          // and that a wall's bounce counts among the 7). Every surface here is flat
          // or upright. UNVERIFIED: the spawn point, 5.2 ahead and 6.4 up.
          id: "fireball",
          spawnFrame: 17,
          offsetX: fx(5.2),
          offsetY: fx(6.4),
          vx: fx(1.3787),
          vy: fx(-0.2431),
          gravity: fx(0.1),
          lifetime: 70,
          destroyOnHit: true,
          bounces: 7,
          hop: { speed: fx(0.97), minVy: fx(1.4), maxVy: fx(1.6) },
          visual: "fire",
          // mario_fireball `Regular`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 69,
            x: fx(0),
            y: fx(0),
            radius: fx(2.6),
            damage: fx(5.0),
            angle: fx(361),
            baseKnockback: fx(20),
            knockbackGrowth: fx(30),
            effect: "fire",
            // mario_fireball `Regular`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON`, so it
            // clanks (Plan 5, Task 13c; SmashWiki "Priority"'s Fireball against
            // Sonic's jab).
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Cape",
      totalFrames: 35,
      // The Cape's real job is not its 7%: it reverses an opponent's facing and
      // reflects projectiles at 1.5x (Plan 5). SmashWiki "Mario (SSBU)/Side
      // special" (https://www.ssbwiki.com/Mario_(SSBU)/Side_special): reflects
      // frames 9-20; "Damage multiplier 1.5", "Speed multiplier 1", "Lifetime
      // multiplier 0.75", "Size 6.5u", "Offsets [0, 6.5, 8]" (8 in front, 6.5
      // up; SmashWiki "Mario (SSBU)": "moved forward (Z offset: 2 → 8)"),
      // "Damage threshold 50%"; a projectile detector on frames 6-8;
      // "Interruptible 36"; animation length 58.
      //
      // The hitboxes are `game_specials` (rubendal Data Viewer 13.0.1): 7%,
      // angle 110, KBG 100, FKB 80 with BKB 0, `collision_attr_turn`, frames
      // 12-14 — the legacy 70°/BKB 50/KBG 60 box was not the game's. The script
      // also raises `FIGHTER_MARIO_STATUS_SPECIAL_S_FLAG_SPECIAL_FALL` on frames
      // 12-20 (`generated/mario.ts`); no source says what it does, so it is
      // recorded here and not modelled.
      reflector: {
        active: [9, 20],
        radius: fx(6.5),
        x: fx(8),
        y: fx(6.5),
        damage: fx(1.5),
        speed: fx(1),
        lifetime: fx(0.75),
        maxDamage: fx(50),
        holdAfterReflect: 0,
        // The early reflect: SmashWiki "Mario (SSBU)", it can "start two frames
        // earlier (frame 7) if a projectile is very close"; `game_specials`'
        // `SEARCH` from frame 6 (`top`, size 8, Y 6.5, Z 2.5 to 8) and
        // `REFLECT_MOTION_FRAME` 9.
        detector: { frames: [6, 8], to: 9, x1: fx(2.5), x2: fx(8), y: fx(6.5), radius: fx(8) },
      },
      // In the air (the same page's aerial parameters): speed ÷ 2.5 (×0.4) and
      // +0.3 up once, then gravity 0.031, falling speed 1 and air friction
      // 0.0025 with no drift, for as long as the Cape lasts: 58 frames unless
      // Mario acts from frame 36 (SmashWiki "Mario (SSBU)": "The move's
      // animation length is much longer (41 frames → 58). In the air, this
      // means Mario's air mobility is restricted for much longer, forcing the
      // player to have to interrupt the move with an aerial or special").
      // UltimateFrameData's total of 35 frames is the part before frame 36,
      // "Interruptible 36" (`totalFrames`), not the animation's length.
      //
      // The stop is the airtime's first midair use's only (Super Mario Wiki
      // "Cape": the first midair use "briefly stops Mario's falling"); every
      // aerial use keeps the move's physics, its published numbers being the
      // move's own. UNVERIFIED: that a hit or a ledge gives the stop back, as
      // they do Fox's Reflector's (Super Mario Wiki names landing only:
      // "between leaving the ground and returning to it"); the boost's reading
      // ("Vertical speed added", onto a fall stopped dead); the hold's visuals
      // (the bake's Cape is 35 frames, held on its last for the rest).
      stall: {
        startX: fx(0.4),
        boostY: fx(0.3),
        noGravityFrames: 0,
        gravity: fx(0.031),
        fallSpeed: fx(1),
        airFriction: fx(0.0025),
        everyUse: true,
      },
      airTotalFrames: 58,
      hitboxes: [
        {
          id: 0,
          startFrame: 12,
          endFrame: 14,
          x: fx(9.7),
          y: fx(6.7),
          radius: fx(7.5),
          damage: fx(7.0),
          angle: fx(110),
          baseKnockback: fx(0),
          fixedKnockback: fx(80),
          knockbackGrowth: fx(100),
          reverse: true,
          // `game_specials` ids 0-1: `ATTACK_SETOFF_KIND_OFF`; SmashWiki "Priority" lists the
          // Cape (Plan 5, Task 13c).
          transcendent: true,
        },
        {
          id: 1,
          startFrame: 12,
          endFrame: 14,
          x: fx(5.0),
          y: fx(6.7),
          radius: fx(5.0),
          damage: fx(7.0),
          angle: fx(110),
          baseKnockback: fx(0),
          fixedKnockback: fx(80),
          knockbackGrowth: fx(100),
          reverse: true,
          // `game_specials`: `ATTACK_SETOFF_KIND_OFF` (Plan 5, Task 13c).
          transcendent: true,
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Super Jump Punch",
      // Plan 5, Task 13b: SmashWiki "Mario (SSBU)/Up special"
      // (https://www.ssbwiki.com/Mario_(SSBU)/Up_special), "Animation length 37"
      // (was 55, so his helplessness started late).
      totalFrames: 37,
      // The rise is the animation's, which no source publishes: UNVERIFIED, the
      // legacy 2.9 a frame, on frames 4-18, so that it tops out with the page's
      // "Hit 7 17-18", the launcher at the top of the punch (was 4-16). It ends with
      // no upward speed handed on (`endSpeed`; UNVERIFIED: SSBU moves him by the
      // animation's translation, which eases out at the top of the punch): about 47
      // up. Handing the full 2.9 on, as before, rose him 81, half again Samus's
      // published Screw Attack (about 54) where SmashWiki "Mario (SSBU)"
      // (https://www.ssbwiki.com/Mario_(SSBU)) calls his distance "merely average"
      // and "Samus (SSBU)" hers "only average". The stick read on frame 4 aims it
      // (UNVERIFIED: the page publishes no frame the angle is decided on; 4 is the
      // rise's first, Task 13b review's M-1).
      momentum: [{ frame: 4, x: fx(0.5), y: fx(2.9), hold: 15, aimAt: 4, endSpeed: { y: 0 } }],
      // "Stick sensitivity to angle 0.5", "Maximum angle deviation 12°": a full
      // tilt turns the rise 12° toward its side (UNVERIFIED that a soft one turns it half).
      aim: { kind: "tilt", max: fx(12) },
      // "Optional reverse 3"; "To B-reverse it, the control stick has to be held
      // backward on frame 3" ("Stick sensitivity to reverse 0.3": any tilt back).
      turn: [3, 3],
      // "Grounded height multiplier 1.1", "Aerial height multiplier 1.08".
      rise: { ground: fx(1.1), air: fx(1.08) },
      // "Air speed multiplier on startup 0.67": UNVERIFIED reading, his speed
      // coming in ×0.67 on the move's first frame.
      launch: { vxMul: fx(0.67) },
      // Ends helpless (Plan 5, Task 4b): SmashWiki "Mario (SSBU)/Up special"
      // (https://www.ssbwiki.com/Mario_(SSBU)/Up_special): "Helplessness air speed
      // multiplier 0.6", "Landing lag 30 frames" (the landing's "Interruptible 31";
      // UltimateFrameData's landing lag 30, https://ultimateframedata.com/mario).
      helpless: { landingLag: 30, airSpeed: fx(0.6) },
      hitboxes: [
        {
          // Coins. The first hit is the only one that matters for damage; the
          // rest are 0.6% each with set knockback to hold the victim in the
          // rising column, then a 3% launcher at the top.
          id: 0,
          startFrame: 3,
          endFrame: 6,
          x: fx(0),
          y: fx(6.5),
          radius: fx(4.0),
          damage: fx(5.0),
          angle: fx(86),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(150),
          // Set weight, as every coin hit of `game_specialhi` (generated/mario.ts; Plan 3, Task 16b).
          setWeight: true,
          effect: "normal",
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 16,
          x: fx(0),
          y: fx(8.5),
          radius: fx(3.8),
          damage: fx(0.6),
          angle: fx(92),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(170),
          // Set weight, as every coin hit of `game_specialhi` (generated/mario.ts; Plan 3, Task 16b).
          setWeight: true,
        },
        {
          id: 2,
          startFrame: 17,
          endFrame: 18,
          x: fx(0),
          y: fx(11.5),
          radius: fx(9.0),
          damage: fx(3.0),
          angle: fx(60),
          baseKnockback: fx(50),
          knockbackGrowth: fx(145),
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "F.L.U.D.D.",
      // Deals no damage at all — it charges, then pumps water that pushes (Plan
      // 5, Task 6). SmashWiki "Mario (SSBU)/Down special"
      // (https://www.ssbwiki.com/Mario_(SSBU)/Down_special): "Charges between
      // 19-20", "Total charge time 80 frames"; on release, "Number of pumps shot
      // 7", "Delay between pumps 5 frames", pumps "21-32, 26-37, …, 51-62"
      // (from release "2-13, …, 32-43"), "Interruptible (from release) 68 (49)".
      // UltimateFrameData (https://ultimateframedata.com/mario): "Entering charge
      // state takes 19 frames"; "Down B, Fully Charged": startup 21, total 67, so
      // a stored full charge plays its entry and fires on reaching the loop.
      //
      // Store mode: SmashWiki "Charge" (https://www.ssbwiki.com/Charge) lists it
      // as an "Auto-charge special", shield-cancellable; "F.L.U.D.D."
      // (https://www.ssbwiki.com/F.L.U.D.D.): "pressing a shield button while
      // charging will cancel and save the charge", and "getting hit during
      // charging period will lose said charge". Published, not modelled: "Recoil
      // speed on release per charge frame 0.02" (Mario "will be pushed
      // backward"), and the heavier shoot animation from 70 charge frames.
      //
      // The move's own hitboxes stay empty, deliberately: everything it does,
      // the pumps do.
      totalFrames: 67,
      specialCharge: { mode: "store", frames: 80, loopFrame: 19, fromStore: { start: "entry", interruptible: 68 } },
      hitboxes: [],
      projectiles: [waterPump(21), waterPump(26), waterPump(31), waterPump(36), waterPump(41), waterPump(46), waterPump(51)],
    },

    grab: {
      slot: "grab",
      name: "Grab",
      totalFrames: 34,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(6.4),
          y: fx(6.6),
          radius: fx(3.3),
          damage: fx(0),
          angle: fx(0),
          baseKnockback: fx(0),
          knockbackGrowth: fx(0),
          grabbing: true,
        },
      ],
    },

    dashGrab: {
      slot: "dashGrab",
      name: "Dash Grab",
      totalFrames: 42,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(7.2),
          y: fx(6.6),
          radius: fx(3.3),
          damage: fx(0),
          angle: fx(0),
          baseKnockback: fx(0),
          knockbackGrowth: fx(0),
          grabbing: true,
        },
      ],
    },

    pummel: {
      slot: "pummel",
      name: "Pummel",
      totalFrames: 19,
      hitboxes: [
        {
          id: 0,
          startFrame: 1,
          endFrame: 1,
          x: fx(0),
          y: fx(10.0),
          radius: fx(5.0),
          damage: fx(1.3),
          angle: fx(361),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(30),
        },
      ],
    },

    fthrow: {
      slot: "fthrow",
      name: "Forward Throw",
      totalFrames: 27,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 13,
          x: fx(4.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(8.0),
          angle: fx(45),
          baseKnockback: fx(60),
          knockbackGrowth: fx(65),
        },
      ],
    },

    bthrow: {
      slot: "bthrow",
      name: "Back Throw",
      totalFrames: 59,
      // The launch below points forward: he turns round first, on frame 40
      // (`game_throwb`: `frame(40) … REVERSE_LR()`, rubendal SSBU Data Viewer
      // 13.0.1, https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json).
      turnAt: 40,
      hitboxes: [
        {
          // Three full spins before the release on frame 44, which is why it is
          // his hardest throw at 11% and also his most punishable whiff.
          id: 0,
          startFrame: 44,
          endFrame: 44,
          x: fx(-4.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(11.0),
          angle: fx(45),
          baseKnockback: fx(70),
          knockbackGrowth: fx(66),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 39,
      hitboxes: [
        {
          id: 0,
          startFrame: 18,
          endFrame: 18,
          x: fx(0),
          y: fx(8.0),
          radius: fx(3.0),
          damage: fx(7.0),
          angle: fx(90),
          baseKnockback: fx(70),
          knockbackGrowth: fx(72),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 39,
      hitboxes: [
        {
          // 5% and knockback growth 90 at a 68 degree angle: the lowest-damage
          // throw in his kit, and the one every Mario combo starts from.
          id: 0,
          startFrame: 18,
          endFrame: 18,
          x: fx(2.0),
          y: fx(1.0),
          radius: fx(3.0),
          damage: fx(5.0),
          angle: fx(68),
          baseKnockback: fx(40),
          knockbackGrowth: fx(90),
        },
      ],
    },
  },

  palette: {
    primary: "#E52521", // the shirt red, sampled from Ultimate's default
    secondary: "#3B5DC9", // dungarees blue
    accent: "#FFCC00", // buttons and the cap emblem
    skin: "#F5C396",
    outline: "#2A1810",
    alts: [
      { primary: "#F4D03F", secondary: "#4B3621", accent: "#FFFFFF" }, // Wario yellow
      { primary: "#1E7B3C", secondary: "#3B2C1E", accent: "#E8E8E8" }, // Fire green
      { primary: "#3B5DC9", secondary: "#F0F0F0", accent: "#E52521" }, // blue/white
      { primary: "#2B2B2B", secondary: "#5A5A5A", accent: "#C0C0C0" }, // builder grey
      { primary: "#E8A0BF", secondary: "#7B3F5E", accent: "#FFF2CC" }, // pink
    ],
  },

  blurb: "The baseline. Nothing he does is the best in the game, which is why everything he does works.",
};

/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const mario: FighterDef = withReferenceScripts(legacy, MARIO, ACTIVE_SCRIPT_SLOTS.mario);
