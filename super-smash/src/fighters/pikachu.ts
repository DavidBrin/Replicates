/**
 * Pikachu — fighter 10, the speed archetype.
 *
 * The tiny hurtbox is the character. SmashWiki calls it "extremely small" and
 * "incredibly small", and pairs it with a frame-2 air dodge to explain why he
 * is among the hardest fighters in the game to combo — attacks whiff over the
 * top of him that would connect on anyone else. Encoding that here is a matter
 * of the `width`/`height` below being genuinely small rather than a flag
 * somewhere saying "small".
 *
 * **His jab is a single looping attack, not a three-hit string.** There is no
 * jab 2 and no jab 3 — Ultimate Frame Data lists one "Jab" and the game data
 * has no `Attack12`. It is encoded in the `rapidJab` slot, which is what it is.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/**
 * UNVERIFIED: hurtbox dimensions are unpublished, as they are for everyone.
 * But the *relative* size is well documented, and it is the point of the
 * character — this is deliberately the smallest box on the roster alongside
 * Kirby's, a little over half Mario's height.
 */
const HEIGHT = 6.9;
const HALF_WIDTH = 1.8;

export const pikachu: FighterDef = {
  id: "pikachu",
  name: "Pikachu",
  series: "Pokémon",
  number: 10,

  attributes: {
    weight: 79,
    walkSpeed: fx(1.302),
    initialDashSpeed: fx(1.98),
    runSpeed: fx(2.039),
    airSpeed: fx(0.957),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.09),
    gravity: fx(0.095),
    fallSpeed: fx(1.55),
    fastFallSpeed: fx(2.48),
    // 0.132 — the highest traction of these eight. He stops when he decides to.
    traction: fx(0.132),
    // v = sqrt(2gh): full hop 35.5 at gravity 0.095 → 2.597.
    fullHopVelocity: fx(2.597),
    shortHopVelocity: fx(1.804),
    airJumpVelocity: fx(2.597),
    jumps: 2,
    canWallJump: true,
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

  moves: {
    /**
     * The looping jab. `rapidJab` rather than `jab1` because that is what it
     * is — hold attack and it repeats, with no second or third stage to
     * transition into. `jab1` is populated with the same hitbox so that code
     * asking "what does this fighter's jab do" gets an answer.
     */
    jab1: {
      slot: "jab1",
      name: "Jab",
      totalFrames: 17,
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 3,
          x: fx(3.2),
          y: fx(3.0),
          radius: fx(2.2),
          damage: fx(1.4),
          angle: fx(0),
          baseKnockback: fx(12),
          knockbackGrowth: fx(20),
        },
      ],
    },

    rapidJab: {
      slot: "rapidJab",
      name: "Jab (looping)",
      totalFrames: 17,
      rapid: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 3,
          x: fx(3.2),
          y: fx(3.0),
          radius: fx(2.2),
          damage: fx(1.4),
          angle: fx(0),
          baseKnockback: fx(12),
          knockbackGrowth: fx(20),
        },
        {
          id: 1,
          startFrame: 2,
          endFrame: 3,
          x: fx(2.0),
          y: fx(3.0),
          radius: fx(2.0),
          damage: fx(1.0),
          angle: fx(0),
          baseKnockback: fx(18),
          knockbackGrowth: fx(30),
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 29,
      hitboxes: [
        {
          // Angleable, and unusually the *up* angle is the strong one at 10%.
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(4.4),
          y: fx(2.8),
          radius: fx(2.8),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(15),
          knockbackGrowth: fx(100),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 26,
      hitboxes: [
        {
          // Angle 105, knockback growth 120, base 40 — a tail flick that pops
          // them straight up at a height he can follow. This is his premier
          // combo starter and the reason he snowballs.
          id: 0,
          startFrame: 7,
          endFrame: 13,
          x: fx(0.4),
          y: fx(7.6),
          radius: fx(3.0),
          damage: fx(5.0),
          angle: fx(105),
          baseKnockback: fx(40),
          knockbackGrowth: fx(120),
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 18,
      hitboxes: [
        {
          // FAF 18 — the fastest-recovering grounded attack in this directory.
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(3.6),
          y: fx(0.8),
          radius: fx(2.4),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(12),
          knockbackGrowth: fx(100),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 35,
      hitboxes: [
        {
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(3.4),
          y: fx(2.8),
          radius: fx(3.2),
          damage: fx(11.0),
          angle: fx(60),
          baseKnockback: fx(70),
          knockbackGrowth: fx(88),
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 12,
          x: fx(3.4),
          y: fx(2.8),
          radius: fx(2.8),
          damage: fx(6.0),
          angle: fx(70),
          baseKnockback: fx(100),
          knockbackGrowth: fx(50),
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 53,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 17,
          endFrame: 19,
          x: fx(5.4),
          y: fx(3.4),
          radius: fx(3.4),
          damage: fx(18.0),
          angle: fx(45),
          baseKnockback: fx(50),
          knockbackGrowth: fx(75),
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 16,
          x: fx(5.0),
          y: fx(3.4),
          radius: fx(3.2),
          damage: fx(15.0),
          angle: fx(45),
          baseKnockback: fx(50),
          knockbackGrowth: fx(73),
          effect: "electric",
        },
        {
          id: 2,
          startFrame: 20,
          endFrame: 29,
          x: fx(5.4),
          y: fx(3.4),
          radius: fx(3.0),
          damage: fx(12.0),
          angle: fx(45),
          baseKnockback: fx(40),
          knockbackGrowth: fx(102),
          effect: "electric",
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 44,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 10,
          endFrame: 12,
          x: fx(0.4),
          y: fx(8.0),
          radius: fx(3.4),
          damage: fx(14.0),
          angle: fx(87),
          baseKnockback: fx(50),
          knockbackGrowth: fx(89),
        },
        {
          id: 1,
          startFrame: 13,
          endFrame: 14,
          x: fx(0.4),
          y: fx(8.0),
          radius: fx(3.2),
          damage: fx(11.0),
          angle: fx(85),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
        },
        {
          id: 2,
          startFrame: 15,
          endFrame: 17,
          x: fx(0.4),
          y: fx(8.0),
          radius: fx(3.0),
          damage: fx(7.0),
          angle: fx(80),
          baseKnockback: fx(55),
          knockbackGrowth: fx(48),
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 65,
      chargeable: true,
      hitboxes: [
        // Five spinning hits at 178 degrees — almost straight backwards, which
        // is what keeps the victim inside the spin — then a 3% finisher whose
        // knockback growth of 192 is the highest anywhere in this directory.
        {
          id: 0,
          startFrame: 8,
          endFrame: 9,
          x: fx(3.4),
          y: fx(1.0),
          radius: fx(2.8),
          damage: fx(2.0),
          angle: fx(178),
          baseKnockback: fx(65),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 11,
          endFrame: 12,
          x: fx(3.4),
          y: fx(1.0),
          radius: fx(2.8),
          damage: fx(2.0),
          angle: fx(178),
          baseKnockback: fx(65),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 2,
          startFrame: 14,
          endFrame: 15,
          x: fx(3.4),
          y: fx(1.0),
          radius: fx(2.8),
          damage: fx(2.0),
          angle: fx(178),
          baseKnockback: fx(65),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 3,
          startFrame: 17,
          endFrame: 18,
          x: fx(3.4),
          y: fx(1.0),
          radius: fx(2.8),
          damage: fx(2.0),
          angle: fx(178),
          baseKnockback: fx(65),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 4,
          startFrame: 20,
          endFrame: 21,
          x: fx(3.4),
          y: fx(1.0),
          radius: fx(2.8),
          damage: fx(2.0),
          angle: fx(178),
          baseKnockback: fx(65),
          knockbackGrowth: fx(30),
          effect: "electric",
        },
        {
          id: 5,
          startFrame: 23,
          endFrame: 23,
          x: fx(3.6),
          y: fx(1.0),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(37),
          baseKnockback: fx(51),
          knockbackGrowth: fx(192),
          effect: "electric",
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 38,
      landingLag: 9,
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 18,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.4),
          damage: fx(1.8),
          angle: fx(365),
          baseKnockback: fx(45),
          knockbackGrowth: fx(80),
          setKnockback: true,
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 21,
          endFrame: 22,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.6),
          damage: fx(3.5),
          angle: fx(60),
          baseKnockback: fx(50),
          knockbackGrowth: fx(140),
          effect: "electric",
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 41,
      landingLag: 12,
      hitboxes: [
        {
          // A drill of five hits that rehits every three frames, then a
          // finisher. Two of the loop hitboxes point at 280-290 degrees, which
          // is what drags an airborne victim downward through the move.
          id: 0,
          startFrame: 11,
          endFrame: 25,
          x: fx(3.4),
          y: fx(3.4),
          radius: fx(2.8),
          damage: fx(1.4),
          angle: fx(290),
          baseKnockback: fx(45),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 27,
          endFrame: 27,
          x: fx(3.6),
          y: fx(3.4),
          radius: fx(3.0),
          damage: fx(4.8),
          angle: fx(48),
          baseKnockback: fx(40),
          knockbackGrowth: fx(154),
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 43,
      landingLag: 18,
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 21,
          x: fx(-3.4),
          y: fx(3.2),
          radius: fx(2.6),
          damage: fx(1.0),
          angle: fx(365),
          baseKnockback: fx(40),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 24,
          endFrame: 25,
          x: fx(-3.6),
          y: fx(3.2),
          radius: fx(2.8),
          damage: fx(3.6),
          angle: fx(45),
          baseKnockback: fx(40),
          knockbackGrowth: fx(160),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 26,
      landingLag: 14,
      hitboxes: [
        {
          // Frame 4, FAF 26. He can throw three of these in one full hop.
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(0.4),
          y: fx(7.4),
          radius: fx(3.0),
          damage: fx(6.0),
          angle: fx(68),
          baseKnockback: fx(50),
          knockbackGrowth: fx(113),
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 8,
          x: fx(0.4),
          y: fx(7.4),
          radius: fx(2.8),
          damage: fx(4.0),
          angle: fx(55),
          baseKnockback: fx(40),
          knockbackGrowth: fx(80),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 47,
      landingLag: 22,
      hitboxes: [
        {
          id: 0,
          startFrame: 14,
          endFrame: 15,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(3.0),
          damage: fx(13.0),
          angle: fx(270),
          baseKnockback: fx(16),
          knockbackGrowth: fx(86),
          meteor: true,
        },
        {
          id: 1,
          startFrame: 16,
          endFrame: 26,
          x: fx(0),
          y: fx(-1.4),
          radius: fx(2.8),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(84),
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Thunder Jolt",
      totalFrames: 51,
      // Fired as an arc that then **rolls along the floor**, hugging the
      // terrain — which is the whole reason it is useful. Pikachu can run
      // alongside it to approach, and it covers grounded escape options while
      // he is cornered. The gravity and the bounce count below are what produce
      // that skipping ground-hugging path; a zero-gravity version would be a
      // completely different move.
      //
      // It weakens over a very long life — 6% fresh, 5% from frame 53, 4% from
      // frame 86 — which `ProjectileDef` has no field for, so what is encoded
      // is the clean hit. Reflectable and absorbable. Every phase uses the
      // Sakurai angle with low knockback: pressure and combo tool, never a kill.
      hitboxes: [],
      projectiles: [
        {
          id: "thunderJolt",
          spawnFrame: 19,
          offsetX: fx(4.0),
          offsetY: fx(2.6),
          vx: fx(1.6),
          vy: fx(0.2),
          gravity: fx(0.05),
          lifetime: 95,
          destroyOnHit: true,
          bounces: 8,
          visual: "spark",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 95,
            x: fx(0),
            y: fx(0),
            radius: fx(2.4),
            damage: fx(6.0),
            angle: fx(361),
            baseKnockback: fx(18),
            knockbackGrowth: fx(20),
            effect: "electric",
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Skull Bash",
      totalFrames: 96,
      chargeable: true,
      hitboxes: [
        {
          // Charges from frames 13-14 and launches him forward. Damage scales
          // 6.2% uncharged → 10% on a smash input → 21.4% at full charge. FAF
          // 96 grounded, 74 aerial, dropping to 21 frames of endlag on hit. It
          // recovers horizontally and can sweetspot a ledge, but the hitbox
          // sits inside his own hurtbox, so trading with it loses.
          id: 0,
          startFrame: 18,
          endFrame: 25,
          x: fx(3.4),
          y: fx(3.2),
          radius: fx(3.2),
          damage: fx(6.2),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(78),
        },
        {
          id: 1,
          startFrame: 26,
          endFrame: 52,
          x: fx(3.4),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(6.2),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(78),
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Quick Attack",
      totalFrames: 52,
      landingLag: 24,
      // **Two segments.** He zips once in the direction held, then immediately
      // zips again in a second, independently aimed direction. The second dash
      // only comes out if its angle differs from the first by at least thirty
      // degrees — hold the same direction twice and you get one dash and a
      // helpless fall. Segment two is the one with the knockback: growth jumps
      // from 50 to 150 between them.
      hitboxes: [
        {
          id: 0,
          startFrame: 15,
          endFrame: 19,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(70),
          baseKnockback: fx(20),
          knockbackGrowth: fx(50),
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 29,
          endFrame: 33,
          x: fx(0),
          y: fx(3.2),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(70),
          baseKnockback: fx(20),
          knockbackGrowth: fx(150),
          effect: "electric",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Thunder",
      totalFrames: 86,
      // PROJECTILE: a cloud spawns above him on frame 2 and a bolt descends
      // from offscreen. Three distinct pieces, all below: the bolt's leading
      // edge **meteors at a literal 270 degrees**, the body of the bolt is the
      // 8% hit, and if the bolt reaches Pikachu himself it detonates into a 15%
      // shockwave — the strong hit, and the one his up throw and down throw
      // both combo into. He is invulnerable on frames 34-43 when that happens.
      // FAF 86 if the bolt misses him, 74 if it connects.
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 15,
          x: fx(0),
          y: fx(16.0),
          radius: fx(3.0),
          damage: fx(6.0),
          angle: fx(270),
          baseKnockback: fx(125),
          knockbackGrowth: fx(60),
          setKnockback: true,
          meteor: true,
          effect: "electric",
        },
        {
          id: 1,
          startFrame: 16,
          endFrame: 85,
          x: fx(0),
          y: fx(11.0),
          radius: fx(3.0),
          damage: fx(8.0),
          angle: fx(70),
          baseKnockback: fx(74),
          knockbackGrowth: fx(60),
          effect: "electric",
        },
        {
          id: 2,
          startFrame: 16,
          endFrame: 17,
          x: fx(0),
          y: fx(3.0),
          radius: fx(5.5),
          damage: fx(15.0),
          angle: fx(361),
          baseKnockback: fx(70),
          knockbackGrowth: fx(77),
          effect: "electric",
        },
      ],
    },

    grab: {
      slot: "grab",
      name: "Grab",
      totalFrames: 36,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(3.8),
          y: fx(3.2),
          radius: fx(2.6),
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
      totalFrames: 44,
      hitboxes: [
        {
          id: 0,
          startFrame: 11,
          endFrame: 12,
          x: fx(4.6),
          y: fx(3.2),
          radius: fx(2.6),
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
      totalFrames: 16,
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
          effect: "electric",
        },
      ],
    },

    fthrow: {
      slot: "fthrow",
      name: "Forward Throw",
      totalFrames: 43,
      hitboxes: [
        {
          id: 0,
          startFrame: 30,
          endFrame: 30,
          x: fx(3.0),
          y: fx(3.0),
          radius: fx(2.5),
          damage: fx(2.0),
          angle: fx(45),
          baseKnockback: fx(55),
          knockbackGrowth: fx(110),
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
          startFrame: 26,
          endFrame: 26,
          x: fx(-3.0),
          y: fx(3.0),
          radius: fx(2.5),
          damage: fx(9.0),
          angle: fx(135),
          baseKnockback: fx(85),
          knockbackGrowth: fx(50),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 35,
      hitboxes: [
        {
          // FAF 35 and angle 90 — fast enough to combo directly into Thunder.
          id: 0,
          startFrame: 16,
          endFrame: 16,
          x: fx(0),
          y: fx(5.0),
          radius: fx(2.5),
          damage: fx(5.0),
          angle: fx(90),
          baseKnockback: fx(48),
          knockbackGrowth: fx(129),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 51,
      hitboxes: [
        {
          // UNVERIFIED (release frame): Ultimate Frame Data puts the throw on
          // frame 29 with FAF 51; SmashWiki puts it on 21 with an interrupt at
          // 44. The disagreement is real and survived a re-fetch of both. UFD's
          // is used here for consistency with every other frame in this file.
          id: 0,
          startFrame: 29,
          endFrame: 29,
          x: fx(2.0),
          y: fx(1.0),
          radius: fx(2.5),
          damage: fx(5.0),
          angle: fx(83),
          baseKnockback: fx(60),
          knockbackGrowth: fx(100),
        },
      ],
    },
  },

  palette: {
    primary: "#F5D547", // the yellow
    secondary: "#8B5A2B", // the ear tips and back stripes
    accent: "#E8433C", // cheek pouches
    skin: "#F5D547",
    outline: "#4A3208",
    alts: [
      { primary: "#F5D547", secondary: "#2A2A2A", accent: "#E8433C" }, // party hat black
      { primary: "#F0C020", secondary: "#5A3A1A", accent: "#3A6FD4" }, // goggles blue
      { primary: "#FFE87C", secondary: "#A87840", accent: "#2E8B37" }, // pale, green
      { primary: "#E8A030", secondary: "#6A3A10", accent: "#F0F0F0" }, // deep orange
      { primary: "#F5D547", secondary: "#8B2FA0", accent: "#C060E0" }, // purple trim
    ],
  },

  blurb: "A hurtbox that half the roster's attacks pass straight over, moving at speed.",
};
