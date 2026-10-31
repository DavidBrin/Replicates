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
import { barrage, finalBox } from "./finalKit";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { DONKEY_KONG } from "./acmd/generated/donkeyKong";
import { FIGHTER_PARAMS } from "./params";

/** UNVERIFIED: hurtbox dimensions are unpublished. DK stands roughly half again
 * as tall as Mario and considerably wider, which is the shape his frame data
 * implies — his grab reaches z 13.7 and his forward smash has a 22-unit swing. */
const HEIGHT = 15.0;
const HALF_WIDTH = 3.2;

/** The hand-authored moveset; `donkeyKong` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
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
    // Air dodges (Plan 3, Task 20c): fudgepop01/amiibo_research
    // `fighter_param_motion.xml` @523374aa, the `fighter_kind_donkey` entry (L123):
    // L144 `escape_air_stiff_frame`, L140-141 `escape_air_hit_xlu_frame` /
    // `_hit_normal_frame`, L232-234 `escape_air_slide_stiff_frame` / `_u_` /
    // `_d_`, L147-148 `escape_air_slide_hit_xlu_frame` / `_hit_normal_frame`.
    airDodge: {
      neutralFrames: 49,
      neutralIntangible: [4, 29],
      sideFrames: 82,
      upFrames: 109,
      downFrames: 66,
      directionalIntangible: [4, 19],
    },
    // Spot dodge and rolls (Plan 3 final wave): UltimateFrameData,
    // https://ultimateframedata.com/donkey_kong, "Dodges / Rolls": each "Total frames"
    // and "Intangible on frame a-b", fresh. The spot dodge is the second of
    // UFD's "21/26"; the first is its cancel, not modelled (`GroundDodgeAttributes`).
    groundDodge: {
      spotDodge: { frames: 26, intangible: [3, 17] },
      forwardRoll: { frames: 30, intangible: [4, 15] },
      backRoll: { frames: 35, intangible: [5, 16] },
    },
  },

  params: FIGHTER_PARAMS.donkeyKong,

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
      // Held on the published first frame of its "Charges between 14-15" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Donkey Kong (SSBU)/Forward smash",
      // https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_smash, revision 1789698).
      smashHold: 14,
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
          // `game_attacks4` ids 0-1: `ATTACK_SETOFF_KIND_THRU`, it tramples (ruling
          // R-T13g; Plan 5, Task 13c).
          noRebound: true,
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
          // `game_attacks4`: `ATTACK_SETOFF_KIND_THRU` (Plan 5, Task 13c).
          noRebound: true,
        },
      ],
    },

    usmash: {
      slot: "usmash",
      name: "Up Smash",
      totalFrames: 49,
      chargeable: true,
      // Held on the published first frame of its "Charges between 6-7" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Donkey Kong (SSBU)/Up smash",
      // https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_smash, revision 1789530).
      smashHold: 6,
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
          // `game_attackhi4` ids 0-1: `ATTACK_SETOFF_KIND_THRU` (Plan 5, Task 13c).
          noRebound: true,
        },
      ],
    },

    dsmash: {
      slot: "dsmash",
      name: "Down Smash",
      totalFrames: 55,
      chargeable: true,
      // Held on the published first frame of its "Charges between 2-3" (Plan 5,
      // Task 13 fix round 2, ruling R-T13i; SmashWiki "Donkey Kong (SSBU)/Down smash",
      // https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Down_smash, revision 1789987).
      smashHold: 2,
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
          // `game_attacklw4` ids 0-3: `ATTACK_SETOFF_KIND_THRU` (Plan 5, Task 13c).
          noRebound: true,
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
          // `game_attacklw4`: `ATTACK_SETOFF_KIND_THRU` (Plan 5, Task 13c).
          noRebound: true,
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
      totalFrames: 69,
      // Store mode (Plan 5), SmashWiki "Donkey Kong (SSBU)/Neutral special"
      // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Neutral_special): "Total
      // charge time 110 frames (6.0.0 onward)", "Charges between 7-8", damage
      // "base damage + 18 * (charge frames / 110)" (10% → 28%), hitbox "26-27
      // (19-20)" from release, interruptible 70. A shield, roll, spot dodge,
      // jump or air dodge stores the charge (`specialChargeMain`).
      //
      // Fully charged (the same page, every frame from the press): "Hitbox
      // 19-20", "Interruptible 48", "Super armor (grounded) 9-20", "(aerial)
      // 15-20". A stored full punch starts on the loop frame, so its hit comes
      // 19 frames after B, inside the armour; UltimateFrameData
      // (https://ultimateframedata.com/donkey_kong): "Ground version has Super
      // Armor frames 9-20". The page lists no armour for a punch that is not
      // fully charged, so this move has none of its own (`superArmourFrames`).
      //
      // A charge is lost to a flinch while charging, however much was stored
      // before (SmashWiki "Flinch", https://www.ssbwiki.com/Flinch: "regardless
      // of whether any charge had been saved previously"), and with the stock.
      // Published, not modelled: the 4-frame charge-cancel lag ("Charge-canceling
      // the move incurs 4 frames of lag before the selected action"), and the
      // punch's lower-arm intangibility (11-27).
      specialCharge: {
        mode: "store",
        frames: 110,
        loopFrame: 7,
        // "base damage + 18 * (charge frames / 110), rounded down".
        partial: { kind: "add", total: fx(18), floor: true },
        full: { 0: { damage: fx(28.0) } },
        fromStore: { start: "loop", interruptible: 48, superArmour: { grounded: [9, 20], aerial: [15, 20] } },
      },
      hitboxes: [
        {
          id: 0,
          startFrame: 26,
          endFrame: 27,
          x: fx(10.0),
          y: fx(8.0),
          radius: fx(5.5),
          damage: fx(10.0),
          angle: fx(361),
          baseKnockback: fx(45),
          knockbackGrowth: fx(70),
          // `game_specialn` ids 0-2: `ATTACK_SETOFF_KIND_THRU` (Plan 5, Task 13c).
          noRebound: true,
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
          // A meteor smash: SmashWiki "Headbutt" (https://www.ssbwiki.com/Headbutt):
          // "This attack can meteor smash an opponent if used in mid-air", and
          // "Donkey Kong (SSBU)/Side special"
          // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Side_special) is filed under
          // "Meteor smashes (SSBU)" (Plan 3 final wave). The bury is a Plan 5
          // special: until then a grounded victim the hit tumbles takes the
          // release's one floor bounce instead (`releasePendingLaunch`).
          // UNVERIFIED: that bounce, as a stand-in for the bury; and the one box,
          // where that page's hitbox table gives grounded Headbutt's 270° boxes to
          // grounded opponents only and a 70° box to aerial ones.
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
          meteor: true,
        },
      ],
    },

    upB: {
      slot: "upB",
      name: "Spinning Kong",
      // Plan 5, Task 13b: SmashWiki "Donkey Kong (SSBU)/Up special"
      // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special). Grounded,
      // "Interruptible 105": 104 frames, and it stays on the ground (the legacy
      // lift is gone: the page's grounded parameters are ground ones only), steered
      // by "Ground acceleration 0.034", "Maximum ground speed 1.1", "Ground friction
      // 0.015", and after the last hit (62) "Ground friction after last hit 0.04".
      // UNVERIFIED: that the stick still steers after the last hit.
      totalFrames: 104,
      phases: [
        { from: 1, to: 62, ground: { accel: fx(0.034), speed: fx(1.1), brake: fx(0.015) } },
        { from: 63, ground: { accel: fx(0.034), speed: fx(1.1), brake: fx(0.04) } },
      ],
      // Aerial, "Animation length 70", from "Initial vertical speed in midair 0.9",
      // steered by "Air acceleration 0.05" up to "Maximum air speed 1.7". UNVERIFIED
      // reading of "Gravity multiplier 0.07" as the gravity itself (0.07 a frame):
      // as a multiplier of his 0.085 he would rise for the whole move, about 48,
      // against the page's "If Donkey Kong lands from the aerial version before
      // undergoing helplessness" and SmashWiki "Donkey Kong (SSBU)"'s "offers almost
      // no vertical recovery"; as the gravity he tops out about 5.8 up and comes
      // back down (ruling R-T13b-b: this reading kept, on those two quotes; one field
      // if a source later disagrees). That landing lands into the grounded one at its
      // frame 63.
      fromAir: {
        totalFrames: 70,
        launch: { vy: fx(0.9) },
        phases: [{ from: 1, air: { add: fx(0.05), mul: 0, speed: fx(1.7) }, gravity: fx(0.07) }],
        landsAt: 63,
      },
      // Ends helpless (Plan 5, Task 4b): SmashWiki "Donkey Kong (SSBU)/Up special"
      // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special): "Helplessness
      // landing lag 38 frames" (the landing's "Interruptible 39"). UNVERIFIED: the
      // drift; the page publishes no helplessness multiplier, so his own air speed.
      helpless: { landingLag: 38, airSpeed: fx(1) },
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
          // fkb 30 and growth 90, not the other way round: `game_specialhi` id 0 is
          // `kbg: 90, fkb: 30` (fighters/acmd/generated/donkeyKong.ts; Plan 3, Task 16b).
          baseKnockback: fx(0),
          knockbackGrowth: fx(90),
          fixedKnockback: fx(30),
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(55),
          fixedKnockback: fx(90),
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(30),
        },
      ],
    },

    /**
     * DK's forward throw is not a throw. It is Kong Karry: he hoists the victim
     * onto his shoulders and keeps them there — walking, turning and jumping —
     * until he picks one of four *cargo* throws, which is what gives him seven
     * throws, not four (SmashWiki "Forward throw", https://www.ssbwiki.com/Forward_throw).
     * Carry duration is `((90 + 1.7p) * 11/6) - g` frames in the victim's percent `p`.
     *
     * Plan 5, Task 8 models the carry (`engine/status/cargo.ts`): `fthrow` is the
     * lift, `bthrow`/`uthrow`/`dthrow` are his ordinary throws, and `cargoFthrow`
     * … `cargoDthrow` are thrown from the carry. Before it, with no carry state,
     * the four slots held the cargo set.
     *
     * Sources: SmashWiki "Donkey Kong (SSBU)/Forward throw"
     * (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_throw), and the scripts
     * and motions of rubendal's SSBU Data Viewer, patch 13.0.1
     * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Donkey%20Kong/data.json):
     * each throw's `ATTACK_ABS` (its one box here, the launch the legacy compile
     * turns into `ATTACK_ABS` + `ATK_HIT_ABS`), the frame of its `ATK_HIT_ABS`
     * (the box's frame), and its motion's `CancelFrame` − 1 (`totalFrames`).
     * UltimateFrameData (https://ultimateframedata.com/donkey_kong) agrees on
     * every one: Cargo Forward/Backward/Up/Down Throw 15/45, 16/42, 15/29, 17/44;
     * Backward, Up and Down Throw 15/39, 14/43, 19/54 (startup/total). It has no
     * row for the lift.
     */
    fthrow: {
      slot: "fthrow",
      name: "Kong Karry",
      // The lift (`cargo`): `game_throwf` is `WHOLE_HIT(HIT_STATUS_INVINCIBLE)` and
      // raises FIGHTER_DONKEY_STATUS_SHOULDER_START_FLAG_SHOULDER_WAIT on frame 16,
      // its motion `throw_f` CancelFrame 16; SmashWiki: "Invincibility 1-15",
      // "Animation length 15". Its ATTACK_ABS is the carry's catch kind (4%, the
      // page's "Carry release"), which no throw here deals (Plan 5, Task 7).
      totalFrames: 15,
      cargo: true,
      hitboxes: [],
    },

    bthrow: {
      slot: "bthrow",
      name: "Back Throw",
      // `game_throwb`: ATTACK_ABS 11%, angle 40, KBG 65, BKB 60; `REVERSE_LR()` and
      // `ATK_HIT_ABS` on frame 15; motion `throw_b` CancelFrame 40. Its script has a
      // command the sim does not run (`HitModule::set_status_all`), so this runs it.
      totalFrames: 39,
      turnAt: 15,
      hitboxes: [
        {
          id: 0,
          startFrame: 15,
          endFrame: 15,
          x: fx(-6.0),
          y: fx(9.0),
          radius: fx(4.0),
          damage: fx(11.0),
          angle: fx(40),
          baseKnockback: fx(60),
          knockbackGrowth: fx(65),
        },
      ],
    },

    uthrow: {
      slot: "uthrow",
      name: "Up Throw",
      // `game_throwhi`: ATTACK_ABS 9%, angle 90, KBG 50, BKB 70; `ATK_HIT_ABS` on
      // frame 14; CancelFrame 44. The imported script is what runs (`ACTIVE_SCRIPT_SLOTS`).
      totalFrames: 43,
      hitboxes: [
        {
          id: 0,
          startFrame: 14,
          endFrame: 14,
          x: fx(0),
          y: fx(12.0),
          radius: fx(4.0),
          damage: fx(9.0),
          angle: fx(90),
          baseKnockback: fx(70),
          knockbackGrowth: fx(50),
        },
      ],
    },

    dthrow: {
      slot: "dthrow",
      name: "Down Throw",
      // `game_throwlw`: ATTACK_ABS 7%, angle 361, KBG 50, BKB 60; `ATK_HIT_ABS` on
      // frame 19; CancelFrame 55. The imported script is what runs.
      totalFrames: 54,
      hitboxes: [
        {
          id: 0,
          startFrame: 19,
          endFrame: 19,
          x: fx(4.0),
          y: fx(2.0),
          radius: fx(4.0),
          damage: fx(7.0),
          angle: fx(361),
          baseKnockback: fx(60),
          knockbackGrowth: fx(50),
        },
      ],
    },

    // The cargo throws, from the carry: `game_throwff`, `game_throwfb`,
    // `game_throwfhi`, `game_throwflw`, motions `throw_f_f` … `throw_f_lw`
    // (CancelFrame 46, 43, 30, 45). SmashWiki gives the same numbers: Throw 15,
    // 16, 15, 17; Interruptible 46, 43, 30, 45. Each has 16 units of knockback
    // armour and no throw invincibility (`heavyArmour`; Task 8 fix round 1):
    // SmashWiki "Donkey Kong (SSBU)" (https://www.ssbwiki.com/Donkey_Kong_(SSBU)),
    // "He also gains Knockback-based Armor when he starts a throw instead of
    // gaining Throw Invulnerability, of which allows him to resist up to 16 Units
    // of Knockback".
    cargoFthrow: {
      slot: "cargoFthrow",
      heavyArmour: fx(16),
      name: "Cargo Forward Throw",
      totalFrames: 45,
      hitboxes: [
        {
          // ATTACK_ABS 12%, angle 60, KBG 46, BKB 90; ATK_HIT_ABS on frame 15.
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

    cargoBthrow: {
      slot: "cargoBthrow",
      heavyArmour: fx(16),
      name: "Cargo Back Throw",
      totalFrames: 42,
      // His hardest-hitting throw and his best kill throw. "Donkey Kong changes
      // direction on frame 16": `REVERSE_LR()`, then the launch, on frame 16.
      turnAt: 16,
      hitboxes: [
        {
          // ATTACK_ABS 13%, angle 72, KBG 52, BKB 85; ATK_HIT_ABS on frame 16.
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

    cargoUthrow: {
      slot: "cargoUthrow",
      heavyArmour: fx(16),
      name: "Cargo Up Throw",
      totalFrames: 29,
      hitboxes: [
        {
          // The "Ding-Dong" throw of Smash 4, deliberately given more knockback
          // in Ultimate so it stops being a guaranteed kill confirm. ATTACK_ABS
          // 12%, angle 92, KBG 53, BKB 65; ATK_HIT_ABS on frame 15.
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

    cargoDthrow: {
      slot: "cargoDthrow",
      heavyArmour: fx(16),
      name: "Cargo Down Throw",
      totalFrames: 44,
      // "On frame 17, the move stops Donkey Kong's horizontal momentum, and sets
      // his vertical momentum to 1.5" (`SET_SPEED_EX(0, 1.5, …)` on 17); SmashWiki
      // "Donkey Kong (SSBU)": "a small boost upwards when using this move in the
      // air". So the 1.5 only in the air (`airOnly`; Task 8 fix round 1): the
      // script has the one command for both, and a throw on the ground stays on it.
      momentum: [{ frame: 17, x: fx(0), y: fx(1.5), airOnly: true }],
      hitboxes: [
        {
          // A semi-spike at 46°: the stage-spike throw. ATTACK_ABS 11%, angle 46,
          // KBG 45, BKB 70; ATK_HIT_ABS on frame 17.
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

    // Plan 5, Task 15 — Jungle Rush. Sources: rubendal Data Viewer 13.0.1
    // (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Donkey%20Kong/data.json),
    // `game_finalstart`, `game_finalattack`, `game_finalend` and their motions'
    // CancelFrames; SmashWiki "Donkey Kong (SSBU)/Final Smash"
    // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Final_Smash): Detection "29-34",
    // hits 1-18 "6-7, 10-11, … 74-75", hits 19-31 "79, 83, … 127", "Final hit
    // 139-140"; SmashWiki "Jungle Rush" (https://www.ssbwiki.com/Jungle_Rush): "If
    // the first hit doesn't make contact, the whole attack fails", "a barrage of 31
    // more rapid punches", "33 total hits"; SmashWiki "Donkey Kong (SSBU)"
    // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)): "12% (initial hit), 1.2% (rapid
    // hits 1-18), 1.1% (rapid hits 19-31), 14% (final hit), 61.9% (maximum)";
    // SmashWiki "Final Smash" (https://www.ssbwiki.com/Final_Smash): Final Smashes
    // "make the user fully intangible".
    // - The detection punch: 12%, angle 361, KBG 0, BKB 0, radius 13, a capsule on
    //   `top` 10 up from 8 to 28 ahead, hitlag ×5, ATTACK_SETOFF_KIND_OFF,
    //   ATTACK_LR_CHECK_POS, frames 29-34: it traps. The script raises
    //   FIGHTER_DONKEY_STATUS_FINAL_FLAG_TO_ATTACK on 37, where the barrage starts
    //   (`nextAt`). A whiff plays final_start to its CancelFrame, 97.
    // - The barrage, `game_finalattack`'s two loops: 18 × 1.2% from its frame 6 and
    //   13 × 1.1% from 79, one every 4 frames; the lead box's angle 135, KBG 100, FKB
    //   40, radius 8.5, hitlag ×0.4, OFF. The uppercut lands on 139-140 of the same
    //   timeline, and `game_finalend` opens it on its frame 7, so the barrage lasts
    //   132 frames.
    // - The uppercut, `game_finalend`: 14%, angle 70, KBG 96, BKB 90, hitlag ×1, OFF,
    //   POS, `set_force_reaction`, on its frame 7 (radius 15 and 11 up, its box 3's).
    //   Its script runs FT_MOTION_RATE(FSM=0.8) from frame 30, so final_end's
    //   CancelFrame 70 comes on game frame 62 (`gameFrameOfMotion`; Task 15 fix round
    //   1, ruling R-T15i): 61 frames. In the air it is `game_finalairend`, the same
    //   boxes, with no rate: final_air_end's CancelFrame 47, 46 frames
    //   (`aerialTotalFrames`, read where Donkey Kong is when it could end; UNVERIFIED:
    //   the game picks final_air_end where the end begins).
    // UNVERIFIED-simplified: each scene hit is the first frame of its window (the
    // page's "6-7" is one hit; `finalKit.ts`). The barrage's knockback (FKB 40) is
    // the scene's: a trapped fighter is held. `DisableHitlag=true` is not modelled,
    // as for every box. The uppercut's boxes are world boxes in its script (no
    // `set_catch_only_all`), but here they reach only the trapped, as every end box
    // does (Task 14's reading).
    // UNVERIFIED: the scene boxes' x (the stand-in 10): they reach the trapped
    // wherever they are.
    finalSmash: {
      slot: "finalSmash",
      name: "Jungle Rush",
      totalFrames: 96,
      intangible: [1, 96],
      // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 19 to the
      // fighter it holds, where the lunge this part holds stays off its body
      // (`sceneDrawShift`); 12 from the barrage on, where its clips stay off.
      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 37, sceneGap: fx(19) },
      hitboxes: [finalBox(0, 29, 34, { damage: 12, angle: 361, kbg: 0, radius: 13, x: 8, y: 10, x2: 28, y2: 10, hitlag: 5, transcendent: true, lr: "position" })],
    },
    finalAttack: {
      slot: "finalAttack",
      name: "Jungle Rush (barrage)",
      totalFrames: 132,
      intangible: [1, 132],
      // The drawing (Task 17 fix rounds 1 and 2, rulings R-T17d and R-T17i): no nearer
      // than 12 to the fighter it holds, where the barrage's clip stays off its body.
      // 15 from one held behind him (fix round 3, ruling R-T17n): his back and legs
      // reach further behind than his punches do ahead.
      final: { phase: "attack", next: "finalEnd", sceneGap: fx(12), sceneGapBehind: fx(15) },
      hitboxes: [
        ...barrage(0, 6, 18, 4, { damage: 1.2, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true }),
        ...barrage(18, 79, 13, 4, { damage: 1.1, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true }),
      ],
    },
    finalEnd: {
      slot: "finalEnd",
      name: "Jungle Rush (uppercut)",
      totalFrames: 61,
      aerialTotalFrames: 46,
      intangible: [1, 61],
      // The drawing (Task 17 fix rounds 1 and 2, rulings R-T17d and R-T17i): 13, a
      // unit past the barrage's, so his head clears the knee of a fighter the
      // uppercut sends up past it.
      final: { phase: "end", sceneGap: fx(13), sceneGapBehind: fx(15) },
      hitboxes: [finalBox(0, 7, 7, { damage: 14, angle: 70, kbg: 96, bkb: 90, radius: 15, y: 11, hitlag: 1, transcendent: true, lr: "position", forceReaction: true })],
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

/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const donkeyKong: FighterDef = withReferenceScripts(legacy, DONKEY_KONG, ACTIVE_SCRIPT_SLOTS.donkeyKong);
