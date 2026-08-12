/**
 * Marth — fighter 13, the sword spacer, and the reason `Hitbox.id` exists.
 *
 * ── the tipper ─────────────────────────────────────────────────────────────
 *
 * Almost every move Marth has carries **two hitboxes on the same frames**: the
 * point of the blade, and everything closer in. The tip does markedly more, so
 * his whole game is standing at exactly the distance where the tip lands and
 * the body does not — the opposite of every other fighter, who wants to be
 * close.
 *
 * The schema expresses this without needing a "tipper" flag. Two hitboxes,
 * identical frames, different positions, and **the tip takes the lower `id`**:
 * `Hitbox.id` is documented as "lower id wins when two of a fighter's own
 * hitboxes overlap a target", so when both would connect the tip is the one
 * that resolves. Placing it further out along `x` and giving it the smaller id
 * is the entire mechanic.
 *
 * How much more the tip does varies by move, and *where* the bonus sits matters
 * more than its size:
 *
 * - **Forward smash** — 13% → 18%, and base knockback 48 → 80. The gap is
 *   front-loaded, so the tipper KOs by the ledge at around 40% while the body
 *   hit waits until 115%. The biggest payoff in his kit.
 * - **Back air** — 9% → 12.5%, base knockback unchanged, growth 85 → 94. The
 *   bonus is in *scaling*, so the gap widens with percent.
 * - **Forward air** — 8% → 11.5%, but base knockback and growth are byte-for-
 *   byte identical. Every bit of the extra launch comes from the damage term
 *   feeding the knockback formula, which makes it the weakest tipper payoff
 *   despite the largest percentage damage jump.
 * - **Down tilt** — 7% → 10%, base knockback 40 → 50, growth unchanged. Nearly
 *   flat across percent. Both variants semi-spike at 30 degrees.
 *
 * ── two things people get wrong ───────────────────────────────────────────
 *
 * **Marth has no jab 3.** His jab is a two-hit string; there is no `Attack13`
 * script for him and Ultimate Frame Data lists only two.
 *
 * **His down air tipper does not spike.** The tip launches at the Sakurai
 * angle. The meteor is a *separate* hitbox mounted below and slightly behind
 * his body, active on frame 11 and frame 11 only, and it does *more* damage
 * than the tip (15% against 14%). Down air is the one move where the reward is
 * hitting the sourspot region, and both are encoded below.
 *
 * **He cannot wall jump** — he is absent from SmashWiki's wall-jump roster.
 *
 * Sources and conventions as documented at the top of `mario.ts`.
 */

import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";

/** UNVERIFIED: hurtbox dimensions are unpublished. Marth is tall and narrow —
 * the tallest of these eight bar Donkey Kong, and among the thinnest. The
 * sword adds reach without adding hurtbox, which is the whole shape of him. */
const HEIGHT = 13.0;
const HALF_WIDTH = 2.0;

/**
 * How far out the blade's point sits, and where the body of the blade is.
 *
 * Naming them makes the spacing legible: every tipper hitbox in this file is at
 * `TIP_REACH` and every body hitbox at `BODY_REACH`, so the gap Marth players
 * spend the match managing is one subtraction rather than sixteen pairs of
 * unrelated magic numbers.
 */
const TIP_REACH = 11.0;
const BODY_REACH = 6.0;

