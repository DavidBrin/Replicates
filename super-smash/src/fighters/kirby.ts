/**
 * Kirby — fighter 06, the floaty.
 *
 * Six jumps, gravity 0.064, and a back air that kills. He is here because he
 * breaks the assumption that a fighter has two jumps: the engine's jump
 * counter, the CPU's recovery logic and the "can he still get back" heuristics
 * all have to cope with a character who has five more chances than everyone
 * else.
 *
 * **A correction worth recording.** Kirby is commonly said to have the worst
 * air speed in the game. He does not — at 0.84 he is 85th of 89. King Dedede
 * (0.735), Luigi (0.77), Ganondorf (0.83) and the Ice Climbers (0.83) are all
 * slower. He is *floaty*, which is a different thing: gravity 0.064 and a
 * 1.968 fast fall are both near the bottom of the roster, and that is what
 * makes him feel like he never comes down.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/** UNVERIFIED: hurtbox dimensions are unpublished. Kirby is a sphere a little
 * over half Mario's height — the smallest silhouette on this roster alongside
 * Pikachu, and SmashWiki ties them for the seventh-lightest fighter. */
const HEIGHT = 6.6;
const HALF_WIDTH = 1.9;

export const kirby: FighterDef = {
  id: "kirby",
  name: "Kirby",
  series: "Kirby",
  number: 6,

  attributes: {
    weight: 79,
    walkSpeed: fx(0.977),
    initialDashSpeed: fx(1.9),
    runSpeed: fx(1.727),
    // 0.84 — 85th of 89, not last. See the note above.
    airSpeed: fx(0.84),
    airAccelBase: fx(0.03),
    airAccelAdditional: fx(0.065),
    gravity: fx(0.064),
    fallSpeed: fx(1.23),
    fastFallSpeed: fx(1.968),
    traction: fx(0.116),
    // v = sqrt(2gh): full hop 25.37 at gravity 0.064 → 1.802.
    fullHopVelocity: fx(1.802),
    shortHopVelocity: fx(1.252),
    /**
     * Kirby's five midair jumps are **not equal** — each is weaker than the
     * last, at heights 21.064, 18.528, 15.931, 13.346 and 10.823. The fifth
     * gets him barely half what the first did, which is precisely why burning
     * jumps early offstage is fatal for him and free for everyone else.
     *
     * `FighterAttributes` carries one `airJumpVelocity`, so this is the *first*
     * air jump: sqrt(2 * 0.064 * 21.064) = 1.642. A future engine change that
     * wants the real taper should read the height list in this comment.
     */
    airJumpVelocity: fx(1.642),
    // One grounded jump plus five midair — six in total, tied with Jigglypuff
    // and Meta Knight for the most in the game.
    jumps: 6,
    canWallJump: false,
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

  moves: {
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 14,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 2,
          x: fx(3.4),
          y: fx(3.4),
          radius: fx(2.2),
          damage: fx(1.8),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(25),
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Jab 2",
      totalFrames: 15,
      followUp: "rapidJab",
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 3,
          x: fx(3.4),
          y: fx(3.4),
          radius: fx(2.2),
          damage: fx(1.6),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(15),
        },
      ],
    },

    rapidJab: {
      slot: "rapidJab",
      name: "Vulcan Jab",
      totalFrames: 39,
      rapid: true,
      hitboxes: [
        {
          // 0.2% a hit, every other frame, for as long as the button is held —
          // then a 3% finisher with growth 115 when it is released.
          id: 0,
          startFrame: 5,
          endFrame: 34,
          x: fx(3.6),
          y: fx(3.4),
          radius: fx(2.2),
          damage: fx(0.2),
          angle: fx(361),
          baseKnockback: fx(7),
          knockbackGrowth: fx(35),
        },
        {
          id: 1,
          startFrame: 35,
          endFrame: 36,
          x: fx(4.0),
          y: fx(3.4),
          radius: fx(2.6),
          damage: fx(3.0),
          angle: fx(361),
          baseKnockback: fx(70),
          knockbackGrowth: fx(115),
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 23,
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 8,
          x: fx(3.8),
          y: fx(2.4),
          radius: fx(2.6),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 20,
      hitboxes: [
        {
          // Frame 4, growth 132, and his foot is intangible on frames 4-10 —
          // it beats an aerial cleanly and starts a combo out of it.
          id: 0,
          startFrame: 4,
          endFrame: 5,
          x: fx(0.6),
          y: fx(7.6),
          radius: fx(2.8),
          damage: fx(5.0),
          angle: fx(100),
          baseKnockback: fx(30),
          knockbackGrowth: fx(132),
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 10,
          x: fx(0.6),
          y: fx(7.6),
          radius: fx(2.6),
          damage: fx(4.0),
          angle: fx(88),
          baseKnockback: fx(26),
          knockbackGrowth: fx(130),
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 20,
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(3.6),
          y: fx(0.8),
          radius: fx(2.4),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(43),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Burning",
      totalFrames: 51,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 17,
          x: fx(3.4),
          y: fx(3.0),
          radius: fx(3.4),
          damage: fx(12.0),
          angle: fx(46),
          baseKnockback: fx(82),
          knockbackGrowth: fx(71),
          effect: "fire",
        },
        {
          id: 1,
          startFrame: 18,
          endFrame: 26,
          x: fx(3.4),
          y: fx(3.0),
          radius: fx(3.0),
          damage: fx(9.0),
          angle: fx(76),
          baseKnockback: fx(80),
          knockbackGrowth: fx(50),
          effect: "fire",
        },
        {
          id: 2,
          startFrame: 27,
          endFrame: 34,
          x: fx(3.4),
          y: fx(3.0),
          radius: fx(2.8),
          damage: fx(6.0),
          angle: fx(76),
          baseKnockback: fx(80),
          knockbackGrowth: fx(50),
          effect: "fire",
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 47,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 15,
          x: fx(5.4),
          y: fx(3.2),
          radius: fx(3.2),
          damage: fx(15.0),
          angle: fx(361),
          baseKnockback: fx(32),
          knockbackGrowth: fx(109),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 16,
          endFrame: 19,
          x: fx(5.4),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(11.0),
          angle: fx(60),
          baseKnockback: fx(90),
          knockbackGrowth: fx(69),
          effect: "slash",
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 45,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 12,
          endFrame: 14,
          x: fx(0.4),
          y: fx(8.4),
          radius: fx(3.2),
          damage: fx(15.0),
          angle: fx(75),
          baseKnockback: fx(36),
          knockbackGrowth: fx(104),
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 16,
          x: fx(0.4),
          y: fx(8.4),
          radius: fx(3.0),
          damage: fx(14.0),
          angle: fx(88),
          baseKnockback: fx(20),
          knockbackGrowth: fx(98),
        },
        {
          id: 2,
          startFrame: 17,
          endFrame: 17,
          x: fx(0.4),
          y: fx(8.4),
          radius: fx(2.8),
          damage: fx(13.0),
          angle: fx(50),
          baseKnockback: fx(10),
          knockbackGrowth: fx(52),
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 50,
      chargeable: true,
      hitboxes: [
        {
          // Angle 29 both sides — a semi-spike split that covers both ledges.
          id: 0,
          startFrame: 7,
          endFrame: 11,
          x: fx(4.4),
          y: fx(0.8),
          radius: fx(3.0),
          damage: fx(14.0),
          angle: fx(29),
          baseKnockback: fx(25),
          knockbackGrowth: fx(94),
        },
        {
          id: 1,
          startFrame: 12,
          endFrame: 19,
          x: fx(-4.4),
          y: fx(0.8),
          radius: fx(3.0),
          damage: fx(10.0),
          angle: fx(29),
          baseKnockback: fx(25),
          knockbackGrowth: fx(94),
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 52,
      landingLag: 6,
      autoCancelBefore: 3,
      autoCancelAfter: 49,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 9,
          x: fx(0),
          y: fx(3.2),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(46),
          baseKnockback: fx(35),
          knockbackGrowth: fx(117),
        },
        {
          id: 1,
          startFrame: 10,
          endFrame: 13,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.6),
          damage: fx(8.0),
          angle: fx(46),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
        },
        {
          id: 2,
          startFrame: 14,
          endFrame: 18,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.2),
          damage: fx(6.0),
          angle: fx(46),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
        },
        {
          id: 3,
          startFrame: 19,
          endFrame: 32,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(4.0),
          angle: fx(46),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 47,
      landingLag: 8,
      hitboxes: [
        {
          id: 0,
          startFrame: 10,
          endFrame: 11,
          x: fx(4.2),
          y: fx(3.6),
          radius: fx(2.8),
          damage: fx(4.0),
          angle: fx(53),
          baseKnockback: fx(43),
          knockbackGrowth: fx(39),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 17,
          endFrame: 18,
          x: fx(4.2),
          y: fx(3.6),
          radius: fx(2.8),
          damage: fx(4.0),
          angle: fx(367),
          baseKnockback: fx(28),
          knockbackGrowth: fx(30),
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 25,
          endFrame: 27,
          x: fx(4.4),
          y: fx(3.6),
          radius: fx(3.0),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(24),
          knockbackGrowth: fx(148),
          effect: "slash",
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 40,
      landingLag: 10,
      autoCancelBefore: 2,
      autoCancelAfter: 32,
      hitboxes: [
        {
          // The famous one. Frame 6, 13%, knockback growth 104, ten frames of
          // landing lag. There is essentially no other frame-6 aerial in the
          // game carrying growth in three figures, and that combination — not
          // the damage — is why it kills as early as it does.
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(-4.6),
          y: fx(3.2),
          radius: fx(3.2),
          damage: fx(13.0),
          angle: fx(361),
          baseKnockback: fx(15),
          knockbackGrowth: fx(104),
        },
        {
          // The late hit drops to 8% but has *higher* growth on *zero* base
          // knockback: useless at low percent, still lethal at high.
          id: 1,
          startFrame: 9,
          endFrame: 12,
          x: fx(-4.6),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(0),
          knockbackGrowth: fx(112),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 35,
      landingLag: 7,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 13,
          x: fx(0),
          y: fx(8.0),
          radius: fx(3.4),
          damage: fx(10.0),
          angle: fx(70),
          baseKnockback: fx(20),
          knockbackGrowth: fx(115),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 54,
      landingLag: 16,
      hitboxes: [
        // A five-hit drill on odd frames, then a 2% finisher at a true 270.
        {
          id: 0,
          startFrame: 18,
          endFrame: 19,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(1.3),
          angle: fx(367),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 21,
          endFrame: 22,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(1.3),
          angle: fx(367),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 2,
          startFrame: 24,
          endFrame: 25,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(1.3),
          angle: fx(367),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 3,
          startFrame: 27,
          endFrame: 28,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(1.3),
          angle: fx(367),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 4,
          startFrame: 30,
          endFrame: 31,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(1.3),
          angle: fx(367),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 5,
          startFrame: 34,
          endFrame: 34,
          x: fx(0),
          y: fx(-1.6),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(270),
          baseKnockback: fx(20),
          knockbackGrowth: fx(110),
          meteor: true,
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Inhale",
      totalFrames: 67,
      // Not a damaging move — a grab. Suction is active frames 10-44 (longer
      // if held) and pulls anyone caught into Kirby's mouth, from which he can
      // either **swallow** (10%, and he takes the victim's neutral special as
      // a Copy Ability) or **spit** them out as a star projectile (6%; the star
      // itself launches at 45 degrees with BKB 70 / KBG 78). It also eats
      // projectiles outright, in a 51-frame animation.
      hitboxes: [
        {
          id: 0,
          startFrame: 10,
          endFrame: 44,
          x: fx(4.6),
          y: fx(3.4),
          radius: fx(4.0),
          damage: fx(0),
          angle: fx(0),
          baseKnockback: fx(0),
          knockbackGrowth: fx(0),
          grabbing: true,
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Hammer Flip",
      totalFrames: 54,
      chargeable: true,
      hitboxes: [
        {
          // Uncharged this launches at 48 degrees for 19%. A **full charge
          // changes the angle to 361 and the damage to 35%** — the single
          // biggest number anywhere in this directory. Full charge grounded
          // also grants invulnerability on frames 2-10 and super armour on
          // 11-17, and reaches full on frame 135. The charge burns Kirby if
          // held too long.
          id: 0,
          startFrame: 26,
          endFrame: 27,
          x: fx(5.0),
          y: fx(5.0),
          radius: fx(3.6),
          damage: fx(19.0),
          angle: fx(48),
          baseKnockback: fx(60),
          knockbackGrowth: fx(78),
          effect: "fire",
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Final Cutter",
      totalFrames: 60,
      landingLag: 30,
      hitboxes: [
        {
          id: 0,
          startFrame: 23,
          endFrame: 26,
          x: fx(1.0),
          y: fx(7.0),
          radius: fx(3.4),
          damage: fx(5.0),
          angle: fx(85),
          baseKnockback: fx(117),
          knockbackGrowth: fx(100),
          setKnockback: true,
          effect: "slash",
        },
        {
          // The descent meteors at 275 degrees.
          id: 1,
          startFrame: 41,
          endFrame: 49,
          x: fx(1.0),
          y: fx(-1.0),
          radius: fx(3.2),
          damage: fx(2.0),
          angle: fx(275),
          baseKnockback: fx(96),
          knockbackGrowth: fx(100),
          setKnockback: true,
          meteor: true,
          effect: "slash",
        },
        {
          // PROJECTILE: landing fires a shockwave blade along the ground.
          id: 2,
          startFrame: 50,
          endFrame: 51,
          x: fx(6.0),
          y: fx(1.5),
          radius: fx(3.0),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(30),
          effect: "slash",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Stone",
      totalFrames: 60,
      // He turns into a rock and drops. The armour is the point: he is
      // invulnerable for the whole transformation, which is why it works as a
      // recovery mixup and a get-off-me button rather than as an attack.
      hitboxes: [
        {
          id: 0,
          startFrame: 29,
          endFrame: 47,
          x: fx(0),
          y: fx(2.0),
          radius: fx(4.0),
          damage: fx(18.0),
          angle: fx(70),
          baseKnockback: fx(69),
          knockbackGrowth: fx(76),
        },
      ],
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
          x: fx(4.2),
          y: fx(3.4),
          radius: fx(2.8),
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
      totalFrames: 41,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(5.0),
          y: fx(3.4),
          radius: fx(2.8),
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
      totalFrames: 15,
      hitboxes: [
        {
          id: 0,
          startFrame: 1,
          endFrame: 1,
          x: fx(0),
          y: fx(4.0),
          radius: fx(3.0),
          damage: fx(1.0),
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
      totalFrames: 58,
      hitboxes: [
        {
          id: 0,
          startFrame: 45,
          endFrame: 45,
          x: fx(3.0),
          y: fx(3.0),
          radius: fx(2.5),
          damage: fx(5.0),
          angle: fx(75),
          baseKnockback: fx(40),
          knockbackGrowth: fx(125),
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
          startFrame: 41,
          endFrame: 41,
          x: fx(-3.0),
          y: fx(3.0),
          radius: fx(2.5),
          damage: fx(8.0),
          angle: fx(130),
          baseKnockback: fx(30),
          knockbackGrowth: fx(120),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 86,
      hitboxes: [
        {
          // Eighty-six frames: he carries them into the sky and comes back
          // down. The landing itself is a separate 7% hitbox on frames 45-53.
          id: 0,
          startFrame: 58,
          endFrame: 58,
          x: fx(0),
          y: fx(5.0),
          radius: fx(2.5),
          damage: fx(10.0),
          angle: fx(78),
          baseKnockback: fx(75),
          knockbackGrowth: fx(74),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 87,
      hitboxes: [
        {
          // Ten stomps at a literal 270 degrees, then a release.
          id: 0,
          startFrame: 9,
          endFrame: 42,
          x: fx(0),
          y: fx(1.0),
          radius: fx(2.5),
          damage: fx(1.0),
          angle: fx(270),
          baseKnockback: fx(10),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 58,
          endFrame: 58,
          x: fx(1.0),
          y: fx(1.0),
          radius: fx(2.5),
          damage: fx(2.0),
          angle: fx(63),
          baseKnockback: fx(60),
          knockbackGrowth: fx(180),
        },
      ],
    },
  },

  palette: {
    primary: "#F49AC1", // the pink everyone knows
    secondary: "#D4547E", // feet and cheeks
    accent: "#FFFFFF",
    skin: "#F49AC1",
    outline: "#5A2038",
    alts: [
      { primary: "#F5D547", secondary: "#C79A1E", accent: "#FFFDF0" }, // yellow
      { primary: "#4FA8E8", secondary: "#2A6FA8", accent: "#E8F4FF" }, // blue
      { primary: "#E84C3D", secondary: "#A82A1E", accent: "#FFE8E4" }, // red
      { primary: "#5ECC6A", secondary: "#2E8B37", accent: "#EAFFEC" }, // green
      { primary: "#F0F0F0", secondary: "#B0B0B0", accent: "#FFFFFF" }, // white
      { primary: "#3A3A3A", secondary: "#1A1A1A", accent: "#8A8A8A" }, // shadow
    ],
  },

  blurb: "Six jumps and a back air that ends stocks. Getting him offstage is not the same as killing him.",
};
