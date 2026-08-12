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

/** UNVERIFIED: hurtbox dimensions are unpublished. The Power Suit is bulky —
 * wider than Link at a similar height. */
const HEIGHT = 12.2;
const HALF_WIDTH = 2.3;

export const samus: FighterDef = {
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
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

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
          baseKnockback: fx(25),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          baseKnockback: fx(35),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          baseKnockback: fx(90),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          baseKnockback: fx(90),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
      chargeable: true,
      // PROJECTILE: a plasma ball spawned at the arm cannon and travelling flat
      // forward. 13 frames to enter the charge state, **125 frames to fill**,
      // then release on frame 3 (16 from a stored full charge). Damage runs
      // 5% → 28%, and the *angle changes with it*: uncharged fires at the
      // Sakurai angle with KBG 42, fully charged at a fixed 40 degrees with
      // KBG 50 and BKB 46. Charge is stored between uses and survives shielding
      // and dodging, and Ultimate is the first game where it can be charged in
      // midair. Being hit while charging loses the lot.
      //
      // UNVERIFIED: whether the charge survives a KO. It is widely believed to,
      // but SmashWiki's chargeable-specials table lists only Oil Panic and
      // Wario Waft as surviving a stock loss and gives Charge Shot no such
      // note, which implies it does not. Not asserted either way.
      //
      // The projectile below is the uncharged shot; `chargeScaling` 5.6 takes
      // its 5% to the 28% of a full charge.
      hitboxes: [],
      projectiles: [
        {
          id: "chargeShot",
          spawnFrame: 3,
          offsetX: fx(8.0),
          offsetY: fx(7.0),
          vx: fx(3.0),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 60,
          destroyOnHit: true,
          chargeScaling: fx(5.6),
          visual: "energy",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 60,
            x: fx(0),
            y: fx(0),
            radius: fx(2.5),
            damage: fx(5.0),
            angle: fx(361),
            baseKnockback: fx(14),
            knockbackGrowth: fx(42),
            effect: "electric",
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Missile",
      totalFrames: 54,
      // Two variants off one input. A *tilt* fires the homing missile below —
      // 8% at a flat 0 degrees, living 118 frames. A *smash* fires a Super
      // Missile: 12% at 65 degrees, faster and straight, which only starts
      // moving forward around frame 50, and that delay is exactly why she can
      // act before it arrives and follow it in. Both are reflectable.
      //
      // UNMODELLED: the homing. `ProjectileDef` has no steering field, so what
      // is encoded is a straight missile at the homing variant's damage. That
      // is a deliberate simplification, not a transcription slip.
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
          lifetime: 118,
          destroyOnHit: true,
          visual: "missile",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 118,
            x: fx(0),
            y: fx(0),
            radius: fx(3.0),
            damage: fx(8.0),
            angle: fx(0),
            baseKnockback: fx(26),
            knockbackGrowth: fx(25),
            effect: "fire",
            transcendent: true,
          },
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Screw Attack",
      totalFrames: 56,
      momentum: [{ frame: 4, x: fx(0.45), y: fx(2.9), hold: 16 }],
      landingLag: 24,
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
          baseKnockback: fx(200),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          baseKnockback: fx(180),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
      // falls, settles, and auto-detonates 83 frames later. The blast also pops
      // Samus herself upward, which is a recovery mixup rather than a side
      // effect.
      //
      // The 5% explosion is what the projectile carries; brushing the bomb
      // itself before it goes off is a separate 4% at the Sakurai angle.
      hitboxes: [],
      projectiles: [
        {
          id: "bomb",
          spawnFrame: 11,
          offsetX: fx(1.0),
          offsetY: fx(4.0),
          vx: fx(0),
          vy: fx(0),
          gravity: fx(0.08),
          lifetime: 83,
          destroyOnHit: true,
          bounces: 1,
          visual: "bomb",
          hitbox: {
            // Live only at the end of its life — that is the detonation.
            id: 0,
            startFrame: 82,
            endFrame: 83,
            x: fx(0),
            y: fx(0),
            radius: fx(5.0),
            damage: fx(5.0),
            angle: fx(60),
            baseKnockback: fx(40),
            knockbackGrowth: fx(30),
            effect: "fire",
            transcendent: true,
          },
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
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