export const marth: FighterDef = {
  id: "marth",
  name: "Marth",
  series: "Fire Emblem",
  number: 13,

  attributes: {
    weight: 90,
    // 1.575 — the fastest walk in the game, tied with Lucina.
    walkSpeed: fx(1.575),
    initialDashSpeed: fx(2.255),
    runSpeed: fx(1.964),
    airSpeed: fx(1.071),
    airAccelBase: fx(0.01),
    airAccelAdditional: fx(0.07),
    gravity: fx(0.075),
    fallSpeed: fx(1.58),
    fastFallSpeed: fx(2.528),
    traction: fx(0.114),
    // v = sqrt(2gh): full hop 33.66 at gravity 0.075 → 2.247.
    fullHopVelocity: fx(2.247),
    shortHopVelocity: fx(1.562),
    airJumpVelocity: fx(2.247),
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
      totalFrames: 25,
      followUp: "jab2",
      hitboxes: [
        {
          // The tipper here fires at **angle 180** — straight backwards, into
          // Marth. It pulls the victim toward him so that jab 2 connects, which
          // is the opposite of what a stronger hit usually does.
          id: 0,
          startFrame: 5,
          endFrame: 6,
          x: fx(TIP_REACH),
          y: fx(8.0),
          radius: fx(2.4),
          damage: fx(5.0),
          angle: fx(180),
          baseKnockback: fx(30),
          knockbackGrowth: fx(12),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 5,
          endFrame: 6,
          x: fx(BODY_REACH),
          y: fx(8.0),
          radius: fx(2.8),
          damage: fx(3.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(12),
          effect: "slash",
        },
      ],
    },

    jab2: {
      slot: "jab2",
      name: "Jab 2",
      totalFrames: 28,
      hitboxes: [
        {
          // Knockback-identical to its body hit — a pure +2% damage variant,
          // and the only move on Marth where the tip changes nothing but the
          // number on the meter.
          id: 0,
          startFrame: 4,
          endFrame: 5,
          x: fx(TIP_REACH),
          y: fx(8.0),
          radius: fx(2.4),
          damage: fx(6.0),
          angle: fx(45),
          baseKnockback: fx(62),
          knockbackGrowth: fx(75),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 4,
          endFrame: 5,
          x: fx(BODY_REACH),
          y: fx(8.0),
          radius: fx(2.8),
          damage: fx(4.0),
          angle: fx(45),
          baseKnockback: fx(62),
          knockbackGrowth: fx(75),
          effect: "slash",
        },
      ],
    },

    ftilt: {
      slot: "ftilt",
      name: "Forward Tilt",
      totalFrames: 33,
      hitboxes: [
        {
          id: 0,
          startFrame: 8,
          endFrame: 11,
          x: fx(TIP_REACH),
          y: fx(7.0),
          radius: fx(2.4),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(55),
          knockbackGrowth: fx(85),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 8,
          endFrame: 11,
          x: fx(BODY_REACH),
          y: fx(7.0),
          radius: fx(2.8),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(70),
          effect: "slash",
        },
      ],
    },

    utilt: {
      slot: "utilt",
      name: "Up Tilt",
      totalFrames: 33,
      hitboxes: [
        {
          // The tip *doubles* the damage here — 10% against 5% — with knockback
          // untouched. The arc sweeps overhead, so the tip is high, not far.
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(2.0),
          y: fx(16.0),
          radius: fx(2.4),
          damage: fx(10.0),
          angle: fx(100),
          baseKnockback: fx(65),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 8,
          x: fx(1.0),
          y: fx(11.0),
          radius: fx(2.8),
          damage: fx(5.0),
          angle: fx(100),
          baseKnockback: fx(65),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 9,
          endFrame: 12,
          x: fx(1.0),
          y: fx(13.0),
          radius: fx(2.8),
          damage: fx(6.0),
          angle: fx(85),
          baseKnockback: fx(52),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
      ],
    },

    dtilt: {
      slot: "dtilt",
      name: "Down Tilt",
      totalFrames: 23,
      hitboxes: [
        {
          // Both variants semi-spike at 30 degrees; the tip just does it
          // harder. FAF 23 makes it his safest poke by a distance.
          id: 0,
          startFrame: 7,
          endFrame: 8,
          x: fx(TIP_REACH),
          y: fx(1.4),
          radius: fx(2.2),
          damage: fx(10.0),
          angle: fx(30),
          baseKnockback: fx(50),
          knockbackGrowth: fx(40),
          effect: "stab",
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 8,
          x: fx(BODY_REACH),
          y: fx(1.4),
          radius: fx(2.6),
          damage: fx(7.0),
          angle: fx(30),
          baseKnockback: fx(40),
          knockbackGrowth: fx(40),
          effect: "stab",
        },
      ],
    },

    dashAttack: {
      slot: "dashAttack",
      name: "Dash Attack",
      totalFrames: 49,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 16,
          x: fx(TIP_REACH),
          y: fx(6.0),
          radius: fx(2.4),
          damage: fx(13.0),
          angle: fx(45),
          baseKnockback: fx(93),
          knockbackGrowth: fx(58),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 13,
          endFrame: 16,
          x: fx(7.5),
          y: fx(6.0),
          radius: fx(2.6),
          damage: fx(10.0),
          angle: fx(45),
          baseKnockback: fx(70),
          knockbackGrowth: fx(55),
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 13,
          endFrame: 16,
          x: fx(4.0),
          y: fx(6.0),
          radius: fx(2.8),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(35),
          knockbackGrowth: fx(60),
          effect: "slash",
        },
      ],
    },

    fsmash: {
      slot: "fsmash",
      name: "Forward Smash",
      totalFrames: 51,
      chargeable: true,
      hitboxes: [
        {
          // The signature. 18% against 13%, and base knockback 80 against 48 —
          // the only move where *both* halves of the knockback formula jump.
          id: 0,
          startFrame: 10,
          endFrame: 13,
          x: fx(TIP_REACH),
          y: fx(7.5),
          radius: fx(2.6),
          damage: fx(18.0),
          angle: fx(361),
          baseKnockback: fx(80),
          knockbackGrowth: fx(80),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 10,
          endFrame: 13,
          x: fx(BODY_REACH),
          y: fx(7.5),
          radius: fx(3.0),
          damage: fx(13.0),
          angle: fx(361),
          baseKnockback: fx(48),
          knockbackGrowth: fx(75),
          effect: "slash",
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 58,
      chargeable: true,
      hitboxes: [
        {
          id: 0,
          startFrame: 13,
          endFrame: 17,
          x: fx(1.5),
          y: fx(17.0),
          radius: fx(2.6),
          damage: fx(17.0),
          angle: fx(89),
          baseKnockback: fx(40),
          knockbackGrowth: fx(95),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 13,
          endFrame: 17,
          x: fx(1.0),
          y: fx(12.0),
          radius: fx(3.0),
          damage: fx(13.0),
          angle: fx(89),
          baseKnockback: fx(45),
          knockbackGrowth: fx(90),
          effect: "slash",
        },
        {
          // A set-knockback launcher that only touches *grounded* opponents —
          // it scoops them off the floor into the blade above.
          id: 2,
          startFrame: 13,
          endFrame: 14,
          x: fx(2.0),
          y: fx(2.0),
          radius: fx(3.0),
          damage: fx(3.0),
          angle: fx(125),
          baseKnockback: fx(155),
          knockbackGrowth: fx(100),
          setKnockback: true,
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
          startFrame: 6,
          endFrame: 7,
          x: fx(TIP_REACH),
          y: fx(1.4),
          radius: fx(2.4),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(57),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 7,
          x: fx(BODY_REACH),
          y: fx(1.4),
          radius: fx(2.8),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
        {
          // The back half lands fifteen frames later and hits harder — 17% on
          // the tip against the front's 12%.
          id: 2,
          startFrame: 21,
          endFrame: 23,
          x: fx(-TIP_REACH),
          y: fx(1.4),
          radius: fx(2.4),
          damage: fx(17.0),
          angle: fx(361),
          baseKnockback: fx(50),
          knockbackGrowth: fx(92),
          effect: "slash",
        },
        {
          id: 3,
          startFrame: 21,
          endFrame: 23,
          x: fx(-BODY_REACH),
          y: fx(1.4),
          radius: fx(2.8),
          damage: fx(12.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(88),
          effect: "slash",
        },
      ],
    },

    nair: {
      slot: "nair",
      name: "Neutral Air",
      totalFrames: 49,
      landingLag: 7,
      autoCancelAfter: 47,
      hitboxes: [
        // Two swings, each with its own tipper.
        {
          id: 0,
          startFrame: 6,
          endFrame: 7,
          x: fx(TIP_REACH),
          y: fx(6.5),
          radius: fx(2.4),
          damage: fx(5.0),
          angle: fx(90),
          baseKnockback: fx(35),
          knockbackGrowth: fx(50),
          setKnockback: true,
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 7,
          x: fx(BODY_REACH),
          y: fx(6.5),
          radius: fx(2.8),
          damage: fx(3.5),
          angle: fx(75),
          baseKnockback: fx(45),
          knockbackGrowth: fx(50),
          setKnockback: true,
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 15,
          endFrame: 21,
          x: fx(-TIP_REACH),
          y: fx(6.5),
          radius: fx(2.4),
          damage: fx(9.5),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(100),
          effect: "slash",
        },
        {
          id: 3,
          startFrame: 15,
          endFrame: 21,
          x: fx(-BODY_REACH),
          y: fx(6.5),
          radius: fx(2.8),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(50),
          knockbackGrowth: fx(90),
          effect: "slash",
        },
      ],
    },

    fair: {
      slot: "fair",
      name: "Forward Air",
      totalFrames: 37,
      landingLag: 10,
      autoCancelAfter: 36,
      hitboxes: [
        {
          // Base knockback and growth are *identical* between these two. All of
          // the tipper's extra launch comes from the damage term.
          id: 0,
          startFrame: 6,
          endFrame: 8,
          x: fx(TIP_REACH),
          y: fx(7.0),
          radius: fx(2.4),
          damage: fx(11.5),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(80),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 8,
          x: fx(BODY_REACH),
          y: fx(7.0),
          radius: fx(2.8),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(80),
          effect: "slash",
        },
      ],
    },

    bair: {
      slot: "bair",
      name: "Back Air",
      totalFrames: 39,
      landingLag: 10,
      autoCancelBefore: 2,
      autoCancelAfter: 32,
      hitboxes: [
        {
          // Growth 94 against 85 — the bonus is in scaling, so this tipper
          // overtakes forward air's above roughly 20%.
          id: 0,
          startFrame: 7,
          endFrame: 11,
          x: fx(-TIP_REACH),
          y: fx(7.0),
          radius: fx(2.4),
          damage: fx(12.5),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(94),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 7,
          endFrame: 11,
          x: fx(-BODY_REACH),
          y: fx(7.0),
          radius: fx(2.8),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(40),
          knockbackGrowth: fx(85),
          effect: "slash",
        },
      ],
    },

    uair: {
      slot: "uair",
      name: "Up Air",
      totalFrames: 45,
      landingLag: 8,
      autoCancelBefore: 2,
      autoCancelAfter: 38,
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 9,
          x: fx(1.5),
          y: fx(17.0),
          radius: fx(2.4),
          damage: fx(13.0),
          angle: fx(90),
          baseKnockback: fx(40),
          knockbackGrowth: fx(84),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 5,
          endFrame: 9,
          x: fx(1.0),
          y: fx(12.0),
          radius: fx(2.8),
          damage: fx(9.5),
          angle: fx(80),
          baseKnockback: fx(40),
          knockbackGrowth: fx(80),
          effect: "slash",
        },
      ],
    },

    dair: {
      slot: "dair",
      name: "Down Air",
      totalFrames: 59,
      landingLag: 14,
      autoCancelBefore: 2,
      autoCancelAfter: 55,
      hitboxes: [
        {
          // **The meteor, and it is not the tipper.** A one-frame window on
          // frame 11, mounted below and slightly behind him — nowhere near the
          // blade's point — doing 15%, more than the tip's 14%. Lowest id, so
          // it wins any overlap, which is correct: it is the reward.
          id: 0,
          startFrame: 11,
          endFrame: 11,
          x: fx(-3.0),
          y: fx(-3.3),
          radius: fx(2.6),
          damage: fx(15.0),
          angle: fx(270),
          baseKnockback: fx(20),
          knockbackGrowth: fx(80),
          meteor: true,
          effect: "slash",
        },
        {
          // The tip. Sakurai angle — no spike.
          id: 1,
          startFrame: 9,
          endFrame: 13,
          x: fx(6.7),
          y: fx(-1.0),
          radius: fx(2.4),
          damage: fx(14.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(80),
          effect: "slash",
        },
        {
          id: 2,
          startFrame: 9,
          endFrame: 13,
          x: fx(3.5),
          y: fx(0.5),
          radius: fx(2.8),
          damage: fx(12.0),
          angle: fx(80),
          baseKnockback: fx(40),
          knockbackGrowth: fx(70),
          effect: "slash",
        },
      ],
    },

    neutralB: {
      slot: "neutralB",
      name: "Shield Breaker",
      totalFrames: 50,
      chargeable: true,
      // Charge scales **damage and shield damage only** — angle, base knockback
      // and growth are frozen across the whole range (361 / 30 / 90 on the
      // body, 361 / 60 / 100 on the tip). Damage runs 8% → 22% on the body and
      // 9% → 24% on the tip; shield damage runs 25 → 50, which is the actual
      // point of the move. Startup stretches from frame 19 to frame 79 at full
      // charge, and it deals 1.15x on a head hit.
      hitboxes: [
        {
          id: 0,
          startFrame: 19,
          endFrame: 20,
          x: fx(TIP_REACH),
          y: fx(7.5),
          radius: fx(2.4),
          damage: fx(9.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(100),
          shieldstunMultiplier: fx(2),
          effect: "stab",
        },
        {
          id: 1,
          startFrame: 19,
          endFrame: 20,
          x: fx(BODY_REACH),
          y: fx(7.5),
          radius: fx(2.8),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(30),
          knockbackGrowth: fx(90),
          shieldstunMultiplier: fx(2),
          effect: "stab",
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Dancing Blade",
      totalFrames: 39,
      // Four stages, each branching on the direction held — up, neutral or
      // down — for eleven distinct follow-ups in total. `MoveSlot` has one
      // side-B, so what is encoded is **stage one**, whose tipper fires at
      // angle 90 rather than 361: that pop-up is the mechanism that makes stage
      // two link. Stage four neutral is the KO ender (4% body / 6% tip, growth
      // 103 / 125); stage four down is a four-hit rapid finisher.
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 11,
          x: fx(TIP_REACH),
          y: fx(7.5),
          radius: fx(2.4),
          damage: fx(3.0),
          angle: fx(90),
          baseKnockback: fx(25),
          knockbackGrowth: fx(30),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 9,
          endFrame: 11,
          x: fx(BODY_REACH),
          y: fx(7.5),
          radius: fx(2.8),
          damage: fx(2.5),
          angle: fx(361),
          baseKnockback: fx(25),
          knockbackGrowth: fx(30),
          effect: "slash",
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Dolphin Slash",
      totalFrames: 55,
      landingLag: 24,
      // Frame 5, and intangible on frames 4-5 grounded, 1-5 airborne — one of
      // the best out-of-shield options in the game. No tipper on this one.
      hitboxes: [
        {
          id: 0,
          startFrame: 5,
          endFrame: 5,
          x: fx(2.0),
          y: fx(11.0),
          radius: fx(3.4),
          damage: fx(11.0),
          angle: fx(361),
          baseKnockback: fx(70),
          knockbackGrowth: fx(74),
          effect: "slash",
        },
        {
          id: 1,
          startFrame: 6,
          endFrame: 11,
          x: fx(2.0),
          y: fx(13.0),
          radius: fx(3.0),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(20),
          knockbackGrowth: fx(90),
          effect: "slash",
        },
      ],
    },

    downB: {
      slot: "downB",
      name: "Counter",
      totalFrames: 64,
      // The counter *window* is frames 6-27 — twenty-two frames, which is
      // generous — and a caught attack is returned at **1.2x** with a floor of
      // 8%. The counterattack itself has **no tipper**: all four of its
      // hitboxes are identical. The hitbox below is the returned strike; the
      // window and the multiplier are engine behaviour keyed off this slot.
      hitboxes: [
        {
          id: 0,
          startFrame: 4,
          endFrame: 6,
          x: fx(7.0),
          y: fx(7.5),
          radius: fx(3.4),
          damage: fx(8.0),
          angle: fx(361),
          baseKnockback: fx(90),
          knockbackGrowth: fx(60),
          effect: "slash",
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
          x: fx(6.0),
          y: fx(7.5),
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
      totalFrames: 42,
      hitboxes: [
        {
          id: 0,
          startFrame: 9,
          endFrame: 10,
          x: fx(7.0),
          y: fx(7.5),
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
      totalFrames: 19,
      hitboxes: [
        {
          id: 0,
          startFrame: 1,
          endFrame: 1,
          x: fx(0),
          y: fx(9.0),
          radius: fx(4.0),
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
      totalFrames: 34,
      hitboxes: [
        {
          id: 0,
          startFrame: 18,
          endFrame: 18,
          x: fx(4.0),
          y: fx(7.0),
          radius: fx(3.0),
          damage: fx(4.0),
          angle: fx(50),
          baseKnockback: fx(100),
          knockbackGrowth: fx(50),
        },
      ],
    },

    bthrow: {
      slot: "bthrow",
      name: "Back Throw",
      totalFrames: 44,
      hitboxes: [
        {
          id: 0,
          startFrame: 19,
          endFrame: 19,
          x: fx(-4.0),
          y: fx(7.0),
          radius: fx(3.0),
          damage: fx(4.0),
          angle: fx(140),
          baseKnockback: fx(80),
          knockbackGrowth: fx(60),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      totalFrames: 44,
      hitboxes: [
        {
          // Growth 102 — his only throw that scales into a kill.
          id: 0,
          startFrame: 13,
          endFrame: 13,
          x: fx(0),
          y: fx(10.0),
          radius: fx(3.0),
          damage: fx(5.0),
          angle: fx(93),
          baseKnockback: fx(70),
          knockbackGrowth: fx(102),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      totalFrames: 46,
      hitboxes: [
        {
          id: 0,
          startFrame: 20,
          endFrame: 20,
          x: fx(2.0),
          y: fx(1.5),
          radius: fx(3.0),
          damage: fx(4.0),
          angle: fx(100),
          baseKnockback: fx(95),
          knockbackGrowth: fx(57),
        },
      ],
    },
  },

  palette: {
    primary: "#2B4FC9", // the tunic blue
    secondary: "#1A2A5E", // armour and boots
    accent: "#E8C34A", // the gold trim and Falchion's hilt
    skin: "#F5D5B0",
    outline: "#0E1430",
    alts: [
      { primary: "#C41E3A", secondary: "#5E1020", accent: "#E8C34A" }, // red
      { primary: "#1E7B3C", secondary: "#0E3A1C", accent: "#D8D8B0" }, // green
      { primary: "#E8E8E8", secondary: "#8A8A9A", accent: "#C9A02B" }, // white
      { primary: "#1A1A1A", secondary: "#3A3A4A", accent: "#8A7020" }, // black
      { primary: "#6A3F9E", secondary: "#3A1F5E", accent: "#E8C34A" }, // purple
    ],
  },

  blurb: "The blade's point does markedly more than the rest of it. Every decision he makes is about distance.",
};
