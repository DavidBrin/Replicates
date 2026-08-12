/**
 * Link — fighter 03, the zoner.
 *
 * Three projectiles, all live at once and all doing different jobs: an arrow
 * that charges, a boomerang that comes back, and a bomb that waits until he
 * decides to set it off. No other fighter in this roster controls space with
 * three independent objects, and the point of including him is that the engine
 * has to cope with more than one thing on screen that isn't a fighter.
 *
 * Two things people get wrong about Ultimate's Link, both encoded here:
 * **he cannot wall jump**, and **he has no tether** — this is Breath of the
 * Wild Link, and the Hookshot went with the old design.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/** UNVERIFIED: hurtbox dimensions are unpublished. Slightly taller than Mario
 * and about as wide, with the sword adding reach but no hurtbox. */
const HEIGHT = 12.4;
const HALF_WIDTH = 2.1;

export const link: FighterDef = {
  id: "link",
  name: "Link",
  series: "The Legend of Zelda",
  number: 3,

  attributes: {
    weight: 104,
    walkSpeed: fx(1.237),
    initialDashSpeed: fx(1.98),
    runSpeed: fx(1.534),
    // 0.924 air speed and a 3.04 fast fall: he commits to a jump, and he
    // arrives quickly once he does. This is a grounded character.
    airSpeed: fx(0.924),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.04),
    gravity: fx(0.096),
    fallSpeed: fx(1.6),
    fastFallSpeed: fx(3.04),
    traction: fx(0.113),
    // v = sqrt(2gh): full hop 27.8 at gravity 0.096 → 2.310.
    fullHopVelocity: fx(2.31),
    shortHopVelocity: fx(1.603),
    airJumpVelocity: fx(2.36),
    jumps: 2,
    canWallJump: false,
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

  moves: {
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 23,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(7.0),
          y: fx(8.0),
          radius: fx(3.2),
          damage: fx(3.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(25),
          effect: "slash",
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Jab 2",
      totalFrames: 25,
      followUp: "jab3",
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 6,
          x: fx(7.0),
          y: fx(8.0),
          radius: fx(3.2),
          damage: fx(3.0),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(25),
          effect: "slash",
        },
      ],
    },

    jab3: {
      slot: "jab3",
      name: "Spin Finish",
      totalFrames: 34,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(7.5),
          y: fx(7.0),
          radius: fx(3.8),
          damage: fx(4.0),
          angle: fx(30),
          baseKnockback: fx(70),
          knockbackGrowth: fx(70),
          effect: "slash",
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 39,
      hitboxes: [
        {
          id: 0,
          startFrame: 15,
          endFrame: 19,
          x: fx(9.5),
          y: fx(7.5),
          radius: fx(4.0),
          damage: fx(13.0),
          angle: fx(361),
          baseKnockback: fx(55),
          knockbackGrowth: fx(82),
          effect: "slash",
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 35,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 12,
          x: fx(1.5),
          y: fx(14.0),
          radius: fx(4.5),
          damage: fx(11.0),
          angle: fx(85),
          baseKnockback: fx(30),
          knockbackGrowth: fx(111),
          effect: "slash",
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 30,
      hitboxes: [
        {
          // Base knockback 90 with growth 30 — it pops opponents up almost the
          // same distance whatever their percent, which is what makes it a
          // consistent combo starter rather than a finisher.
          id: 0,
          startFrame: 10,
          endFrame: 11,
          x: fx(8.0),
          y: fx(1.5),
          radius: fx(3.5),
          damage: fx(9.0),
          angle: fx(85),
          baseKnockback: fx(90),
          knockbackGrowth: fx(30),
          effect: "slash",
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 56,
      hitboxes: [
        {
          // Link's dash attack is spaced like a sword move: the *tip* is the
          // strongest at 14%, and lower id means it wins the overlap.
          id: 0,
          startFrame: 20,
          endFrame: 23,
          x: fx(10.5),
          y: fx(6.5),
          radius: fx(3.5),
          damage: fx(14.0),
          angle: fx(45),
          baseKnockback: fx(70),
          knockbackGrowth: fx(85),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 20,
          endFrame: 23,
          x: fx(6.5),
          y: fx(6.5),
          radius: fx(3.5),
          damage: fx(13.0),
          angle: fx(50),
          baseKnockback: fx(85),
          knockbackGrowth: fx(85),
          effect: "slash",
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 50,
      chargeable: true,
      // Two-input move: pressing attack again on frames 23-36 fires a second
      // outward slash (13% far / 12% close, angle 48, BKB 85, KBG 89) that is a
      // semi-spike and his most reliable KO near the ledge. The first hit's low
      // growth exists to make that follow-up a true combo. Also — at exactly
      // 0.0% damage, hit one fires a Sword Beam projectile.
      hitboxes: [
        {
          id: 0,
          startFrame: 17,
          endFrame: 18,
          x: fx(10.5),
          y: fx(7.5),
          radius: fx(3.2),
          damage: fx(14.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 17,
          endFrame: 18,
          x: fx(6.0),
          y: fx(7.5),
          radius: fx(3.5),
          damage: fx(7.0),
          angle: fx(69),
          baseKnockback: fx(45),
          knockbackGrowth: fx(12),
          effect: "slash",
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 77,
      chargeable: true,
      hitboxes: [
        {
          // Three slashes over seventy-seven frames. The first two are set
          // knockback so they hold the victim in place for the third.
          id: 0,
          startFrame: 10,
          endFrame: 15,
          x: fx(2.0),
          y: fx(13.0),
          radius: fx(4.0),
          damage: fx(4.0),
          angle: fx(105),
          baseKnockback: fx(55),
          knockbackGrowth: fx(100),
          setKnockback: true,
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 25,
          endFrame: 30,
          x: fx(2.0),
          y: fx(14.0),
          radius: fx(4.0),
          damage: fx(3.0),
          angle: fx(105),
          baseKnockback: fx(55),
          knockbackGrowth: fx(100),
          setKnockback: true,
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 41,
          endFrame: 45,
          x: fx(1.0),
          y: fx(15.0),
          radius: fx(4.5),
          damage: fx(11.0),
          angle: fx(80),
          baseKnockback: fx(60),
          knockbackGrowth: fx(101),
          effect: "slash",
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 56,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 12,
          endFrame: 13,
          x: fx(9.0),
          y: fx(1.5),
          radius: fx(3.5),
          damage: fx(17.0),
          angle: fx(78),
          baseKnockback: fx(40),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
        {
          // The back half is a 30° semi-spike — the edgeguarding half.
          id: 1,
          startFrame: 24,
          endFrame: 25,
          x: fx(-9.0),
          y: fx(1.5),
          radius: fx(3.5),
          damage: fx(12.0),
          angle: fx(30),
          baseKnockback: fx(80),
          knockbackGrowth: fx(63),
          effect: "slash",
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 38,
      landingLag: 6,
      autoCancelBefore: 3,
      autoCancelAfter: 36,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(5.0),
          y: fx(5.5),
          radius: fx(4.5),
          damage: fx(11.0),
          angle: fx(361),
          baseKnockback: fx(22),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 31,
          x: fx(5.0),
          y: fx(5.5),
          radius: fx(3.8),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(15),
          knockbackGrowth: fx(100),
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 51,
      landingLag: 11,
      hitboxes: [
        {
          id: 0,
          startFrame: 16,
          endFrame: 17,
          x: fx(8.0),
          y: fx(7.0),
          radius: fx(3.5),
          damage: fx(8.0),
          angle: fx(43),
          baseKnockback: fx(30),
          knockbackGrowth: fx(28),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 24,
          endFrame: 25,
          x: fx(8.0),
          y: fx(7.0),
          radius: fx(3.5),
          damage: fx(10.0),
          angle: fx(44),
          baseKnockback: fx(43),
          knockbackGrowth: fx(120),
          effect: "slash",
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 30,
      landingLag: 6,
      autoCancelBefore: 3,
      autoCancelAfter: 29,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(-7.5),
          y: fx(6.5),
          radius: fx(3.5),
          damage: fx(5.0),
          angle: fx(73),
          baseKnockback: fx(50),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 17,
          x: fx(-7.5),
          y: fx(6.5),
          radius: fx(3.5),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(45),
          knockbackGrowth: fx(98),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 59,
      landingLag: 14,
      hitboxes: [
        {
          id: 0,
          startFrame: 11,
          endFrame: 13,
          x: fx(1.0),
          y: fx(15.5),
          radius: fx(4.5),
          damage: fx(15.0),
          angle: fx(85),
          baseKnockback: fx(23),
          knockbackGrowth: fx(93),
          effect: "stab",
        },
        {
          id: 1,
          startFrame: 14,
          endFrame: 40,
          x: fx(1.0),
          y: fx(15.5),
          radius: fx(4.0),
          damage: fx(13.0),
          angle: fx(85),
          baseKnockback: fx(18),
          knockbackGrowth: fx(88),
          effect: "stab",
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 79,
      landingLag: 19,
      hitboxes: [
        {
          // 18% and a true meteor — and it pogo-bounces off whatever it hits,
          // so it can connect a second time about thirty frames later for 11%.
          // The bounce is engine behaviour; the numbers are here.
          id: 0,
          startFrame: 14,
          endFrame: 19,
          x: fx(1.0),
          y: fx(-2.5),
          radius: fx(3.8),
          damage: fx(18.0),
          angle: fx(270),
          baseKnockback: fx(30),
          knockbackGrowth: fx(80),
          meteor: true,
          effect: "stab",
        },
        {
          id: 1,
          startFrame: 20,
          endFrame: 64,
          x: fx(1.0),
          y: fx(-2.5),
          radius: fx(3.5),
          damage: fx(15.0),
          angle: fx(60),
          baseKnockback: fx(30),
          knockbackGrowth: fx(80),
          effect: "stab",
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Hero's Bow",
      totalFrames: 44,
      chargeable: true,
      hitboxes: [],
      projectiles: [
        {
          // Loosed on frame 16, flying flat and fast for 46 frames before
          // arcing down and sticking in the ground for three seconds, where it
          // becomes an item anyone can pick up. Charge runs frames 16 to 52 and
          // scales damage as `4 + 8 * (chargeFrames / 60)` — 4% uncharged to
          // 12% full, hence `chargeScaling: 3`. Firing with a stuck arrow
          // already in hand looses *two* at once, each scaled 0.8x for 6% → 18%
          // total; the double arrow is the harder launcher (BKB 25 / KBG 110
          // against 10 / 71). Reflectable and absorbable.
          id: "arrow",
          spawnFrame: 16,
          offsetX: fx(9.0),
          offsetY: fx(7.0),
          vx: fx(3.4),
          vy: fx(0),
          // Flat for most of its life; the late droop is the small gravity.
          gravity: fx(0.014),
          lifetime: 46,
          destroyOnHit: true,
          chargeScaling: fx(3),
          visual: "arrow",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 46,
            x: fx(0),
            y: fx(0),
            radius: fx(2.0),
            damage: fx(4.0),
            angle: fx(361),
            baseKnockback: fx(10),
            knockbackGrowth: fx(71),
            effect: "stab",
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Boomerang",
      totalFrames: 45,
      hitboxes: [],
      projectiles: [
        {
          // Out, decelerating, then back — `returns` is the whole move. It
          // lives 151 frames on a tilt throw; a *smash* input throws it further
          // and harder (8% → 9.6% clean) and stretches that to 192. Link
          // catches it in a 9-frame animation, which is skipped if he is
          // mid-attack.
          //
          // The return leg does only 3% but drags victims back toward him,
          // which is what makes it a combo starter into his sword rather than
          // a poke. It does not die on contact — it keeps going.
          id: "boomerang",
          spawnFrame: 27,
          offsetX: fx(9.0),
          offsetY: fx(7.0),
          vx: fx(2.6),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 151,
          destroyOnHit: false,
          returns: true,
          visual: "boomerang",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 151,
            x: fx(0),
            y: fx(0),
            radius: fx(3.0),
            damage: fx(8.0),
            angle: fx(70),
            baseKnockback: fx(80),
            knockbackGrowth: fx(40),
            transcendent: true,
          },
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Spin Attack",
      totalFrames: 76,
      momentum: [{ frame: 6, x: fx(0.35), y: fx(2.5), hold: 13 }],
      landingLag: 30,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(7.5),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(14.0),
          angle: fx(45),
          baseKnockback: fx(60),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 13,
          x: fx(7.5),
          y: fx(7.0),
          radius: fx(4.5),
          damage: fx(12.0),
          angle: fx(43),
          baseKnockback: fx(52),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 14,
          endFrame: 39,
          x: fx(7.5),
          y: fx(7.0),
          radius: fx(4.0),
          damage: fx(9.0),
          angle: fx(43),
          baseKnockback: fx(48),
          knockbackGrowth: fx(84),
          effect: "slash",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Remote Bomb",
      totalFrames: 39,
      hitboxes: [],
      projectiles: [
        {
          // The Ultimate change that redefined the move: the bomb does **not**
          // detonate on impact. The first input puts one in his hand on frame
          // 17; it can then be thrown, Z-dropped, or simply left lying on the
          // stage. A *second* input detonates it with the Sheikah Slate.
          //
          // Only one may exist at a time, and it lives a maximum of 1800 frames
          // — thirty seconds — flashing for the last 45 before going off by
          // itself. The blast damages Link too, which is deliberately
          // exploitable as a recovery.
          //
          // The 7% below is the detonation, which is the hit that matters;
          // being struck by the bomb as a thrown object is only 1%.
          id: "remoteBomb",
          spawnFrame: 17,
          offsetX: fx(4.0),
          offsetY: fx(6.0),
          vx: fx(1.4),
          vy: fx(0.4),
          gravity: fx(0.07),
          lifetime: 1800,
          destroyOnHit: false,
          bounces: 3,
          visual: "bomb",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 1800,
            x: fx(0),
            y: fx(0),
            radius: fx(7.0),
            damage: fx(7.0),
            angle: fx(52),
            baseKnockback: fx(60),
            knockbackGrowth: fx(115),
            effect: "fire",
            transcendent: true,
          },
        },
      ],
    },

    grab: {
      slot: "grab",
      name: "Grab",
      totalFrames: 34,
      // A plain grab, not a tether: Ultimate's Link has no Hookshot.
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(6.4),
          y: fx(7.4),
          radius: fx(3.2),
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
          x: fx(7.4),
          y: fx(7.4),
          radius: fx(3.2),
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
      totalFrames: 18,
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
      totalFrames: 37,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 13,
          x: fx(4.0),
          y: fx(6.5),
          radius: fx(3.0),
          damage: fx(2.5),
          angle: fx(33),
          baseKnockback: fx(75),
          knockbackGrowth: fx(85),
        },
      ],
    },

    bthrow: {
      slot: "bthrow",
      name: "Back Throw",
      totalFrames: 38,
      hitboxes: [
        {
          id: 0,
          startFrame: 14,
          endFrame: 14,
          x: fx(-4.0),
          y: fx(6.5),
          radius: fx(3.0),
          damage: fx(2.5),
          angle: fx(130),
          baseKnockback: fx(67),
          knockbackGrowth: fx(110),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 49,
      hitboxes: [
        {
          // Knockback growth 230 on 2% — almost all of its launch comes from
          // scaling, so it does nothing at low percent and kills at high.
          id: 0,
          startFrame: 28,
          endFrame: 28,
          x: fx(0),
          y: fx(9.0),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(90),
          baseKnockback: fx(24),
          knockbackGrowth: fx(230),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 48,
      hitboxes: [
        {
          id: 0,
          startFrame: 24,
          endFrame: 24,
          x: fx(2.0),
          y: fx(1.0),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(83),
          baseKnockback: fx(60),
          knockbackGrowth: fx(125),
        },
      ],
    },
  },

  palette: {
    primary: "#3A8C3A", // the champion's tunic
    secondary: "#5A3A22", // leather and boots
    accent: "#D8C070", // trim, and the Master Sword's hilt
    skin: "#F0C9A0",
    outline: "#16240F",
    alts: [
      { primary: "#2B4FA8", secondary: "#3A2A1A", accent: "#D0D8E8" }, // Zora blue
      { primary: "#C42525", secondary: "#4A2418", accent: "#E8C070" }, // Goron red
      { primary: "#E8E8E8", secondary: "#6A6A6A", accent: "#B0C4DE" }, // Sheikah white
      { primary: "#4A2A6A", secondary: "#2A1A3A", accent: "#C8A0E0" }, // dark purple
      { primary: "#1A1A1A", secondary: "#3A3A3A", accent: "#C41E3A" }, // dark Link
    ],
  },

  blurb: "An arrow, a boomerang and a bomb, all in the air at once. Owns the ground he can see.",
};
