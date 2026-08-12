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
 * airborne victims — see `SAKURAI_ANGLE` in `engine/constants.ts`.
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
import type { FighterDef } from "@/engine/types";

/** Mario's hurtbox is about eleven units tall — a shade over a seventh of
 * Battlefield's width, which is the scale the whole game is drawn at.
 * UNVERIFIED: hurtbox dimensions are not published by SmashWiki, UFD or the
 * ACMD dump; these are read off his model's proportions against the hitbox
 * coordinates above (his down air's landing hitbox is centred at y 6.8 with a
 * radius of 11, and his jab sits at chest height y 6.3). */
const HEIGHT = 11.0;
const HALF_WIDTH = 2.0;

export const mario: FighterDef = {
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
    width: fx(HALF_WIDTH),
    height: fx(HEIGHT),
    jumpSquatFrames: 3,
  },

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
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 39,
      chargeable: true,
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
        // then one real hit on frame 23 that launches.
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
          setKnockback: true,
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
          setKnockback: true,
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
          setKnockback: true,
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
          setKnockback: true,
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
          setKnockback: true,
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
          // whole character of the move. It hops four times before expiring,
          // and dies on contact. Reflectable and absorbable.
          id: "fireball",
          spawnFrame: 17,
          offsetX: fx(5.2),
          offsetY: fx(6.4),
          vx: fx(1.9),
          vy: fx(0.35),
          gravity: fx(0.06),
          lifetime: 70,
          destroyOnHit: true,
          bounces: 4,
          visual: "fire",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 70,
            x: fx(0),
            y: fx(0),
            radius: fx(2.6),
            damage: fx(5.0),
            angle: fx(361),
            baseKnockback: fx(20),
            knockbackGrowth: fx(30),
            effect: "fire",
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Cape",
      totalFrames: 35,
      // The Cape's real job is not its 7%: it reverses an opponent's facing and
      // reflects projectiles at 1.5x. Neither is expressible in `Hitbox`, so
      // both are engine behaviour keyed off this slot.
      hitboxes: [
        {
          id: 0,
          startFrame: 12,
          endFrame: 14,
          x: fx(5.6),
          y: fx(6.0),
          radius: fx(4.0),
          damage: fx(7.0),
          angle: fx(70),
          baseKnockback: fx(50),
          knockbackGrowth: fx(60),
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Super Jump Punch",
      totalFrames: 55,
      momentum: [{ frame: 4, x: fx(0.5), y: fx(2.9), hold: 12 }],
      landingLag: 30,
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
          baseKnockback: fx(150),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          baseKnockback: fx(170),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
      totalFrames: 48,
      // Deals no damage at all — it charges, then pushes. The push scales with
      // charge and is pure horizontal velocity applied to anyone in the stream,
      // which is engine behaviour with no hitbox to hang it on. The empty array
      // is correct and deliberate, not an omission.
      hitboxes: [],
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
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
