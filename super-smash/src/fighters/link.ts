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
import type { FighterDef, ProjectileDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { LINK } from "./acmd/generated/link";
import { FIGHTER_PARAMS } from "./params";

/** UNVERIFIED: hurtbox dimensions are unpublished. Slightly taller than Mario
 * and about as wide, with the sword adding reach but no hurtbox. */
const HEIGHT = 12.4;
const HALF_WIDTH = 2.1;

/**
 * Link's Boomerang (the side special's projectile), thrown with a tilt input; the
 * smash throw (`sideBSmash`, Plan 5, Task 13d) is the same article thrown harder.
 */
const BOOMERANG: ProjectileDef = {
  // Out, decelerating, then back — `returns` is the whole move. It
  // lives 125 frames on a tilt throw, frames 27-151 (SmashWiki "Link
  // (SSBU)/Side special", https://www.ssbwiki.com/Link_(SSBU)/Side_special:
  // "Lifetime 125 frames (tilt)", "Tilt input hitboxes (clean, late,
  // returning) 27-36, 37-71, 72-151"); a *smash* input throws it further
  // and harder (8% → 9.6% clean) and stretches that to 167 (27-192): the
  // `sideBSmash` move's (Plan 5, Task 13d). Link catches it in a 9-frame
  // animation, which is skipped if he is mid-attack.
  //
  // The return leg does only 3% but drags victims back toward him,
  // which is what makes it a combo starter into his sword rather than
  // a poke. It does not die on contact — it keeps going.
  //
  // Its flight is the page's Boomerang parameters (Plan 5, Task 13c): out at
  // "Initial speed 2.4 (tilt)", slowing by "Deceleration 0.047" until it
  // would be under "Minimum speed 0.3", which is frame 45 of its life, where
  // the returning hitbox starts (72 − 27); back up to "Maximum returning
  // speed 3", steering at Link by "Angle deviation per frame when returning
  // 0.75°" (its sine and cosine below). Not modelled: "Distance spent
  // turning back 16", the clean hit's 8% giving way to the late 6% on frame
  // 10 (the box below is the clean one, at the replica's radius), and the
  // floor's "Downward ground collision range −0.5u".
  //
  // One out at a time (Plan 5, Task 13d fix round 1, ruling R-T13d-d): thrown with
  // one out, the throw fails (the page's "Throw (failed)"; `sideBFailed`). Both
  // throws are this article, so they share the one.
  article: "boomerang",
  maxOut: 1,
  id: "boomerang",
  spawnFrame: 27,
  offsetX: fx(9.0),
  offsetY: fx(7.0),
  vx: fx(2.4),
  vy: fx(0),
  gravity: fx(0),
  lifetime: 125,
  destroyOnHit: false,
  returns: {
    deceleration: fx(0.047),
    minSpeed: fx(0.3),
    maxSpeed: fx(3.0),
    homing: { sin: fx(0.0130896), cos: fx(0.9999143) },
    // The "Returning" row: 3.0%, 70°, BK 50, KS 40, radius 3.6
    // (link_boomerang `Turn`).
    hit: { damage: fx(3.0), angle: fx(70), baseKnockback: fx(50), knockbackGrowth: fx(40), radius: fx(3.6) },
  },
  // A clank it loses knocks it away (Plan 5, Task 13c): "After clashing with
  // an attack": "Lifetime 60 frames", "Horizontal speed -0.15", "Vertical
  // speed 1.25", "Gravity 0.09", "Falling speed 1.4".
  clash: { lifetime: 60, vx: fx(-0.15), vy: fx(1.25), gravity: fx(0.09), maxFall: fx(1.4) },
  // A floor its way home steers it into it comes off (fix round 1, ruling
  // R-T13c-c): "Minimum bounce angle off ground 16°", "Angle difference to go
  // through floor instead of bouncing off 30°" (`skimFloor`).
  skim: { minAngle: fx(16), throughAngle: fx(30) },
  visual: "boomerang",
  // link_boomerang `Fly`: `Reflectable=true`.
  reflectable: true,
  hitbox: {
    id: 0,
    startFrame: 0,
    endFrame: 124,
    x: fx(0),
    y: fx(0),
    radius: fx(3.0),
    damage: fx(8.0),
    angle: fx(70),
    baseKnockback: fx(80),
    knockbackGrowth: fx(40),
    // link_boomerang `Fly` and `Turn`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON` (Plan 5,
    // Task 13c).
  },
};

/** The hand-authored moveset; `link` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "link",
  name: "Link",
  series: "The Legend of Zelda",
  number: 3,

  attributes: {
    weight: 104,
    walkSpeed: fx(1.247),
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
    // Air dodges (Plan 3, Task 20c): fudgepop01/amiibo_research
    // `fighter_param_motion.xml` @523374aa, the `fighter_kind_link` entry (L241):
    // L262 `escape_air_stiff_frame`, L258-259 `escape_air_hit_xlu_frame` /
    // `_hit_normal_frame`, L350-352 `escape_air_slide_stiff_frame` / `_u_` /
    // `_d_`, L265-266 `escape_air_slide_hit_xlu_frame` / `_hit_normal_frame`.
    airDodge: {
      neutralFrames: 49,
      neutralIntangible: [3, 28],
      sideFrames: 82,
      upFrames: 108,
      downFrames: 68,
      directionalIntangible: [3, 19],
    },
    // Spot dodge and rolls (Plan 3 final wave): UltimateFrameData,
    // https://ultimateframedata.com/link, "Dodges / Rolls": each "Total frames"
    // and "Intangible on frame a-b", fresh. The spot dodge is the second of
    // UFD's "21/26"; the first is its cancel, not modelled (`GroundDodgeAttributes`).
    groundDodge: {
      spotDodge: { frames: 26, intangible: [3, 17] },
      forwardRoll: { frames: 30, intangible: [4, 15] },
      backRoll: { frames: 35, intangible: [5, 16] },
    },
  },

  params: FIGHTER_PARAMS.link,

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
      // Held on the published first frame of its "Charges between 9-10" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Link (SSBU)/Forward smash/Hit 1",
      // https://www.ssbwiki.com/Link_(SSBU)/Forward_smash/Hit_1, revision 1706143).
      smashHold: 9,
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
      // Held on the published first frame of its "Charges between 5-6" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Link (SSBU)/Up smash",
      // https://www.ssbwiki.com/Link_(SSBU)/Up_smash, revision 1657166).
      smashHold: 5,
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(55),
          // Set weight: `game_attackhi4` (generated/link.ts; Plan 3, Task 16b).
          setWeight: true,
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(55),
          // Set weight: `game_attackhi4` (generated/link.ts; Plan 3, Task 16b).
          setWeight: true,
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
          // `game_attackhi4`'s final hit (frame 41, ids 0-3): `ATTACK_SETOFF_KIND_OFF` (Plan 5,
          // Task 13c).
          transcendent: true,
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(50),
          // Set weight: `game_attackairb` (generated/link.ts; Plan 3, Task 16b).
          setWeight: true,
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
      // Hold mode (Plan 5), SmashWiki "Link (SSBU)/Neutral special"
      // (https://www.ssbwiki.com/Link_(SSBU)/Neutral_special): "Total charge
      // time 60 frames", "Charges between 15-16", arrow "16-61 (1-46)" from
      // release, damage "4 + 8 * (charge frames / 60)", speed 2.6 uncharged →
      // 10 full, "Maximum hold time 180 frames". SmashWiki "Charge"
      // (https://www.ssbwiki.com/Charge): it "Can be held indefinitely", so a
      // full charge waits for B to come up, at most those 180 charge frames
      // (UNVERIFIED that it fires by itself then; the page gives the maximum,
      // not what follows). Published, not modelled: "with at least 36 charge
      // frames, the move immediately skips to full charge", the animation's
      // skip (the 60-frame charge "is only used for the arrows to scale in
      // damage and speed", which they do here).
      specialCharge: { mode: "hold", frames: 60, loopFrame: 15, atFull: "hold", maxHold: 180 },
      hitboxes: [],
      projectiles: [
        {
          // Loosed on frame 16, 2.5° up and dropping under its gravity, for 46
          // frames, or until it sticks in the stage (`lodge`). Charge runs frames 16 to 52 and
          // scales damage as `4 + 8 * (chargeFrames / 60)` — 4% uncharged to
          // 12% full (`charged` below). Firing with a stuck arrow
          // already in hand looses *two* at once, each scaled 0.8x for 6% → 18%
          // total; the double arrow is the harder launcher (BKB 25 / KBG 110
          // against 10 / 71). Reflectable and absorbable.
          id: "arrow",
          spawnFrame: 16,
          offsetX: fx(9.0),
          offsetY: fx(7.0),
          // Fix round 1, ruling R-T13c-d: "Firing angle 2.5°" at "Uncharged speed 2.6"
          // (2.6 cos 2.5°, 2.6 sin 2.5°), under "Gravity 0.054".
          vx: fx(2.5975),
          vy: fx(0.1134),
          gravity: fx(0.054),
          lifetime: 46,
          destroyOnHit: true,
          // It sticks in the floor, wall or underside it meets, harmless, for
          // "Lifetime stuck on a surface (single) 180 frames" (Plan 5, Task 13c;
          // the same page). Published, not modelled: its "Minimum stick angle 9°",
          // and the stuck arrow being an item anyone can pick up and throw.
          lodge: 180,
          // Damage "4 + 8 * (charge frames / 60), rounded down". UNVERIFIED:
          // that the speed is linear between 2.6 and 10 (the page gives the ends).
          // "Fully charged speed 10" at the same 2.5°: 10 cos 2.5°, 10 sin 2.5°.
          charged: { vx: fx(9.9905), vy: fx(0.4362), hitbox: { damage: fx(12.0) }, partial: { kind: "add", total: fx(8), floor: true } },
          visual: "arrow",
          // link_bowarrow `Fly`: `Reflectable=true`.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 45,
            x: fx(0),
            y: fx(0),
            radius: fx(2.0),
            damage: fx(4.0),
            angle: fx(361),
            baseKnockback: fx(10),
            knockbackGrowth: fx(71),
            effect: "stab",
            // link_bowarrow `Fly`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON` (Plan 5, Task 13c).
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Boomerang",
      totalFrames: 45,
      // The smash input (Plan 5, Task 13d): B within 8 frames of a smash flick throws
      // it as `sideBSmash`. SmashWiki "Control stick" (https://www.ssbwiki.com/Control_stick,
      // revision 2062569), "Stick sensitivity": "'Smashed' side special moves - 7/8/9
      // frames" (low, normal, high), which "applies to ... only the following side
      // special moves: Link ... - Boomerang": 8, the default setting's. Smash
      // attacks' window is the replica's own 5 (`SMASH_INPUT_WINDOW`, DECISIONS D7).
      smashInput: { within: 8, slot: "sideBSmash" },
      // With his Boomerang out, the throw fails (fix round 1, ruling R-T13d-d).
      whenOut: "sideBFailed",
      hitboxes: [],
      projectiles: [BOOMERANG],
    },

    sideBSmash: {
      slot: "sideBSmash",
      name: "Boomerang (smash)",
      // Plan 5, Task 13d (ruling P5-R29): the Boomerang thrown with a smash input.
      // SmashWiki "Link (SSBU)/Side special" (https://www.ssbwiki.com/Link_(SSBU)/Side_special,
      // revision 1840696): one "Throw (successful)" timing for both throws,
      // "Interruptible 46", and one motion in the game (rubendal 13.0.1: `special_s1`,
      // `game_specials1`, CancelFrame 46), so it plays the throw's (`motionOf`).
      totalFrames: 45,
      motionOf: "sideB",
      // With his Boomerang out, the throw fails (fix round 1, ruling R-T13d-d).
      whenOut: "sideBFailed",
      hitboxes: [],
      projectiles: [
        {
          // The page's smash-throw numbers: "Initial speed ... 3.1 (smash)", "Lifetime
          // ... 167 frames (smash)" (its hitboxes "27-36, 37-86, 87-192"), and "If thrown
          // with a smash attack input, the Boomerang's clean and late hits have their
          // damage multiplied by 1.2×" ("Smash input damage multiplier 1.2"): the clean
          // 8.0 here is 9.6; the returning 3% is not multiplied. With the tilt throw's
          // "Deceleration 0.047" and "Minimum speed 0.3" it turns on frame 60 of its
          // flight, where the returning hit starts (87 − 27). UNVERIFIED: that the 1.2
          // reaches the knockback too (it multiplies the box's damage here). Published,
          // not modelled, as for the tilt throw: "Distance spent turning back ... 24
          // (smash)", the late 7.2% (6.0 × 1.2) from frame 10, "Rotation speed ... 26°
          // (smash)".
          ...BOOMERANG,
          id: "boomerangSmash",
          vx: fx(3.1),
          lifetime: 167,
          hitbox: { ...BOOMERANG.hitbox, endFrame: 166, damage: fx(9.6) },
        },
      ],
    },

    sideBFailed: {
      slot: "sideBFailed",
      name: "Boomerang (failed throw)",
      // Plan 5, Task 13d fix round 1 (ruling R-T13d-d): a throw, tilted or smashed,
      // with his Boomerang already out. SmashWiki "Link (SSBU)/Side special"
      // (https://www.ssbwiki.com/Link_(SSBU)/Side_special, revision 1840696), "Throw
      // (failed)": "Interruptible (grounded) 60", "Interruptible (aerial) 46",
      // "Animation length 63"; rubendal 13.0.1 Motions: `special_s1_blank` CancelFrame
      // 60 and `special_air_s1_blank` CancelFrame 46, both on the throw's animation
      // `d01specials1`. Nothing is launched. UNVERIFIED: its landing, which no source
      // gives; it lands plainly, as the throw does (UltimateFrameData gives the throw
      // no landing lag, https://ultimateframedata.com/link).
      //
      // A motion of its own (Plan 5, Task 17): the throw's clip (`SLOT_POSE`) across
      // the failed throw's 59 frames, where playing the throw's 45-frame motion held
      // its last pose for 46-59. The game plays the one animation for both and the
      // failed throw runs further into it; the replica's throw clip finishes the
      // throw on the throw's own 45 frames, so the failed throw plays it slower.
      totalFrames: 59,
      aerialTotalFrames: 45,
      hitboxes: [],
    },

    upB: {
      slot: "upB",
      name: "Spin Attack",
      totalFrames: 76,
      // The imported `game_specialhi` is the from-release timeline (Plan 5, Task 13
      // fix round 1, ruling R-T13f): SmashWiki "Link (SSBU)/Up special"
      // (https://www.ssbwiki.com/Link_(SSBU)/Up_special, revision 1987976), grounded,
      // "Charges between 3-4", hits "7-8, 9-13 (4-5, 6-10)", "14-23, 24-39 (11-20,
      // 21-36)", "Interruptible (from release) 77 (74)". So the script starts 3
      // frames in, and its boxes come out on 7-39, its end on 76. The 3 frames are
      // its start motion, `special_hi_start`, whose `game_specialhistart` is
      // published with no body (rubendal 13.0.1,
      // https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Link/data.json):
      // they set nothing (Plan 5, Task 13b; was UNVERIFIED).
      scriptLead: 3,
      // The grounded charge (Plan 5, Task 13b): held B holds it on frame 3 ("Charges
      // between 3-4") for up to "Maximum charge time 60 frames", where it goes on its
      // own (SmashWiki "Charge", https://www.ssbwiki.com/Charge: Spin Attack
      // "Automatically activates at full charge"); its boxes deal "1 + 0.6 * (charge
      // frames / 60)" times their damage, "up to 1.6×" ("Maximum charge damage
      // multiplier 1.6"). It stays on the ground: the page's grounded move has no
      // movement (the legacy lift is gone; the aerial one is `upBAir`).
      specialCharge: { mode: "hold", frames: 60, loopFrame: 3, atFull: "release", partial: { kind: "multiply", by: fx(0.6) } },
      // Ends helpless when used in the air (Plan 5, Task 4b): SmashWiki "Link
      // (SSBU)/Up special" (https://www.ssbwiki.com/Link_(SSBU)/Up_special): "Air
      // speed multiplier ... 0.909 (helpless)", "Landing lag 30 frames" (the
      // landing's "Interruptible 31"; UltimateFrameData's aerial Spin Attack,
      // landing lag 30, https://ultimateframedata.com/link). Only the aerial one
      // (fix round 1): SmashWiki "Helpless" (https://www.ssbwiki.com/Helpless),
      // "Spin Attack makes Link ... helpless after the move was used if in the
      // air"; the grounded one only if its platform goes. Begun in the air it is
      // `upBAir` now (Task 13b), which carries its own, the fall's acceleration with
      // it (fix round 1: the Task 13b review's M-9, never read here).
      helpless: { landingLag: 30, airSpeed: fx(0.909), aerialOnly: true },
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
    // Plan 5, Task 13b: the aerial Spin Attack, its own move (SSBU's
    // `special_air_hi`; the brief's "SpecialAirHi"), SmashWiki "Link (SSBU)/Up
    // special" (https://www.ssbwiki.com/Link_(SSBU)/Up_special), aerial: front hits
    // 8-9, 16-17, 22-23, 31-32, back hits 12-13, 19-20, 26-27, 38-39, final hit 47,
    // 48, 49, "Animation length 91". The game runs its imported
    // `game_specialairhi` (`limb.json`: its back hits 3 and 4 ride `sword2`); this
    // table is that script's boxes as spheres for the plain roster, each at its
    // capsule's middle (UNVERIFIED: the two `sword2` ones at x −9, y 9, behind him).
    // Not modelled: the back hits' position vector ("All back hits use a position
    // vector with offsets [10, 20] for 10 frames"; `set_vec_target_pos`), and the
    // "Jostling is also disabled during frames 26-49".
    upBAir: {
      slot: "upBAir",
      name: "Spin Attack (aerial)",
      totalFrames: 91,
      // "Initial vertical speed 2.4" under "Gravity multiplier 0.55" (his gravity
      // ×0.55: the rise tops out on frame 46, as "The ending attributes apply on
      // frame 48" has it, about 56 up). Rising, "Additional air acceleration 0.22"
      // and "Air speed multiplier 0.5"; from frame 48, "0.01" and "Air speed on
      // ending 0.8" (UNVERIFIED reading: ×0.8 his air speed, the brief's "0.8
      // ending multiplier"). The legacy one-move Spin Attack rose 62 on a window.
      launch: { vy: fx(2.4) },
      phases: [
        { from: 1, to: 47, air: { add: fx(0.22), speedMul: fx(0.5) }, gravityMul: fx(0.55) },
        { from: 48, air: { add: fx(0.01), speedMul: fx(0.8) }, gravityMul: fx(0.55) },
      ],
      // "Landing lag 30 frames"; "Air speed multiplier ... 0.909 (helpless)",
      // "Additional air acceleration ... 0.025 (helpless)".
      helpless: { landingLag: 30, airSpeed: fx(0.909), airAccel: fx(0.025) },
      // Distinct ids for the compiled table (the script's front hits are all its id 0, its back hits id 1).
      hitboxes: [
        // Front hit 1: 4.0%, 367°, FKB 107, KBG 100, set weight, r 6, top (0, 10, 14.5→8.0).
        { id: 0, startFrame: 8, endFrame: 9, x: fx(11.25), y: fx(10), radius: fx(6), damage: fx(4), angle: fx(367), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(107), setWeight: true, transcendent: true, effect: "slash" },
        // Back hit 1: 2.0%, 145°, FKB 95, r 5, top (0, 11.5→11.0, −12.0→−9.0), behind.
        { id: 1, startFrame: 12, endFrame: 13, x: fx(-10.5), y: fx(11.25), radius: fx(5), damage: fx(2), angle: fx(145), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(95), lr: "back", transcendent: true, effect: "slash" },
        // Front hit 2: 2.0%, 367°, FKB 107, set weight, r 6, top (0, 6.0→7.5, 15.0→8.0).
        { id: 2, startFrame: 16, endFrame: 17, x: fx(11.5), y: fx(6.75), radius: fx(6), damage: fx(2), angle: fx(367), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(107), setWeight: true, transcendent: true, effect: "slash" },
        // Back hit 2: 2.0%, 145°, FKB 95, r 5, top (0, 11.5→11.0, −12.5→−9.0).
        { id: 3, startFrame: 19, endFrame: 20, x: fx(-10.75), y: fx(11.25), radius: fx(5), damage: fx(2), angle: fx(145), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(95), lr: "back", transcendent: true, effect: "slash" },
        // Front hit 3: 2.0%, 83°, FKB 71, set weight, r 6, top (0, 10.0→10.5, 15.0→8.0).
        { id: 4, startFrame: 22, endFrame: 23, x: fx(11.5), y: fx(10.25), radius: fx(6), damage: fx(2), angle: fx(83), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(71), setWeight: true, transcendent: true, effect: "slash" },
        // Back hit 3: 2.0%, 150°, FKB 95, r 5, sword2 (2.0→5.5, 0, 0).
        { id: 5, startFrame: 26, endFrame: 27, x: fx(-9), y: fx(9), radius: fx(5), damage: fx(2), angle: fx(150), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(95), lr: "back", transcendent: true, effect: "slash" },
        // Front hit 4: 2.0%, 69°, FKB 62, set weight, r 7, top (0, 14.0→12.5, 12.5→8.0).
        { id: 6, startFrame: 31, endFrame: 32, x: fx(10.25), y: fx(13.25), radius: fx(7), damage: fx(2), angle: fx(69), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(62), setWeight: true, transcendent: true, effect: "slash" },
        // Back hit 4: 2.0%, 160°, FKB 95, r 5, sword2 (2.0→5.5, 0, 0).
        { id: 7, startFrame: 38, endFrame: 39, x: fx(-9), y: fx(9), radius: fx(5), damage: fx(2), angle: fx(160), baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(95), lr: "back", transcendent: true, effect: "slash" },
        // Front hit 5, early, mid and late: 4.0%, 361°, BKB 30, KBG 200, hitlag ×2,
        // r 7.5, top (0, 7.5→9.5, 14.0→7.5), (0, 13.0→12.5, 15.5→7.5), (0, 19.0→14.0, 12.5→7.5).
        { id: 8, startFrame: 47, endFrame: 47, x: fx(10.75), y: fx(8.5), radius: fx(7.5), damage: fx(4), angle: fx(361), baseKnockback: fx(30), knockbackGrowth: fx(200), hitlagMultiplier: fx(2), transcendent: true, effect: "slash" },
        { id: 9, startFrame: 48, endFrame: 48, x: fx(11.5), y: fx(12.75), radius: fx(7.5), damage: fx(4), angle: fx(361), baseKnockback: fx(30), knockbackGrowth: fx(200), hitlagMultiplier: fx(2), transcendent: true, effect: "slash" },
        { id: 10, startFrame: 49, endFrame: 49, x: fx(10), y: fx(16.5), radius: fx(7.5), damage: fx(4), angle: fx(361), baseKnockback: fx(30), knockbackGrowth: fx(200), hitlagMultiplier: fx(2), transcendent: true, effect: "slash" },
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
          // SmashWiki "Reflection" (https://www.ssbwiki.com/Reflection): Link's
          // "Remote Bomb (SSBU only)"; "Link (SSBU)/Down special"
          // (https://www.ssbwiki.com/Link_(SSBU)/Down_special): `reflectable=t`
          // on both its Thrown and Explosion boxes. The one box here is the 7%
          // detonation, live for the bomb's whole life (a simplification of
          // this replica's), so a reflected bomb comes back as that box ×1.4:
          // UNVERIFIED against Ultimate's 1% thrown box.
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 1799,
            x: fx(0),
            y: fx(0),
            radius: fx(7.0),
            damage: fx(7.0),
            angle: fx(52),
            baseKnockback: fx(60),
            knockbackGrowth: fx(115),
            effect: "fire",
            // UNVERIFIED (Plan 5, Task 13c): no article script publishes its clang; it
            // is an item (HP 50, "Hit by attack"), which this replica does not model,
            // so attacks pass it rather than end it.
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(30),
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

    // Plan 5, Task 16 — Ancient Bow and Arrow. Sources: rubendal Data Viewer 13.0.1
    // (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Link/data.json):
    // `game_final` (WHOLE_HIT(HIT_STATUS_XLU) from its start, the arrow shot on 60,
    // FT_MOTION_RATE(FSM=0.85) from 70), final's CancelFrame 111 (game frame 105 at that
    // rate, `gameFrameOfMotion`), final_air's 100 (`game_finalair` sets no rate), and
    // the arrow's `link_ancientbowarrow` `Fly` and `Stick`; SmashWiki "Link (SSBU)/Final
    // Smash" (https://www.ssbwiki.com/Link_(SSBU)/Final_Smash): the flying box, radius
    // 5.0, 4 ahead, and the explosion on a fighter, 35%, angle 60, BKB 102, KBG 46,
    // hitlag ×0.3; SmashWiki "Ancient Bow and Arrow"
    // (https://www.ssbwiki.com/Ancient_Bow_and_Arrow): "fires an Ancient Arrow straight
    // ahead, hitting the first person in his line of sight"; SmashWiki "Final Smash"
    // (https://www.ssbwiki.com/Final_Smash): Final Smashes "make the user fully
    // intangible". Not a cinematic: it traps nobody.
    // - The arrow flies flat; its flying box carries the explosion's numbers and its
    //   `set_force_reaction`, ATTACK_SETOFF_KIND_OFF and `Reflectable=false`, and it is
    //   gone on its first hit.
    // UNVERIFIED: the arrow's speed (6 a frame), lifetime (60 frames) and launch offset
    // (10 ahead, 7 up).
    // UNVERIFIED-simplified: the explosion lands on the fighter the arrow reaches, not
    // on everybody within its 25 units ("A small explosion occurs as the opponent is
    // hit, damaging anybody else near the victim at the time"), and the flying box's
    // own 0% hit is that explosion's trigger alone; its 20% blast on a wall or a floor
    // ("If it strikes a wall or floor, it will also explode, but the explosion deals
    // less damage (35% → 20%)") is not modelled: a wall ends it, as it ends any
    // projectile (SmashWiki "Wall").
    finalSmash: {
      slot: "finalSmash",
      name: "Ancient Bow and Arrow",
      totalFrames: 104,
      aerialTotalFrames: 99,
      intangible: [1, 104],
      final: { phase: "start" },
      hitboxes: [],
      projectiles: [
        {
          id: "ancientArrow",
          spawnFrame: 60,
          offsetX: fx(10.0),
          offsetY: fx(7.0),
          vx: fx(6.0),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 60,
          destroyOnHit: true,
          visual: "arrow",
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 59,
            x: fx(4.0),
            y: fx(0),
            radius: fx(5.0),
            damage: fx(35.0),
            angle: fx(60),
            baseKnockback: fx(102),
            knockbackGrowth: fx(46),
            hitlagMultiplier: fx(0.3),
            forceReaction: true,
            transcendent: true,
          },
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

/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const link: FighterDef = withReferenceScripts(legacy, LINK, ACTIVE_SCRIPT_SLOTS.link);
