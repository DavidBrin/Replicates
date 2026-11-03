/**
 * Samus — fighter 04, the charge zoner.
 *
 * Everything about her is built around one button. Charge Shot takes 125 frames
 * to fill, can be charged in midair (new to Ultimate), is stored through
 * shields and dodges, and turns from a 5% poke into a 28% kill move that comes
 * out on frame 3. The whole matchup is the opponent deciding what to do about a
 * bar they cannot see.
 *
 * She is also the roster's only tether: the Grapple Beam grabs on frame 15
 * rather than frame 6, which is the price of the longest reach in the game.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { SAMUS } from "./acmd/generated/samus";
import { finalBox } from "./finalKit";
import { FIGHTER_PARAMS } from "./params";

/** UNVERIFIED: hurtbox dimensions are unpublished. The Power Suit is bulky —
 * wider than Link at a similar height. */
const HEIGHT = 12.2;
const HALF_WIDTH = 2.3;

/** The hand-authored moveset; `samus` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "samus",
  name: "Samus",
  series: "Metroid",
  number: 4,

  attributes: {
    weight: 108,
    walkSpeed: fx(1.115),
    initialDashSpeed: fx(1.87),
    runSpeed: fx(1.654),
    airSpeed: fx(1.103),
    // Air acceleration base 0.04 is unusually high — four times most of the
    // cast — which is why she drifts so freely while charging.
    airAccelBase: fx(0.04),
    airAccelAdditional: fx(0.05),
    gravity: fx(0.075),
    fallSpeed: fx(1.33),
    fastFallSpeed: fx(2.128),
    // 0.082 traction, among the lowest on the roster: she slides.
    traction: fx(0.082),
    // v = sqrt(2gh): full hop 37 at gravity 0.075 → 2.356.
    fullHopVelocity: fx(2.356),
    shortHopVelocity: fx(1.643),
    airJumpVelocity: fx(2.356),
    jumps: 2,
    canWallJump: true,
    // SmashWiki "Wall jump" (https://www.ssbwiki.com/Wall_jump), "Wall jump height
    // rankings", Ultimate: 28.35 (revision 2065734, 2026-10-25, the corrected table).
    wallJumpHeight: fx(28.35),
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
    // Air dodges (Plan 3, Task 20c): fudgepop01/amiibo_research
    // `fighter_param_motion.xml` @523374aa, the `fighter_kind_samus` entry (L359):
    // L380 `escape_air_stiff_frame`, L376-377 `escape_air_hit_xlu_frame` /
    // `_hit_normal_frame`, L468-470 `escape_air_slide_stiff_frame` / `_u_` /
    // `_d_`, L383-384 `escape_air_slide_hit_xlu_frame` / `_hit_normal_frame`.
    airDodge: {
      neutralFrames: 57,
      neutralIntangible: [3, 27],
      sideFrames: 95,
      upFrames: 129,
      downFrames: 79,
      directionalIntangible: [3, 19],
    },
    // Spot dodge and rolls (Plan 3 final wave): UltimateFrameData,
    // https://ultimateframedata.com/samus, "Dodges / Rolls": each "Total frames"
    // and "Intangible on frame a-b", fresh. The spot dodge is the second of
    // UFD's "21/26"; the first is its cancel, not modelled (`GroundDodgeAttributes`).
    groundDodge: {
      spotDodge: { frames: 26, intangible: [3, 17] },
      forwardRoll: { frames: 34, intangible: [4, 18] },
      backRoll: { frames: 39, intangible: [5, 20] },
    },
  },

  params: FIGHTER_PARAMS.samus,

  moves: {
    // Samus has a two-hit jab. SmashWiki records `neutralcount=2` and there is
    // no third jab script in the game data.
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 17,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 4,
          x: fx(6.0),
          y: fx(7.5),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(10),
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Jab 2",
      totalFrames: 29,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 9,
          x: fx(7.0),
          y: fx(7.5),
          radius: fx(3.5),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(95),
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 33,
      hitboxes: [
        {
          // Angleable, and the *far* end is the strong one — 10% at the foot
          // against 8% at the body. Lower id wins, so the outer hit takes
          // priority when both would connect.
          id: 0,
          startFrame: 8,
          endFrame: 10,
          x: fx(9.0),
          y: fx(6.5),
          radius: fx(3.2),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 8,
          endFrame: 10,
          x: fx(4.5),
          y: fx(6.5),
          radius: fx(3.2),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(80),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 39,
      hitboxes: [
        {
          // Angle 270 against a *grounded* victim — an up tilt that meteors,
          // which reads as a bug until you watch the animation: she kicks over
          // her head and slams downward on the way through.
          id: 0,
          startFrame: 15,
          endFrame: 18,
          x: fx(0),
          y: fx(14.0),
          radius: fx(5.0),
          damage: fx(13.0),
          angle: fx(270),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
          meteor: true,
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 44,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(7.0),
          y: fx(1.5),
          radius: fx(3.5),
          damage: fx(12.0),
          angle: fx(75),
          baseKnockback: fx(80),
          knockbackGrowth: fx(65),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 41,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 13,
          x: fx(6.0),
          y: fx(5.0),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(55),
          baseKnockback: fx(80),
          knockbackGrowth: fx(90),
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 18,
          x: fx(6.0),
          y: fx(5.0),
          radius: fx(3.5),
          damage: fx(6.0),
          angle: fx(55),
          baseKnockback: fx(80),
          knockbackGrowth: fx(90),
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 48,
      chargeable: true,
      hitboxes: [
        {
          // The blast at the muzzle is the strong half (14%); the arm cannon
          // itself does 12% but with growth 112 rather than 100.
          id: 0,
          startFrame: 10,
          endFrame: 11,
          x: fx(10.0),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(14.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
          effect: "fire",
        },
        {
          id: 1,
          startFrame: 10,
          endFrame: 11,
          x: fx(5.5),
          y: fx(7.0),
          radius: fx(3.5),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(16),
          knockbackGrowth: fx(112),
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 56,
      chargeable: true,
      // Held on the published first frame of its "Charges between 6-7" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Samus (SSBU)/Up smash",
      // https://www.ssbwiki.com/Samus_(SSBU)/Up_smash, revision 1705188).
      smashHold: 6,
      hitboxes: [
        // Five hits of Screw Attack over the head — four weak ones that hold,
        // then a 6% launcher with growth 162.
        {
          id: 0,
          startFrame: 11,
          endFrame: 12,
          x: fx(0),
          y: fx(12.0),
          radius: fx(4.5),
          damage: fx(3.0),
          angle: fx(100),
          baseKnockback: fx(60),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 16,
          x: fx(0),
          y: fx(13.0),
          radius: fx(4.5),
          damage: fx(3.0),
          angle: fx(130),
          baseKnockback: fx(30),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 2,
          startFrame: 19,
          endFrame: 20,
          x: fx(0),
          y: fx(13.0),
          radius: fx(4.5),
          damage: fx(3.0),
          angle: fx(130),
          baseKnockback: fx(40),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 3,
          startFrame: 23,
          endFrame: 24,
          x: fx(0),
          y: fx(13.0),
          radius: fx(4.5),
          damage: fx(3.0),
          angle: fx(120),
          baseKnockback: fx(30),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 4,
          startFrame: 27,
          endFrame: 28,
          x: fx(0),
          y: fx(13.5),
          radius: fx(5.0),
          damage: fx(6.0),
          angle: fx(80),
          baseKnockback: fx(50),
          knockbackGrowth: fx(162),
          effect: "electric",
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 44,
      chargeable: true,
      hitboxes: [
        {
          // Both halves fire at 30° — a semi-spike sweep, and one of the best
          // edgeguarding tools on the roster.
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(7.5),
          y: fx(1.5),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(30),
          baseKnockback: fx(70),
          knockbackGrowth: fx(70),
        },
        {
          id: 1,
          startFrame: 17,
          endFrame: 18,
          x: fx(-7.5),
          y: fx(1.5),
          radius: fx(4.0),
          damage: fx(12.0),
          angle: fx(30),
          baseKnockback: fx(70),
          knockbackGrowth: fx(68),
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 45,
      landingLag: 9,
      autoCancelBefore: 7,
      autoCancelAfter: 35,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 11,
          x: fx(5.0),
          y: fx(5.5),
          radius: fx(4.5),
          damage: fx(10.0),
          angle: fx(32),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 15,
          x: fx(5.0),
          y: fx(5.5),
          radius: fx(4.0),
          damage: fx(9.0),
          angle: fx(45),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
        },
        {
          id: 2,
          startFrame: 16,
          endFrame: 22,
          x: fx(5.0),
          y: fx(5.5),
          radius: fx(3.8),
          damage: fx(8.0),
          angle: fx(45),
          baseKnockback: fx(10),
          knockbackGrowth: fx(98),
        },
      ],
    },

    // Grab aerial, Grapple Beam (Plan 6, Task 8): SmashWiki "Samus (SSBU)/Grab aerial"
    // (https://www.ssbwiki.com/Samus_(SSBU)/Grab_aerial): hit 1 frames 8-15, hit 2 16-19,
    // "Interruptible 60", "Animation length 59", landing "Interruptible 9"; rubendal Data
    // Viewer 13.0.1 `game_aircatch`: hit 1 2.5%, angle 45, KBG 30, BKB 30, size 3.0,
    // `Part=0`; hit 2 4.0%, angle 45, KBG 100, BKB 30, size 5.0, `Part=1`; both
    // `collision_attr_elec`, both on the `throw` bone at (0, 0, 0). UNVERIFIED: the boxes'
    // place, the beam's tip, which the bake does not place: the legacy grab's tip stands
    // in. UNVERIFIED too: it is no aerial for the short hop's 0.85 (`isAerialSlot`). Not
    // modelled (decision D3): the tether recovery on frames 2-4.
    airGrab: {
      slot: "airGrab",
      name: "Grapple Beam (aerial)",
      totalFrames: 59,
      landingLag: 8,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 15,
          x: fx(14.0),
          y: fx(6.5),
          radius: fx(3.0),
          damage: fx(2.5),
          angle: fx(45),
          baseKnockback: fx(30),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 16,
          endFrame: 19,
          x: fx(14.0),
          y: fx(6.5),
          radius: fx(5.0),
          damage: fx(4.0),
          angle: fx(45),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          effect: "electric",
          part: 1,
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 59,
      landingLag: 14,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(6.0),
          y: fx(7.0),
          radius: fx(3.5),
          damage: fx(3.0),
          angle: fx(367),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(25),
        },
        {
          id: 1,
          startFrame: 12,
          endFrame: 25,
          x: fx(6.5),
          y: fx(7.0),
          radius: fx(3.5),
          damage: fx(1.6),
          angle: fx(367),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(35),
        },
        {
          id: 2,
          startFrame: 30,
          endFrame: 31,
          x: fx(6.5),
          y: fx(7.0),
          radius: fx(4.0),
          damage: fx(5.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(140),
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 41,
      landingLag: 14,
      // UNVERIFIED: no autocancel window. The figure in circulation is
      // "frames 1-8 and 42+", but this move's FAF is 41 — a window opening on
      // 42 is one the move never reaches, so the two numbers cannot both be
      // right. Ultimate Frame Data's own autocancel field for this move lists
      // hop types (SH, FH, FHFF) rather than frames, so there is nothing to
      // resolve the contradiction against. Left absent rather than guessed.
      hitboxes: [
        {
          // 14% on the knee, and her most reliable KO aerial.
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(-8.0),
          y: fx(6.0),
          radius: fx(3.5),
          damage: fx(14.0),
          angle: fx(361),
          baseKnockback: fx(42),
          knockbackGrowth: fx(98),
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 10,
          x: fx(-4.5),
          y: fx(6.0),
          radius: fx(3.5),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(98),
        },
        {
          id: 2,
          startFrame: 11,
          endFrame: 14,
          x: fx(-8.0),
          y: fx(6.0),
          radius: fx(3.5),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(90),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 39,
      landingLag: 18,
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 5,
          x: fx(0),
          y: fx(13.5),
          radius: fx(4.0),
          damage: fx(3.0),
          angle: fx(84),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(90),
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 14,
          x: fx(0),
          y: fx(13.5),
          radius: fx(4.0),
          damage: fx(1.3),
          angle: fx(84),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(90),
        },
        {
          id: 2,
          startFrame: 16,
          endFrame: 17,
          x: fx(0),
          y: fx(13.5),
          radius: fx(4.5),
          damage: fx(4.0),
          angle: fx(70),
          baseKnockback: fx(40),
          knockbackGrowth: fx(160),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 48,
      landingLag: 12,
      hitboxes: [
        {
          // The meteor is the *middle* of the move — frames 19-21 — with weaker
          // Sakurai-angle hits either side of it. Mistime it and you get 10%
          // and a horizontal launch instead of a stock.
          id: 0,
          startFrame: 19,
          endFrame: 21,
          x: fx(1.0),
          y: fx(-2.0),
          radius: fx(4.5),
          damage: fx(14.0),
          angle: fx(270),
          baseKnockback: fx(25),
          knockbackGrowth: fx(85),
          meteor: true,
        },
        {
          id: 1,
          startFrame: 17,
          endFrame: 18,
          x: fx(1.0),
          y: fx(-2.0),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(100),
        },
        {
          id: 2,
          startFrame: 22,
          endFrame: 23,
          x: fx(1.0),
          y: fx(-2.0),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(100),
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Charge Shot",
      totalFrames: 44,
      // Store mode (Plan 5): 13 frames to enter the charge state, then 112
      // charge frames to full — SmashWiki "Samus (SSBU)/Neutral special"
      // (https://www.ssbwiki.com/Samus_(SSBU)/Neutral_special): "Total charge
      // time 112 frames"; UltimateFrameData's "125 frames to reach full charge"
      // (https://ultimateframedata.com/samus) counts the 13 as well. A shield,
      // roll, spot dodge, jump or air dodge puts the charge away; B fires it,
      // the shot leaving 3 frames after release (hitbox 16 = 13 + 3),
      // interruptible 45 (32).
      //
      // Fully charged, from the press: "Hitbox 16-75", "Interruptible (grounded)
      // 61" (the same page; UltimateFrameData "Charge Shot, Full Charge":
      // startup 16). So a stored full charge plays the 13 entry frames and
      // fires on reaching the loop. Published, not modelled: the full charge's
      // aerial "Interruptible 46", and the 4 frames of lag a charge cancel takes
      // ("Charge-canceling the move incurs 4 frames of lag before the selected
      // action").
      //
      // A flinch while charging loses the WHOLE charge, a stored one brought
      // back out included (SmashWiki "Flinch", https://www.ssbwiki.com/Flinch:
      // "regardless of whether any charge had been saved previously"; "Charge
      // Shot": "she will drop all the stored charge"). A stored charge is lost
      // with the stock too: SmashWiki "Charge" (https://www.ssbwiki.com/Charge)
      // notes surviving a KO only for Oil Panic and Wario Waft.
      // Fully charged, the shot is `special_n_f_max` (rubendal 13.0.1 `game_specialnfiremax`:
      // CancelFrame 48, so 47 frames, shooting on its frame 3), played from the loop frame,
      // after the 13 entry frames (`special_n_s`, CancelFrame 14): 13 + 48 = 61 (Plan 6, Task 20).
      specialCharge: { mode: "store", frames: 112, loopFrame: 13, fromStore: { start: "entry", interruptible: 61, motion: "special_n_f_max", fullFrames: 47 } },
      hitboxes: [],
      projectiles: [
        {
          // samus_cshot `Shoot` (rubendal Data Viewer 13.0.1): ATTACK 0 is the
          // uncharged shot, ATTACK 1 the full charge, and
          // `attack(MA_MSC_CMD_ATTACK_SET_LERP, 0, 1)` interpolates between
          // them by charge. SmashWiki: damage 5 + 23·c/112, BK 14 + 32·c/112,
          // KS 42 + 8·c/112, radius 1.9 + 6.1·c/112; speed 1.6 → 3.3;
          // lifetime 60. UNVERIFIED: that the speed is linear between those two
          // (SmashWiki gives only the ends).
          id: "chargeShot",
          spawnFrame: 16,
          offsetX: fx(8.0),
          offsetY: fx(7.0),
          vx: fx(1.6),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 60,
          destroyOnHit: true,
          charged: {
            vx: fx(3.3),
            hitbox: { damage: fx(28.0), angle: fx(40), baseKnockback: fx(46), knockbackGrowth: fx(50), radius: fx(8.0) },
          },
          visual: "energy",
          // samus_cshot `Shoot`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 59,
            x: fx(0),
            y: fx(0),
            radius: fx(1.9),
            damage: fx(5.0),
            angle: fx(361),
            baseKnockback: fx(14),
            knockbackGrowth: fx(42),
            effect: "electric",
            // samus_cshot `Shoot`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON`, so it clanks
            // (Plan 5, Task 13c; SmashWiki "Priority" names the full Charge Shot).
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Missile",
      totalFrames: 54,
      // Two variants off one input. A *tilt* fires the homing missile below —
      // 8% at a flat 0 degrees, living 120 frames (SmashWiki "Samus
      // (SSBU)/Side special", https://www.ssbwiki.com/Samus_(SSBU)/Side_special:
      // Homing Missile "Lifetime 120 frames", "Missile 18-137"). A *smash* fires the
      // Super Missile, a move of its own (`sideBSmash`, Plan 5, Task 13d). Both are
      // reflectable.
      //
      // UNMODELLED: the homing. `ProjectileDef` has no steering field, so what
      // is encoded is a straight missile at the homing variant's damage. That
      // is a deliberate simplification, not a transcription slip. Published, not
      // modelled (Task 13d): its "Initial speed 1.15" and deceleration (the 1.5
      // below is the legacy table's), its row's radius 2.4 (the 3.0 below is the
      // legacy table's), "Interruptible (aerial) 60", "Missile X offset 1u" (the
      // offsets below are the legacy table's), its row's shield damage 1.0 and its
      // angle, 0° but 32° at 120 knockback or more, and both missiles' aerial
      // "Horizontal speed divisor 2", "Air friction 0.0025" and movement "enabled
      // starting on frame 35".
      //
      // The smash input (Plan 5, Task 13d): B pressed within "Smash input window 5
      // frames" of a smash flick (the page's move parameters) fires the Super
      // Missile: the same 5 as the smash attacks' window here (`SMASH_INPUT_WINDOW`).
      smashInput: { within: 5, slot: "sideBSmash" },
      hitboxes: [],
      projectiles: [
        {
          id: "missile",
          spawnFrame: 18,
          offsetX: fx(8.0),
          offsetY: fx(6.5),
          vx: fx(1.5),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 120,
          destroyOnHit: true,
          // "Maximum Homing Missiles at a time 2" (the page's move parameters; Task 13d).
          maxOut: 2,
          visual: "missile",
          // samus_missile `Homing`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 119,
            x: fx(0),
            y: fx(0),
            radius: fx(3.0),
            damage: fx(8.0),
            angle: fx(0),
            baseKnockback: fx(26),
            knockbackGrowth: fx(25),
            effect: "fire",
            // samus_missile `Homing`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON` (Plan 5, Task 13c).
          },
        },
      ],
    },

    sideBSmash: {
      slot: "sideBSmash",
      name: "Super Missile",
      // Plan 5, Task 13d (ruling P5-R29): the smash-input side special. SmashWiki
      // "Samus (SSBU)/Side special" (https://www.ssbwiki.com/Samus_(SSBU)/Side_special,
      // revision 1708939): "Super Missile 21-96", "Interruptible (grounded) 58",
      // "Interruptible (aerial) 62" (its `game_specialairs` runs FT_MOTION_RATE 2 from
      // 58 to its CancelFrame 60: 62; UltimateFrameData's "57/59" counts the air's 59).
      // Its script is `game_specials` (rubendal 13.0.1: `special_s`, the weapon flag on
      // 21, CancelFrame 58), its own motion and animation in the game.
      // UltimateFrameData (https://ultimateframedata.com/samus), "Side B (Super
      // Missle)": "Landing lag 30", where the Homing Missile has none.
      totalFrames: 57,
      aerialTotalFrames: 61,
      aerialLandingLag: 30,
      hitboxes: [],
      projectiles: [
        {
          // samus_supermissile: it waits, then flies straight. The page's Super
          // Missile parameters: "Initial speed 0.18", "Period before accelerating 26
          // frames", "Lifetime upon accelerating 50 frames" (26 + 50 = 76, "21-96"),
          // "Acceleration 0.16", "Maximum speed 4.2"; its row, `Ready` and `Straight`
          // alike: 12.0%, 65°, BK 50, KS 65, radius 2.5, flame. UltimateFrameData's
          // "lasts until frame 87" and "21—70" disagree with the page's 76 frames;
          // the page's parameters are followed. UNVERIFIED: the spawn offset, the
          // Homing Missile's legacy one (the page's "Missile X offset 1u" names no
          // point it is measured from).
          // Published, not modelled: "Rotation speed 2", its shield damage 5.
          id: "superMissile",
          spawnFrame: 21,
          offsetX: fx(8.0),
          offsetY: fx(6.5),
          vx: fx(0.18),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 76,
          accelerate: { after: 26, perFrame: fx(0.16), maxSpeed: fx(4.2) },
          destroyOnHit: true,
          // "Maximum Super Missiles at a time 1".
          maxOut: 1,
          visual: "missile",
          // samus_supermissile `Ready`, `Straight`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 75,
            x: fx(0),
            y: fx(0),
            radius: fx(2.5),
            damage: fx(12.0),
            angle: fx(65),
            baseKnockback: fx(50),
            knockbackGrowth: fx(65),
            effect: "fire",
            // samus_supermissile `Ready`, `Straight`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON`.
          },
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Screw Attack",
      // Plan 5, Task 13b: SmashWiki "Samus (SSBU)/Up special"
      // (https://www.ssbwiki.com/Samus_(SSBU)/Up_special): grounded "Animation length
      // 38", aerial 47 (was 56 for both). The rise is published physics, not a
      // scripted window: "Initial grounded speed 0.35 (horizontal), 2.8 (vertical)"
      // under her own gravity, about 53 up (the legacy window rose her 100), steered
      // by "Air acceleration 0.017" up to "Air speed 0.57". UNVERIFIED: the aerial
      // one's launch, unpublished, is the grounded one's.
      totalFrames: 38,
      fromAir: { totalFrames: 47 },
      launch: { vx: fx(0.35), vy: fx(2.8) },
      phases: [{ from: 1, air: { add: fx(0.017), mul: 0, speed: fx(0.57) } }],
      // "Stick sensitivity to reverse 0.25": held back, the move turns her round.
      // UNVERIFIED window: no frame is published; SmashWiki "B-reversing"
      // (https://www.ssbwiki.com/B-reversing): in Ultimate "the direction input must
      // be within 4 frames of the special input", so frames 1-4.
      turn: [1, 4],
      // Ends helpless (Plan 5, Task 4b): SmashWiki "Samus (SSBU)/Up special"
      // (https://www.ssbwiki.com/Samus_(SSBU)/Up_special): "Landing lag 24 frames"
      // (the landing's "Interruptible 25"; UltimateFrameData's 24,
      // https://ultimateframedata.com/samus), "Helplessness air speed multiplier 0.66".
      helpless: { landingLag: 24, airSpeed: fx(0.66) },
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(0),
          y: fx(7.0),
          radius: fx(5.0),
          damage: fx(3.0),
          angle: fx(92),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(200),
          // Set weight: `game_specialhi` (generated/samus.ts; Plan 3, Task 16b).
          setWeight: true,
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 24,
          x: fx(0),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(1.0),
          angle: fx(92),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(180),
          // Set weight: `game_specialhi` (generated/samus.ts; Plan 3, Task 16b).
          setWeight: true,
          effect: "electric",
        },
        {
          id: 2,
          startFrame: 25,
          endFrame: 26,
          x: fx(0),
          y: fx(7.0),
          radius: fx(5.0),
          damage: fx(2.0),
          angle: fx(70),
          baseKnockback: fx(56),
          knockbackGrowth: fx(190),
          effect: "electric",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Bomb",
      totalFrames: 47,
      // She curls into Morph Ball and lays a bomb, generated on frame 11, which
      // hops up, falls, bounces, settles, and explodes 72 frames later, on frames
      // 83-100 (SmashWiki "Samus (SSBU)/Down special",
      // https://www.ssbwiki.com/Samus_(SSBU)/Down_special: "Bomb generation 11",
      // "Maximum duration before exploding 72 frames", "Explosion (early, mid,
      // late) 83-94, 95-97, 98-100"; Plan 5, Task 6 fix round 1). Its flight is
      // the same page's Bomb parameters (Plan 5, Task 13c): "Initial vertical
      // speed 0.5", "Gravity 0.03", "Falling speed 1.2", "Speed multiplier when
      // bouncing off ground 0.6", "Minimum speed to bounce off ground 0.2", and it
      // leaves "Bomb Y offset 2" above her. Laid on the floor it bounces on frames
      // 37, 61 and 75 of its life, goes off at 72 in a hop under a unit high, and
      // rests from 83 (`projectiles.test.ts`). UNVERIFIED: the 1 forward; and the
      // minimum bounce speed read as the speed it lands at (read as the speed after
      // the ×0.6, it would rest from 75; fix round 1). The early, mid and late blasts
      // are its `stages` (Plan 6, Task 15). Published, not modelled: the "Detection
      // hitbox 33-82" that sets it off early, and its "Rotation speed". The blast also
      // pops Samus herself upward, which is a recovery mixup rather than a side effect.
      //
      // The 5% explosion is what the projectile carries; brushing the bomb
      // itself before it goes off is a separate 4% at the Sakurai angle.
      hitboxes: [],
      projectiles: [
        {
          id: "bomb",
          spawnFrame: 11,
          offsetX: fx(1.0),
          offsetY: fx(2.0),
          vx: fx(0),
          vy: fx(0.5),
          gravity: fx(0.03),
          maxFall: fx(1.2),
          lifetime: 90,
          destroyOnHit: true,
          settle: { restitution: fx(0.6), minSpeed: fx(0.2) },
          visual: "bomb",
          // samus_bomb `Fall`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            // Live only at the end of its life, frames 83-100: the explosion.
            id: 0,
            startFrame: 72,
            endFrame: 89,
            x: fx(0),
            y: fx(0),
            // The early blast's size (Plan 6, Task 15: the page's 7.38).
            radius: fx(7.38),
            damage: fx(5.0),
            angle: fx(60),
            baseKnockback: fx(40),
            knockbackGrowth: fx(30),
            effect: "fire",
            // samus_bomb `BurstAttack`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON` (Plan 5, Task 13c).
          },
          // The blast shrinks: rubendal 13.0.1 `samus_bomb` `BurstAttack` sets Size 4.9 after
          // 12 frames and 2.5 after 3 more ("Explosion (early, mid, late) 83-94, 95-97,
          // 98-100"); ages 84 and 87 (Plan 6, Task 15).
          stages: [
            { from: 84, hitbox: { radius: fx(4.9) } },
            { from: 87, hitbox: { radius: fx(2.5) } },
          ],
        },
      ],
    },

    grab: {
      slot: "grab",
      name: "Grapple Beam",
      totalFrames: 59,
      // The tether. Frame 15 against everyone else's frame 6, and FAF 59
      // against their 34 — this is not a punish tool, it is a zoning tool that
      // happens to grab. The same beam is her Z-air and her tether recovery.
      hitboxes: [
        {
          id: 0,
          startFrame: 15,
          endFrame: 22,
          x: fx(14.0),
          y: fx(6.5),
          radius: fx(2.5),
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
      name: "Dash Grapple",
      totalFrames: 67,
      hitboxes: [
        {
          id: 0,
          startFrame: 17,
          endFrame: 24,
          x: fx(15.0),
          y: fx(6.5),
          radius: fx(2.5),
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
          y: fx(9.0),
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
      totalFrames: 41,
      hitboxes: [
        {
          id: 0,
          startFrame: 16,
          endFrame: 16,
          x: fx(4.0),
          y: fx(6.5),
          radius: fx(3.0),
          damage: fx(10.0),
          angle: fx(42),
          baseKnockback: fx(60),
          knockbackGrowth: fx(55),
        },
      ],
    },

    bthrow: {
      slot: "bthrow",
      name: "Back Throw",
      totalFrames: 49,
      // The launch below points forward: she turns round on frame 12, the frame
      // it lands (`game_throwb`: `frame(12) REVERSE_LR() ATK_HIT_ABS(…)`, rubendal
      // SSBU Data Viewer 13.0.1,
      // https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Samus/data.json).
      turnAt: 12,
      hitboxes: [
        {
          id: 0,
          startFrame: 12,
          endFrame: 12,
          x: fx(-4.0),
          y: fx(6.5),
          radius: fx(3.0),
          damage: fx(10.0),
          angle: fx(40),
          baseKnockback: fx(60),
          knockbackGrowth: fx(55),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 41,
      hitboxes: [
        {
          id: 0,
          startFrame: 16,
          endFrame: 16,
          x: fx(0),
          y: fx(9.0),
          radius: fx(3.0),
          damage: fx(7.0),
          angle: fx(90),
          baseKnockback: fx(80),
          knockbackGrowth: fx(80),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 37,
      hitboxes: [
        {
          id: 0,
          startFrame: 21,
          endFrame: 21,
          x: fx(2.0),
          y: fx(1.5),
          radius: fx(3.0),
          damage: fx(8.0),
          angle: fx(74),
          baseKnockback: fx(60),
          knockbackGrowth: fx(75),
        },
      ],
    },

    // Plan 5, Task 16 — Zero Laser. Sources: rubendal Data Viewer 13.0.1
    // (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Samus/data.json):
    // `game_finalstart` (the charge), `game_final` (the muzzle), the laser article's
    // `samus_laser` `Shoot` (the beam and its end) and `samus_laser2` `Upper` and `Lower`
    // (the fringe beams), and final_end's CancelFrame 47; SmashWiki "Zero Laser"
    // (https://www.ssbwiki.com/Zero_Laser): "the attack repeatedly hits any foes caught
    // in its blast", and the game's tips, "Before the laser fires, it'll pull in nearby
    // fighters a little bit" and "Fighters are drawn to the center"; SmashWiki "Final
    // Smash" (https://www.ssbwiki.com/Final_Smash): Final Smashes "make the user fully
    // intangible". Not a cinematic: it traps nobody.
    // - The start, `game_finalstart` (fix round 1, ruling R-T16c): on 48-68, a 1%
    //   electric box, angle 18, KBG 100, FKB 12, radius 10, 17 ahead and 13 up, hitlag
    //   ×0 (its `Hitlag=0.0`, with `DisableHitlag=false`), `Rehit=10`; and two 0% pulls,
    //   FKB 30, flinchless, `DisableHitlag=true` (the start's only boxes that set it):
    //   18° at radius 20, 15 behind, and 366° at radius 30, 17 ahead,
    //   loaded at 367 (ruling P5-R18's stand-in; `windboxPush`). Each pull spans 48-68 and
    //   keeps the swing's record, the charge's `Part=0`, so it pushes on its `Rehit=10`:
    //   on 48, 58 and 68 for a fighter the charge does not reach. One the charge reaches
    //   shares that record with it, so each of the three frames goes to one box or the
    //   other (the beams lab's Donkey Kong: charged on 48, pulled on 58, charged on 68;
    //   Plan 6, Task 14). `clear_all` on 69. UNVERIFIED: the start's length, its last
    //   scripted event (69; `final_start` publishes no CancelFrame).
    // - The muzzle, `game_final`, from the move's 70 (the laser's frame f is the move's
    //   69 + f): 1%, angle 20, KBG 100, FKB 22, radius 13, 15 up and 20 ahead on `top`,
    //   hitlag ×0, ATTACK_SETOFF_KIND_OFF, `Rehit=8`, on 1-7; `clear_all` on 8, then 2%,
    //   radius 15, `Rehit=8`, on 8-11.
    // - The beam, `Shoot` from 12, its record cleared there (the laser, an article, keeps
    //   its own): 1.5%, angle 20, KBG 100, FKB 16, radius 5, hitlag ×1, OFF, `Rehit=10`,
    //   for 128 frames (12-139); then, its record cleared on 140, its end, 5.5%, angle
    //   361, KBG 183, BKB 45, radius 11, hitlag ×1, OFF, electric, `set_force_reaction`,
    //   no rehit, for 8 (140-147). Every box is `Reflectable=false`.
    // - The fringe beams, `samus_laser2` (ruling R-T16e): 0.5% from 17, `Rehit=8`,
    //   radius 6, 14 above the beam at 325° (FKB 20) and 14 below at 45° (FKB 24), toward
    //   the centre; then on 140 each ends in a 2.5% blast, 45°, KBG 183, BKB 95, radius
    //   12.5, electric, `set_force_reaction`. Each is its own article with its own record:
    //   `Part` 1 and 2 here (`Hitbox.part`), so they land beside the main beam.
    //   SmashWiki's moveset row (Samus (SSBU)) is then their sum, box for box: "1% (charge
    //   loop), 0.5% (fringe loop), 1.5% (thruster, main loop), 2% (main loop; point blank,
    //   long range), 2.5% (contact blast), 8% (fringe blast), 10.5% (main blast)" are the
    //   charge, a fringe beam, the beam, 2 = 1.5 + 0.5 (and the 2% muzzle), a blast,
    //   8 = 5.5 + 2.5 and 10.5 = 5.5 + 2.5 + 2.5 (the review's inference, M3).
    // - The end: final_end's CancelFrame 47 from 217, 263 frames in all (UNVERIFIED: that
    //   it starts as the laser ends; `final` publishes no CancelFrame). In the air,
    //   `final_air_end`'s CancelFrame 64 under `FT_MOTION_RATE(FSM=0.5)` from 30 is
    //   30 + 34 × 0.5 = 47 too (`gameFrameOfMotion`'s convention), so no `airTotalFrames`
    //   (the review's M7).
    // - The beam's axis (fix round 4, ruling R-T16o): level at the muzzle's height, 15
    //   up, where `game_final`'s two muzzle boxes sit (`ATTACK(ID=0, Part=0,
    //   Bone=hash40("top"), Damage=1.0, …, Size=13.0, X=0.0, Y=15.0, Z=20.0, …)`, and on
    //   8 the same with `Damage=2.0`, `Size=15.0`); its end on the same axis; the fringe
    //   beams 14 above and below it, at 29 and 1, from `game_final`'s
    //   `WorkModule::set_float(14, FIGHTER_SAMUS_STATUS_FINAL_WORK_FLOAT_OY)` and
    //   `set_float(-14, …)` before each `generate_article(…_LASER2)`; their blasts with
    //   them. (It was 9, a stand-in, which ran the beam's top edge 4-5 below her cannon.)
    // UNVERIFIED: the beam's reach (150 units, 12 to 162 ahead), which the laser
    // article's status sets, unpublished, and that it runs level; the fringe beams'
    // reach along it.
    // UNVERIFIED (ruling R-T16f): the beam's hits freeze Samus, as her own move's hits
    // do. SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag): "Hitlag only affects the
    // object that deals the damage", which makes the laser article the frozen one; the
    // alternative is a victim-only freeze for `world` boxes, which keeps 263 real frames
    // and changes the hits' spacing. As her own move's, the beam's hits take the fresh-move
    // bonus; Mario Finale's flames and the Ancient Arrow take it too, as projectiles stamped
    // with their move's staleness as they are fired (Plan 5 final wave 2, ruling R-FW2b).
    // Not modelled: the laser's thruster box (1.5% behind its muzzle) and aiming the beam.
    // rubendal 13.0.1 `game_finalstart`: SLOW_OPPONENT(5, 50), the slowing of the other fighters
    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
    finalSmash: {
      slot: "finalSmash",
      name: "Zero Laser",
      totalFrames: 263,
      intangible: [1, 263],
      slowOpponent: { rate: 5, frames: 50 },
      rehit: 10,
      clearAt: [69, 77, 81, 209],
      final: { phase: "start" },
      // The drawing (Task 17 fix round 1, the controller's item 8): Samus holds her
      // charge pose through the start and the clip's strike, her firing recoil, lands
      // on the laser's first frame, 70, not on the charge box's 48. The game's own
      // `final_start` animation is not in this pipeline (the clips are authored), so
      // the start is held rather than played: `MoveDef.clipStrike`.
      clipStrike: 70,
      hitboxes: [
        finalBox(0, 48, 68, { damage: 1, angle: 18, kbg: 100, fkb: 12, radius: 10, x: 17, y: 13, hitlag: 0, transcendent: true, effect: "electric" }),
        // `game_finalstart`'s pulls, IDs 1 and 2 on 48-68 with the charge's `Part=0` and
        // `Rehit=10` (the move's `rehit`): a windbox keeps the swing's record (Plan 6, Task
        // 14). The front pull's angle stays 367 (the script's 366 is refused at load, D56).
        finalBox(1, 48, 68, { damage: 0, angle: 18, kbg: 100, fkb: 30, radius: 20, x: -15, y: 13, hitlag: 0, transcendent: true, windbox: true }),
        finalBox(4, 48, 68, { damage: 0, angle: 367, kbg: 100, fkb: 30, radius: 30, x: 17, y: 13, hitlag: 0, transcendent: true, windbox: true }),
        finalBox(7, 70, 76, { damage: 1, angle: 20, kbg: 100, fkb: 22, radius: 13, x: 20, y: 15, hitlag: 0, transcendent: true, rehit: 8 }),
        finalBox(8, 77, 80, { damage: 2, angle: 20, kbg: 100, fkb: 22, radius: 15, x: 20, y: 15, hitlag: 0, transcendent: true, rehit: 8 }),
        finalBox(9, 81, 208, { damage: 1.5, angle: 20, kbg: 100, fkb: 16, radius: 5, x: 12, y: 15, x2: 162, y2: 15, transcendent: true }),
        finalBox(10, 209, 216, { damage: 5.5, angle: 361, kbg: 183, bkb: 45, radius: 11, x: 12, y: 15, x2: 162, y2: 15, transcendent: true, effect: "electric", forceReaction: true, rehit: 0 }),
        finalBox(11, 86, 208, { damage: 0.5, angle: 325, kbg: 100, fkb: 20, radius: 6, x: 12, y: 29, x2: 162, y2: 29, transcendent: true, part: 1, rehit: 8 }),
        finalBox(12, 86, 208, { damage: 0.5, angle: 45, kbg: 100, fkb: 24, radius: 6, x: 12, y: 1, x2: 162, y2: 1, transcendent: true, part: 2, rehit: 8 }),
        finalBox(13, 209, 216, { damage: 2.5, angle: 45, kbg: 183, bkb: 95, radius: 12.5, x: 12, y: 29, x2: 162, y2: 29, transcendent: true, effect: "electric", forceReaction: true, part: 1, rehit: 0 }),
        finalBox(14, 209, 216, { damage: 2.5, angle: 45, kbg: 183, bkb: 95, radius: 12.5, x: 12, y: 1, x2: 162, y2: 1, transcendent: true, effect: "electric", forceReaction: true, part: 2, rehit: 0 }),
      ],
    },
  },

  palette: {
    // Power Suit orange, pushed brighter than the sampled shade so it reads
    // apart from Mario's red on one side and Fox's fur on the other — three
    // warm-hued fighters is the tightest corner of this roster's palette.
    primary: "#E8701A",
    secondary: "#C41E3A", // the shoulders and helmet crest
    accent: "#4EC3E0", // visor cyan
    skin: "#F0C9A0",
    outline: "#2A1405",
    alts: [
      { primary: "#1E7B3C", secondary: "#8B2FA0", accent: "#C8E85A" }, // Gravity green
      { primary: "#2B3F8C", secondary: "#5A2A8C", accent: "#7ED8F0" }, // Gravity blue
      { primary: "#1A1A1A", secondary: "#5A0A0A", accent: "#FF3030" }, // Dark Suit
      { primary: "#E8E8E8", secondary: "#B0B0B0", accent: "#4EC3E0" }, // Light Suit
      { primary: "#F0A0C0", secondary: "#C05080", accent: "#FFF0F5" }, // pink
    ],
  },

  blurb: "A bar the opponent cannot see, filling. Everything else she does is buying time for it.",
};

/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const samus: FighterDef = withReferenceScripts(legacy, SAMUS, ACTIVE_SCRIPT_SLOTS.samus);
