/**
 * Fox — fighter 07, the fast-faller.
 *
 * Gravity 0.23 and a fast fall of 3.36: **both the highest numbers in the
 * game**. He gets to the ground faster than anyone, which is what makes his
 * pressure work and what makes him die to an up air at 70%. Run speed 2.402 is
 * top-five. Weight 77 is bottom-ten. He is the whole "glass cannon" archetype
 * expressed as four attributes.
 *
 * **Two corrections worth recording**, because both are widely repeated and
 * both are wrong for Ultimate:
 *
 * 1. **His up smash is frame 8, not frame 2.** The "frame 2" belongs to the
 *    *charge hold*, which is a note on the same row of Ultimate Frame Data and
 *    is routinely misread as the startup. Both UFD and the game's own ACMD
 *    script agree the hitbox is on frame 8. The frame-2 move Fox actually has
 *    is his **jab** — which is encoded as such below.
 * 2. **Reflector is frame 3, and reflects from frame 4.** He is intangible on
 *    frames 2-3. The frame-1 shine is a Melee property that did not survive.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/** UNVERIFIED: hurtbox dimensions are unpublished. About Mario's height and a
 * little narrower — a lean silhouette. */
const HEIGHT = 11.0;
const HALF_WIDTH = 2.0;

export const fox: FighterDef = {
  id: "fox",
  name: "Fox",
  series: "Star Fox",
  number: 7,

  attributes: {
    weight: 77,
    walkSpeed: fx(1.523),
    initialDashSpeed: fx(2.09),
    runSpeed: fx(2.402),
    airSpeed: fx(1.11),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.08),
    // 0.23 gravity and 3.36 fast fall — the highest of each in the game, both
    // raised from Smash 4 (0.19 and 3.28). The gravity figure is his Melee one.
    gravity: fx(0.23),
    fallSpeed: fx(2.1),
    fastFallSpeed: fx(3.36),
    traction: fx(0.115),
    // v = sqrt(2gh): full hop 35 at gravity 0.23 → 4.012. That launch velocity
    // is enormous because the gravity pulling against it is.
    fullHopVelocity: fx(4.012),
    shortHopVelocity: fx(2.747),
    airJumpVelocity: fx(4.126),
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
      // Frame 2. *This* is Fox's frame-2 move.
      totalFrames: 17,
      followUp: "jab2",
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 2,
          x: fx(5.0),
          y: fx(6.6),
          radius: fx(2.4),
          damage: fx(1.8),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(35),
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Jab 2",
      totalFrames: 20,
      followUp: "rapidJab",
      hitboxes: [
        {
          id: 0,
          startFrame: 2,
          endFrame: 2,
          x: fx(5.0),
          y: fx(6.6),
          radius: fx(2.4),
          damage: fx(1.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(35),
        },
      ],
    },

    rapidJab: {
      slot: "rapidJab",
      name: "Rapid Jab",
      totalFrames: 38,
      rapid: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 30,
          x: fx(5.2),
          y: fx(6.6),
          radius: fx(2.4),
          damage: fx(0.6),
          angle: fx(361),
          baseKnockback: fx(7),
          knockbackGrowth: fx(20),
        },
        {
          id: 1,
          startFrame: 33,
          endFrame: 33,
          x: fx(5.6),
          y: fx(6.6),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(361),
          baseKnockback: fx(55),
          knockbackGrowth: fx(130),
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
          startFrame: 6,
          endFrame: 8,
          x: fx(6.4),
          y: fx(5.6),
          radius: fx(3.2),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(80),
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 27,
      hitboxes: [
        {
          // Frame 3, growth 125, angle 110 — a tail flip that starts every
          // combo he has.
          id: 0,
          startFrame: 3,
          endFrame: 5,
          x: fx(0.5),
          y: fx(11.5),
          radius: fx(3.8),
          damage: fx(8.0),
          angle: fx(110),
          baseKnockback: fx(20),
          knockbackGrowth: fx(110),
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 7,
          x: fx(0.5),
          y: fx(11.5),
          radius: fx(3.4),
          damage: fx(5.0),
          angle: fx(110),
          baseKnockback: fx(20),
          knockbackGrowth: fx(125),
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
          startFrame: 7,
          endFrame: 8,
          x: fx(5.5),
          y: fx(1.2),
          radius: fx(3.0),
          damage: fx(8.0),
          angle: fx(77),
          baseKnockback: fx(70),
          knockbackGrowth: fx(50),
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 31,
      hitboxes: [
        {
          // Frame 4 out of a 2.402 run — this is how he closes ground.
          id: 0,
          startFrame: 4,
          endFrame: 7,
          x: fx(4.5),
          y: fx(4.5),
          radius: fx(3.6),
          damage: fx(6.0),
          angle: fx(70),
          baseKnockback: fx(55),
          knockbackGrowth: fx(90),
        },
        {
          id: 1,
          startFrame: 8,
          endFrame: 15,
          x: fx(4.5),
          y: fx(4.5),
          radius: fx(3.2),
          damage: fx(4.0),
          angle: fx(70),
          baseKnockback: fx(40),
          knockbackGrowth: fx(90),
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 45,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 14,
          x: fx(7.5),
          y: fx(6.0),
          radius: fx(4.0),
          damage: fx(14.0),
          angle: fx(361),
          baseKnockback: fx(28),
          knockbackGrowth: fx(100),
        },
        {
          id: 1,
          startFrame: 15,
          endFrame: 16,
          x: fx(7.5),
          y: fx(6.0),
          radius: fx(3.6),
          damage: fx(11.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      // Frame 8. See the correction in the file header — the "frame 2" figure
      // that circulates is the charge hold, not the hitbox.
      totalFrames: 55,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 9,
          x: fx(1.0),
          y: fx(12.0),
          radius: fx(5.7),
          damage: fx(16.0),
          angle: fx(80),
          baseKnockback: fx(30),
          knockbackGrowth: fx(97),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 10,
          endFrame: 11,
          x: fx(1.0),
          y: fx(12.0),
          radius: fx(4.7),
          damage: fx(11.0),
          angle: fx(361),
          baseKnockback: fx(10),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 52,
      chargeable: true,
      hitboxes: [
        {
          // 25 degrees — a semi-spike that sends them offstage rather than up.
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(6.5),
          y: fx(1.4),
          radius: fx(3.6),
          damage: fx(14.0),
          angle: fx(25),
          baseKnockback: fx(30),
          knockbackGrowth: fx(75),
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 7,
          x: fx(3.0),
          y: fx(1.4),
          radius: fx(3.2),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(75),
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 38,
      landingLag: 7,
      autoCancelBefore: 3,
      autoCancelAfter: 32,
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(3.0),
          y: fx(5.0),
          radius: fx(4.2),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(10),
          knockbackGrowth: fx(100),
        },
        {
          // Seventeen frames of a 6% sex kick with *zero* base knockback: at
          // low percent it barely moves the victim, which is the whole point.
          id: 1,
          startFrame: 7,
          endFrame: 23,
          x: fx(3.0),
          y: fx(5.0),
          radius: fx(3.4),
          damage: fx(6.0),
          angle: fx(361),
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 43,
      landingLag: 18,
      hitboxes: [
        // Five kicks on an autolink angle, then a finisher. The autolink (365)
        // is what drags the victim along instead of popping them out early.
        {
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(5.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(1.8),
          angle: fx(365),
          baseKnockback: fx(120),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 11,
          endFrame: 12,
          x: fx(5.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(1.3),
          angle: fx(365),
          baseKnockback: fx(120),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 2,
          startFrame: 16,
          endFrame: 17,
          x: fx(5.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(1.8),
          angle: fx(365),
          baseKnockback: fx(120),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 3,
          startFrame: 21,
          endFrame: 22,
          x: fx(5.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(2.8),
          angle: fx(365),
          baseKnockback: fx(120),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 4,
          startFrame: 26,
          endFrame: 27,
          x: fx(5.2),
          y: fx(6.0),
          radius: fx(3.4),
          damage: fx(4.8),
          angle: fx(70),
          baseKnockback: fx(60),
          knockbackGrowth: fx(103),
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 48,
      landingLag: 9,
      // Autocancels from frame 18, and before frame 6 — an absurdly early
      // window that lets him throw it out of a short hop and land acting.
      autoCancelBefore: 6,
      autoCancelAfter: 18,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 11,
          x: fx(-6.5),
          y: fx(5.5),
          radius: fx(3.6),
          damage: fx(13.0),
          angle: fx(30),
          baseKnockback: fx(20),
          knockbackGrowth: fx(88),
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 35,
      landingLag: 13,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(0.5),
          y: fx(11.5),
          radius: fx(3.6),
          damage: fx(5.0),
          angle: fx(92),
          baseKnockback: fx(30),
          knockbackGrowth: fx(130),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 12,
          endFrame: 13,
          x: fx(0.5),
          y: fx(12.0),
          radius: fx(4.0),
          damage: fx(10.0),
          angle: fx(85),
          baseKnockback: fx(30),
          knockbackGrowth: fx(108),
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 49,
      landingLag: 17,
      hitboxes: [
        // Six drill kicks at 325 degrees — down and forward, dragging the
        // victim with him as he falls — then a 3% launcher.
        {
          id: 0,
          startFrame: 5,
          endFrame: 6,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 1,
          startFrame: 8,
          endFrame: 9,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 2,
          startFrame: 11,
          endFrame: 12,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 3,
          startFrame: 14,
          endFrame: 15,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 4,
          startFrame: 17,
          endFrame: 18,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 5,
          startFrame: 20,
          endFrame: 21,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.0),
          damage: fx(1.4),
          angle: fx(325),
          baseKnockback: fx(20),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
        {
          id: 6,
          startFrame: 23,
          endFrame: 23,
          x: fx(1.0),
          y: fx(-1.5),
          radius: fx(3.4),
          damage: fx(3.0),
          angle: fx(60),
          baseKnockback: fx(50),
          knockbackGrowth: fx(140),
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Blaster",
      totalFrames: 36,
      // A laser fired flat forward from the hip, one shot per ten frames,
      // transcendent so it passes through other hitboxes instead of clanking.
      // Damage decays with distance: 3% point-blank falling to 1.4% far out.
      //
      // **The defining property is that it causes nothing but damage.** Base
      // knockback 0, knockback growth 0, `hitlagMultiplier` 0 — so it produces
      // no launch, no hitstun and no flinch whatsoever. Every other projectile
      // on this roster is a combo starter; this one can never be. It exists to
      // build percent from across the stage and to make the opponent approach,
      // and encoding it any other way would make Fox a completely different
      // character.
      //
      // It also does not disappear on contact, which is what lets a single
      // laser tag two opponents lined up in a four-player match.
      hitboxes: [],
      projectiles: [
        {
          id: "blaster",
          spawnFrame: 11,
          offsetX: fx(7.0),
          offsetY: fx(6.0),
          vx: fx(5.5),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 22,
          destroyOnHit: false,
          visual: "energy",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 22,
            x: fx(0),
            y: fx(0),
            radius: fx(2.0),
            damage: fx(3.0),
            angle: fx(361),
            baseKnockback: fx(0),
            knockbackGrowth: fx(0),
            hitlagMultiplier: fx(0),
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Fox Illusion",
      totalFrames: 55,
      momentum: [{ frame: 18, x: fx(6.2), y: fx(0), hold: 8 }],
      landingLag: 16,
      hitboxes: [
        {
          // The hitboxes trail *behind* him rather than sitting on him, which
          // is why the move passes through opponents and hits on the way out.
          id: 0,
          startFrame: 25,
          endFrame: 29,
          x: fx(-3.0),
          y: fx(5.5),
          radius: fx(4.0),
          damage: fx(8.0),
          angle: fx(85),
          baseKnockback: fx(35),
          knockbackGrowth: fx(110),
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Fire Fox",
      totalFrames: 91,
      // Frame 20, not 42: the wind-up has to be shorter than the fall it is
      // supposed to save you from, and at 42 Fox reached the ground before the
      // burst ever fired.
      momentum: [{ frame: 20, x: fx(1.3), y: fx(4.3), hold: 16 }],
      landingLag: 20,
      hitboxes: [
        {
          // Seven charging hits while he ignites, then the launch.
          id: 0,
          startFrame: 20,
          endFrame: 32,
          x: fx(0),
          y: fx(5.5),
          radius: fx(4.5),
          damage: fx(1.8),
          angle: fx(105),
          baseKnockback: fx(20),
          knockbackGrowth: fx(20),
          effect: "fire",
        },
        {
          id: 1,
          startFrame: 43,
          endFrame: 46,
          x: fx(0),
          y: fx(6.0),
          radius: fx(5.0),
          damage: fx(16.0),
          angle: fx(60),
          baseKnockback: fx(70),
          knockbackGrowth: fx(60),
          effect: "fire",
        },
        {
          id: 2,
          startFrame: 47,
          endFrame: 72,
          x: fx(0),
          y: fx(6.0),
          radius: fx(4.5),
          damage: fx(10.0),
          angle: fx(60),
          baseKnockback: fx(85),
          knockbackGrowth: fx(50),
          effect: "fire",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Reflector",
      totalFrames: 36,
      // Frame 3 hitbox, intangible on frames 2-3, and it **reflects from frame
      // 4 through 23** at 1.4x damage. See the correction in the file header:
      // this is not the frame-1 shine from Melee. Ultimate also lets it stall
      // his momentum only once per airtime.
      hitboxes: [
        {
          id: 0,
          startFrame: 3,
          endFrame: 3,
          x: fx(2.0),
          y: fx(5.5),
          radius: fx(4.0),
          damage: fx(2.0),
          angle: fx(10),
          baseKnockback: fx(66),
          knockbackGrowth: fx(32),
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
          startFrame: 6,
          endFrame: 7,
          x: fx(6.0),
          y: fx(6.4),
          radius: fx(3.0),
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
          startFrame: 10,
          endFrame: 11,
          x: fx(7.0),
          y: fx(6.4),
          radius: fx(3.0),
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
          y: fx(8.0),
          radius: fx(4.0),
          damage: fx(1.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(100),
          setKnockback: true,
        },
      ],
    },

    /**
     * All four of Fox's throws fire Blaster shots at bystanders during the
     * animation — 2% each, flinchless, on the frames noted per move. Those are
     * article hitboxes rather than throw hitboxes, so what is encoded here is
     * the throw itself.
     */
    fthrow: {
      slot: "fthrow",
      name: "Forward Throw",
      totalFrames: 33,
      hitboxes: [
        {
          id: 0,
          startFrame: 11,
          endFrame: 11,
          x: fx(4.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(40),
          baseKnockback: fx(35),
          knockbackGrowth: fx(130),
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
          startFrame: 10,
          endFrame: 10,
          x: fx(-4.0),
          y: fx(6.0),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(56),
          baseKnockback: fx(80),
          knockbackGrowth: fx(85),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 49,
      hitboxes: [
        {
          id: 0,
          startFrame: 7,
          endFrame: 7,
          x: fx(0),
          y: fx(8.0),
          radius: fx(3.0),
          damage: fx(2.0),
          angle: fx(90),
          baseKnockback: fx(75),
          knockbackGrowth: fx(110),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 54,
      hitboxes: [
        {
          // 1% — the lowest-damage throw on the roster. It exists to put them
          // in front of him, not to hurt them.
          id: 0,
          startFrame: 34,
          endFrame: 34,
          x: fx(2.0),
          y: fx(1.0),
          radius: fx(3.0),
          damage: fx(1.0),
          angle: fx(60),
          baseKnockback: fx(85),
          knockbackGrowth: fx(100),
        },
      ],
    },
  },

  palette: {
    // Fur, pulled toward tan-gold rather than the pure orange it is usually
    // drawn as. Samus is also orange, and at the size these capsules render
    // the two were indistinguishable — so Fox takes the yellower half of the
    // hue and keeps his white jacket as the real identifying mark.
    primary: "#C99B4A",
    secondary: "#F0F0F0", // the flight jacket
    accent: "#2B7FD4", // jacket trim and boots
    skin: "#F5D9B0",
    outline: "#2A1608",
    alts: [
      { primary: "#8B5A2B", secondary: "#3A3A3A", accent: "#C41E3A" }, // brown/black
      { primary: "#D8D8D8", secondary: "#5A5A5A", accent: "#2E8B37" }, // grey/green
      { primary: "#F0C040", secondary: "#4A2A6A", accent: "#FFFFFF" }, // gold/purple
      { primary: "#6A4A8C", secondary: "#E0D8F0", accent: "#F0C040" }, // purple
      { primary: "#2A2A2A", secondary: "#8A1010", accent: "#E8862A" }, // dark
    ],
  },

  blurb: "The highest gravity and the fastest fall in the game. Everything happens to him quickly, including dying.",
};
