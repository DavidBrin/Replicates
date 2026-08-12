/**
 * Donkey Kong — fighter 02, the heavyweight.
 *
 * Weight 127 against Mario's 98, and it buys exactly what you would expect: he
 * survives to percentages nobody else sees, and he is hit by things that should
 * have missed. His hurtbox is famously *larger than his model suggests* — his
 * tie has its own oversized hurtbox — and most of his moves throw his arms out
 * ahead of him, so his disadvantage state is the worst in the game.
 *
 * Sources and conventions are as documented at the top of `mario.ts`: attributes
 * from SmashWiki, frames from Ultimate Frame Data, and angle/BKB/KBG from the
 * game's patch-13.0.1 ACMD scripts, because neither site publishes those.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/** UNVERIFIED: hurtbox dimensions are unpublished. DK stands roughly half again
 * as tall as Mario and considerably wider, which is the shape his frame data
 * implies — his grab reaches z 13.7 and his forward smash has a 22-unit swing. */
const HEIGHT = 15.0;
const HALF_WIDTH = 3.2;

export const donkeyKong: FighterDef = {
  id: "donkeyKong",
  name: "Donkey Kong",
  series: "Donkey Kong",
  number: 2,

  attributes: {
    weight: 127,
    walkSpeed: fx(1.365),
    initialDashSpeed: fx(2.09),
    runSpeed: fx(1.873),
    airSpeed: fx(1.208),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.05),
    gravity: fx(0.085),
    fallSpeed: fx(1.63),
    fastFallSpeed: fx(2.608),
    traction: fx(0.123),
    // v = sqrt(2gh): full hop 34 at gravity 0.085 → 2.404.
    fullHopVelocity: fx(2.404),
    shortHopVelocity: fx(1.715),
    // His air jump (35.5) is actually higher than his full hop (34) — one of
    // the few fighters for whom that is true.
    airJumpVelocity: fx(2.457),
    jumps: 2,
    canWallJump: false,
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

  moves: {
    // DK's jab is a two-hit string. There is no jab 3 and no rapid jab — the
    // game data has no `Attack13` script for him at all.
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 24,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 6,
          x: fx(7.5),
          y: fx(9.5),
          radius: fx(4.0),
          damage: fx(4.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(35),
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Uppercut",
      totalFrames: 31,
      hitboxes: [
        {
          // Angle 70 with growth 100 — it launches, which is why the two-hit
          // string ends where everyone else's is still winding up.
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(6.5),
          y: fx(11.0),
          radius: fx(4.5),
          damage: fx(6.0),
          angle: fx(70),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 34,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 9,
          x: fx(9.0),
          y: fx(7.5),
          radius: fx(4.5),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(50),
          knockbackGrowth: fx(78),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 38,
      hitboxes: [
        {
          // Sweetspotted on the hand, at the top of the arc: 10% and growth 115
          // versus 8% and 105 down at the shoulder.
          id: 0,
          startFrame: 5,
          endFrame: 11,
          x: fx(2.0),
          y: fx(15.5),
          radius: fx(5.0),
          damage: fx(10.0),
          angle: fx(100),
          baseKnockback: fx(40),
          knockbackGrowth: fx(115),
        },
        {
          id: 1,
          startFrame: 5,
          endFrame: 11,
          x: fx(1.0),
          y: fx(11.0),
          radius: fx(4.5),
          damage: fx(8.0),
          angle: fx(100),
          baseKnockback: fx(40),
          knockbackGrowth: fx(105),
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 24,
      hitboxes: [
        {
          // 6% with base knockback 10 — it barely moves anyone, and carries a
          // 40% trip chance in the script that this schema cannot express.
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(7.0),
          y: fx(1.4),
          radius: fx(3.6),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(10),
          knockbackGrowth: fx(80),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 34,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 12,
          x: fx(6.0),
          y: fx(6.0),
          radius: fx(5.0),
          damage: fx(12.0),
          angle: fx(53),
          baseKnockback: fx(85),
          knockbackGrowth: fx(46),
        },
        {
          id: 1,
          startFrame: 13,
          endFrame: 24,
          x: fx(6.0),
          y: fx(6.0),
          radius: fx(4.0),
          damage: fx(9.0),
          angle: fx(45),
          baseKnockback: fx(60),
          knockbackGrowth: fx(60),
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 54,
      chargeable: true,
      // Arm and head are intangible on frames 20-26 — the swing beats what it
      // collides with. No field on `Hitbox` carries that; it is engine work
      // keyed off this slot.
      hitboxes: [
        {
          // 22% uncharged, 30.8% at full charge. Frame 22 startup is glacial,
          // and it is the second-strongest untippered forward smash in the game.
          id: 0,
          startFrame: 22,
          endFrame: 23,
          x: fx(11.0),
          y: fx(8.0),
          radius: fx(6.0),
          damage: fx(22.0),
          angle: fx(46),
          baseKnockback: fx(21),
          knockbackGrowth: fx(88),
        },
        {
          id: 1,
          startFrame: 22,
          endFrame: 23,
          x: fx(5.0),
          y: fx(8.0),
          radius: fx(4.5),
          damage: fx(21.0),
          angle: fx(361),
          baseKnockback: fx(18),
          knockbackGrowth: fx(86),
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 49,
      chargeable: true,
      hitboxes: [
        {
          // Intangible frames 12-15, so it beats an aerial approach outright.
          id: 0,
          startFrame: 14,
          endFrame: 15,
          x: fx(0),
          y: fx(16.0),
          radius: fx(6.5),
          damage: fx(19.0),
          angle: fx(90),
          baseKnockback: fx(40),
          knockbackGrowth: fx(84),
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 55,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 11,
          endFrame: 12,
          x: fx(8.0),
          y: fx(1.6),
          radius: fx(5.0),
          damage: fx(17.0),
          angle: fx(70),
          baseKnockback: fx(35),
          knockbackGrowth: fx(88),
        },
        {
          // The late half is the *stronger* one, at 18% and a flatter 55°.
          id: 1,
          startFrame: 13,
          endFrame: 14,
          x: fx(-8.0),
          y: fx(1.6),
          radius: fx(5.0),
          damage: fx(18.0),
          angle: fx(55),
          baseKnockback: fx(30),
          knockbackGrowth: fx(88),
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 38,
      landingLag: 10,
      autoCancelBefore: 9,
      autoCancelAfter: 27,
      hitboxes: [
        {
          id: 0,
          startFrame: 10,
          endFrame: 13,
          x: fx(5.0),
          y: fx(7.0),
          radius: fx(6.0),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 26,
          x: fx(5.0),
          y: fx(7.0),
          radius: fx(5.0),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(10),
          knockbackGrowth: fx(100),
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 55,
      landingLag: 17,
      hitboxes: [
        {
          id: 0,
          startFrame: 18,
          endFrame: 20,
          x: fx(8.0),
          y: fx(6.0),
          radius: fx(6.0),
          damage: fx(16.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(85),
        },
        {
          // The late half meteors at a literal 270° — straight down.
          id: 1,
          startFrame: 21,
          endFrame: 23,
          x: fx(8.0),
          y: fx(3.0),
          radius: fx(5.5),
          damage: fx(15.0),
          angle: fx(270),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          meteor: true,
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 31,
      landingLag: 11,
      autoCancelBefore: 6,
      autoCancelAfter: 31,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(-9.0),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(13.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(97),
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 16,
          x: fx(-9.0),
          y: fx(7.0),
          radius: fx(4.0),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(10),
          knockbackGrowth: fx(100),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 37,
      landingLag: 15,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 10,
          x: fx(0),
          y: fx(17.0),
          radius: fx(6.0),
          damage: fx(13.0),
          angle: fx(90),
          baseKnockback: fx(32),
          knockbackGrowth: fx(90),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 54,
      landingLag: 14,
      hitboxes: [
        {
          id: 0,
          startFrame: 14,
          endFrame: 16,
          x: fx(1.0),
          y: fx(-2.0),
          radius: fx(5.0),
          damage: fx(16.0),
          angle: fx(270),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
          meteor: true,
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 16,
          x: fx(4.5),
          y: fx(0.5),
          radius: fx(4.5),
          damage: fx(13.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(90),
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Giant Punch",
      totalFrames: 62,
      chargeable: true,
      // Ultimate replaced the classic ten wind-ups with a continuous 110-frame
      // charge: damage is `base + 18 * (chargeFrames / 110)`, so the grounded
      // punch runs 10% → 28%. Full charge is also *faster* — FAF drops from 62
      // to 47 — and grants super armour on frames 9-20. The charge is stored
      // until DK takes knockback, and may be cancelled into shield, jump or
      // roll. The hitbox below is the uncharged punch.
      superArmourFrames: [9, 20],
      hitboxes: [
        {
          id: 0,
          startFrame: 19,
          endFrame: 20,
          x: fx(10.0),
          y: fx(8.0),
          radius: fx(5.5),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(45),
          knockbackGrowth: fx(70),
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Headbutt",
      totalFrames: 62,
      momentum: [{ frame: 14, x: fx(1.1), y: fx(0), hold: 6 }],
      hitboxes: [
        {
          // Angle 270 does two different things depending on where the victim
          // is: it *buries* a grounded opponent and *meteors* an airborne one.
          id: 0,
          startFrame: 20,
          endFrame: 21,
          x: fx(7.0),
          y: fx(9.0),
          radius: fx(4.5),
          damage: fx(10.0),
          angle: fx(270),
          baseKnockback: fx(40),
          knockbackGrowth: fx(40),
          effect: "bury",
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Spinning Kong",
      totalFrames: 104,
      momentum: [{ frame: 6, x: fx(0.85), y: fx(1.9), hold: 18 }],
      landingLag: 38,
      hitboxes: [
        {
          id: 0,
          startFrame: 19,
          endFrame: 19,
          x: fx(7.0),
          y: fx(8.0),
          radius: fx(5.0),
          damage: fx(5.0),
          angle: fx(95),
          baseKnockback: fx(90),
          knockbackGrowth: fx(30),
          setKnockback: true,
        },
        {
          // The loop that drags the victim through the spin.
          id: 1,
          startFrame: 25,
          endFrame: 58,
          x: fx(7.0),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(1.4),
          angle: fx(367),
          baseKnockback: fx(90),
          knockbackGrowth: fx(55),
          setKnockback: true,
        },
        {
          id: 2,
          startFrame: 62,
          endFrame: 62,
          x: fx(7.0),
          y: fx(7.0),
          radius: fx(5.0),
          damage: fx(4.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(157),
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Hand Slap",
      totalFrames: 46,
      hitboxes: [
        {
          // Grounded only — it sends a shockwave along the floor and does
          // nothing at all in the air except a two-hit ground pound.
          id: 0,
          startFrame: 12,
          endFrame: 13,
          x: fx(8.0),
          y: fx(0.8),
          radius: fx(5.0),
          damage: fx(14.0),
          angle: fx(78),
          baseKnockback: fx(85),
          knockbackGrowth: fx(30),
        },
      ],
    },

    grab: {
      slot: "grab",
      name: "Grab",
      totalFrames: 38,
      hitboxes: [
        {
          // Slow at frame 8, but the grabbox reaches nearly fourteen units.
          id: 0,
          startFrame: 8,
          endFrame: 10,
          x: fx(9.0),
          y: fx(9.0),
          radius: fx(5.8),
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
      totalFrames: 46,
      hitboxes: [
        {
          id: 0,
          startFrame: 11,
          endFrame: 13,
          x: fx(10.0),
          y: fx(9.0),
          radius: fx(5.8),
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
      totalFrames: 21,
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 2,
          x: fx(0),
          y: fx(12.0),
          radius: fx(5.0),
          damage: fx(1.6),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
      ],
    },

    /**
     * The four throws below are DK's **cargo** throws, and that deserves an
     * explanation rather than a silent substitution.
     *
     * DK's forward throw is not a throw. It is Kong Karry: he hoists the victim
     * onto his shoulder and keeps them there — walking, running and jumping
     * freely — until he picks one of four *cargo* throws, which is what gives
     * him eight throws instead of four. Carry duration is
     * `((90 + 1.7p) * 11/6) - g` frames in the victim's percent `p`.
     *
     * `MoveSlot` has one throw per direction and no carry state, so what is
     * encoded here is the cargo set, because those are the throws that actually
     * launch — the carry itself only drops for 4%. His non-cargo back/up/down
     * throws exist too (11% / 9% / 7%) and are noted per move.
     */
    fthrow: {
      slot: "fthrow",
      name: "Cargo Forward Throw",
      totalFrames: 45,
      hitboxes: [
        {
          id: 0,
          startFrame: 15,
          endFrame: 15,
          x: fx(6.0),
          y: fx(9.0),
          radius: fx(4.0),
          damage: fx(12.0),
          angle: fx(60),
          baseKnockback: fx(90),
          knockbackGrowth: fx(46),
        },
      ],
    },

    bthrow: {
      slot: "bthrow",
      name: "Cargo Back Throw",
      totalFrames: 42,
      hitboxes: [
        {
          // His hardest-hitting throw and his best kill throw. The non-cargo
          // back throw is 11% at angle 40 (BKB 60, KBG 65).
          id: 0,
          startFrame: 16,
          endFrame: 16,
          x: fx(-6.0),
          y: fx(9.0),
          radius: fx(4.0),
          damage: fx(13.0),
          angle: fx(72),
          baseKnockback: fx(85),
          knockbackGrowth: fx(52),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Cargo Up Throw",
      totalFrames: 29,
      hitboxes: [
        {
          // The "Ding-Dong" throw of Smash 4, deliberately given more knockback
          // in Ultimate so it stops being a guaranteed kill confirm. The
          // non-cargo up throw is 9% at angle 90 (BKB 70, KBG 50).
          id: 0,
          startFrame: 15,
          endFrame: 15,
          x: fx(0),
          y: fx(12.0),
          radius: fx(4.0),
          damage: fx(12.0),
          angle: fx(92),
          baseKnockback: fx(65),
          knockbackGrowth: fx(53),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Cargo Down Throw",
      totalFrames: 44,
      hitboxes: [
        {
          // A semi-spike at 46° — the stage-spike throw. The non-cargo down
          // throw is 7% at the Sakurai angle (BKB 60, KBG 50).
          id: 0,
          startFrame: 17,
          endFrame: 17,
          x: fx(4.0),
          y: fx(2.0),
          radius: fx(4.0),
          damage: fx(11.0),
          angle: fx(46),
          baseKnockback: fx(70),
          knockbackGrowth: fx(45),
        },
      ],
    },
  },

  palette: {
    primary: "#8B4513", // fur brown
    secondary: "#C41E3A", // the tie
    accent: "#F5DEB3", // muzzle and chest
    skin: "#D2A679",
    outline: "#2B1608",
    alts: [
      { primary: "#3B2314", secondary: "#1E5AA8", accent: "#E8D0A9" }, // dark fur, blue tie
      { primary: "#C97B3C", secondary: "#2E8B37", accent: "#FFE8C0" }, // ginger, green tie
      { primary: "#5A5A5A", secondary: "#FFD500", accent: "#D8D8D8" }, // grey, yellow tie
      { primary: "#F0E6D2", secondary: "#7B2D8E", accent: "#FFFFFF" }, // white, purple tie
      { primary: "#6B3FA0", secondary: "#FF8C00", accent: "#E0D0F0" }, // purple, orange tie
    ],
  },

  blurb: "Weight 127 and arms that arrive before he does. Survives everything, gets hit by everything.",
};
