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
import type { FighterDef, Hitbox } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { KIRBY } from "./acmd/generated/kirby";
import { FIGHTER_PARAMS } from "./params";

/** UNVERIFIED: hurtbox dimensions are unpublished. Kirby is a sphere a little
 * over half Mario's height — the smallest silhouette on this roster alongside
 * Pikachu, and SmashWiki ties them for the seventh-lightest fighter. */
const HEIGHT = 6.6;
const HALF_WIDTH = 1.9;

/** The hand-authored moveset; `kirby` below runs its root-bone moves from the imported scripts. */
/**
 * The Inhale's two pull windboxes, out for one frame on `frame` (Plan 5, Task 9 fix
 * round 1; `neutralB` gives their source): the far one for grounded fighters
 * only, the near one for all, both pulling at 160°.
 */
function inhalePull(frame: number, id: number): Hitbox[] {
  const pull = { startFrame: frame, endFrame: frame, damage: fx(0), angle: fx(160), baseKnockback: fx(0), knockbackGrowth: fx(100), windbox: true, transcendent: true } as const;
  return [
    { ...pull, id, x: fx(15.5), y: fx(7.0), radius: fx(8.5), fixedKnockback: fx(30), situation: "ground" },
    { ...pull, id: id + 1, x: fx(9.7), y: fx(7.0), radius: fx(7.8), fixedKnockback: fx(25) },
  ];
}

const legacy: FighterDef = {
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
    // Air dodges (Plan 3, Task 20c): fudgepop01/amiibo_research
    // `fighter_param_motion.xml` @523374aa, the `fighter_kind_kirby` entry (L595):
    // L616 `escape_air_stiff_frame`, L612-613 `escape_air_hit_xlu_frame` /
    // `_hit_normal_frame`, L704-706 `escape_air_slide_stiff_frame` / `_u_` /
    // `_d_`, L619-620 `escape_air_slide_hit_xlu_frame` / `_hit_normal_frame`.
    airDodge: {
      neutralFrames: 61,
      neutralIntangible: [3, 27],
      sideFrames: 102,
      upFrames: 141,
      downFrames: 82,
      directionalIntangible: [3, 19],
    },
    // Spot dodge and rolls (Plan 3 final wave): UltimateFrameData,
    // https://ultimateframedata.com/kirby, "Dodges / Rolls": each "Total frames"
    // and "Intangible on frame a-b", fresh. The spot dodge is the second of
    // UFD's "21/26"; the first is its cancel, not modelled (`GroundDodgeAttributes`).
    groundDodge: {
      spotDodge: { frames: 26, intangible: [3, 17] },
      forwardRoll: { frames: 30, intangible: [4, 15] },
      backRoll: { frames: 35, intangible: [5, 16] },
    },
  },

  params: FIGHTER_PARAMS.kirby,

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
      // SmashWiki "Kirby (SSBU)/Neutral special"
      // (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special), 6.0.0: "Inhale has
      // less startup (frame 14 → 10) with its total duration reduced as well (FAF 68
      // → 64)"; "Loop 11-44", "Interruptible (from release) 64 (20)". So 63, the
      // loop's last frame and 19 (Plan 5, Task 9 fix round 1). UltimateFrameData's
      // 67 (https://ultimateframedata.com/kirby) is the pre-6.0.0 total.
      totalFrames: 63,
      // Plan 5, Task 9: the catch puts the fighter caught in his mouth
      // (`swallowed`, Kirby `inhaleHold`), from which B or down swallows
      // (`inhaleSwallow`) and attack spits (`inhaleSpit`): SmashWiki "Inhale
      // (Kirby)" (https://www.ssbwiki.com/Inhale_(Kirby)), "Kirby can swallow the
      // victim by pressing down or the special move button", and "spit them out
      // as a star ... by pressing the attack button".
      inhale: { swallow: "inhaleSwallow", spit: "inhaleSpit" },
      // Held, the loop goes on (`holdLoop`, Task 9 fix round 1): "Kirby will not stop
      // inhaling until the button is released" (SmashWiki "Inhale (Kirby)"); its 34
      // frames ("Minimum inhale duration 34 frames") always play. UNVERIFIED: that a
      // held loop repeats 35-44 (the page's "loop points 34-35").
      holdLoop: { from: 35, to: 44 },
      // Not a damaging move: a catch, and a pull. Boxes from rubendal SSBU Data
      // Viewer 13.0.1 (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Kirby/data.json),
      // Z forward and Y up as `x`/`y` (Task 9 fix round 1):
      // - `SpecialNStart`: `CATCH(ID=0, Size=6.0, Y=6.0, Z=5.0, …_GA)` on motion
      //   frame 18 at `FT_MOTION_RATE(0.5)`, game frame 10 ("Start 10"); the loop
      //   takes over on 11;
      // - `SpecialNLoop`, frames 11-44: `CATCH(ID=1, Size=5.8, Y=6.4, Z=6.2, …_GA)`
      //   and `CATCH(ID=0, Size=5.3, Y=6.4, Z=10.2, …_A)`, airborne fighters only;
      // - the pull, `ATTACK(ID=0, Size=8.5, Y=7.0, Z=15.5, …_G_d)`, grounded
      //   fighters only, and `ATTACK(ID=1, Size=7.8, Y=7.0, Z=9.7, …_GA_d)`: Angle 160,
      //   KBG 100, FKB 30 / 25, BKB 0, `Flinchless=true` (a windbox),
      //   `DisableHitlag=true`, `Clang_Rebound=ATTACK_SETOFF_KIND_OFF`, `Rehit=10`.
      //   The rehit is the boxes' own: out one frame on 11, 21, 31 and 41 (and, held,
      //   on 41 each time round), leaving no mark on the swing's record
      //   (`simulate.ts` `unrecorded`). UNVERIFIED: SSBU times a rehit from each
      //   victim's last hit; SmashWiki's "Opponent vacuum speed 0.9, 1.2" is not
      //   matched to the pull's knockback.
      // The catch boxes have the lower ids, so a fighter both reach is caught. The
      // pulls are listed first, as the compiled script lists attacks before catches.
      // Published, not modelled: "Minimum opponent vacuum time before they are
      // inhaled 4 frames", and inhaling projectiles and items.
      hitboxes: [
        ...[11, 21, 31, 41].flatMap((frame, k) => inhalePull(frame, 3 + 2 * k)),
        { id: 0, startFrame: 10, endFrame: 10, x: fx(5.0), y: fx(6.0), radius: fx(6.0), damage: fx(0), angle: fx(0), baseKnockback: fx(0), knockbackGrowth: fx(0), grabbing: true },
        { id: 1, startFrame: 11, endFrame: 44, x: fx(6.2), y: fx(6.4), radius: fx(5.8), damage: fx(0), angle: fx(0), baseKnockback: fx(0), knockbackGrowth: fx(0), grabbing: true },
        { id: 2, startFrame: 11, endFrame: 44, x: fx(10.2), y: fx(6.4), radius: fx(5.3), damage: fx(0), angle: fx(0), baseKnockback: fx(0), knockbackGrowth: fx(0), grabbing: true, situation: "air" },
      ],
    },

    inhaleSwallow: {
      slot: "inhaleSwallow",
      name: "Inhale (swallow)",
      // SmashWiki "Kirby (SSBU)/Neutral special"
      // (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special), Swallow: "Throw
      // release frame 8", "Interruptible 21"; its throw 10.0% at 361, BK 0, KS 0,
      // H× 0.0×: the damage lands and nothing launches or freezes. The fighter
      // swallowed's neutral special becomes his Copy Ability (`engine/inhale.ts`).
      totalFrames: 20,
      // The swallowed fighter flies out of him on a star (Task 9 fix round 1;
      // SmashWiki's Swallow and Copy Ability parameters): "Star Y offset 7u", "Star
      // duration 10 frames", "Star initial speed 3.4", "Star travel angle 62°",
      // "Star friction 0.17". Its box ("Star hitbox 8-17") has no published damage,
      // so it hits nothing here. UNVERIFIED: that the 62° points forward.
      release: {
        frame: 8,
        kind: "swallow",
        damage: fx(10.0),
        star: { offsetY: fx(7.0), speed: fx(3.4), angle: fx(62), friction: fx(0.17), frames: 10 },
      },
      hitboxes: [],
    },

    inhaleSpit: {
      slot: "inhaleSpit",
      name: "Inhale (spit)",
      // SmashWiki, Spit: "Throw release frame 8", "Interruptible 31" on the ground
      // and "Interruptible (aerial) 39" in the air (Task 9 fix round 1:
      // `aerialTotalFrames`); its throw 6.0%, BK 0, KS 0, H× 0.0×.
      totalFrames: 30,
      aerialTotalFrames: 38,
      release: { frame: 8, kind: "spit", damage: fx(6.0) },
      hitboxes: [],
      projectiles: [
        {
          // The spat fighter as a star (SmashWiki, the star's parameters and hitbox
          // table): "Offsets 7, 7"; "Can pierce opponents? Yes"; radius 2.5, angle 45
          // ("Speed-based": the way it flies), BK 70, KS 78, "H× 2.0×"; its damage is
          // the rider's weight's row (`starDamage`: the box carries 1%, its
          // `chargeScale` the rest); "its speed ... 2.8 + 0.008(t - k)" (2.8 here,
          // and the release sets the rest), slowing "by 0.05 per frame", letting go
          // "below 0.4", for "a maximum of 60" frames. Reflectable (the table).
          // UNVERIFIED-simplified: the table's clang (projectiles here are
          // transcendent, `schema.test.ts`).
          id: "star",
          spawnFrame: 8,
          offsetX: fx(7.0),
          offsetY: fx(7.0),
          vx: fx(2.8),
          vy: fx(0),
          gravity: fx(0),
          lifetime: 60,
          destroyOnHit: false,
          drag: { perFrame: fx(0.05), minSpeed: fx(0.4) },
          ridden: true,
          visual: "spark",
          reflectable: true,
          hitbox: {
            id: 0,
            startFrame: 0,
            endFrame: 59,
            x: fx(0),
            y: fx(0),
            radius: fx(2.5),
            damage: fx(1.0),
            angle: fx(45),
            baseKnockback: fx(70),
            knockbackGrowth: fx(78),
            hitlagMultiplier: fx(2.0),
            transcendent: true,
          },
        },
      ],
    },

    sideB: {
      slot: "sideB",
      name: "Hammer Flip",
      totalFrames: 69,
      // Hold mode (Plan 5), SmashWiki "Kirby (SSBU)/Side special"
      // (https://www.ssbwiki.com/Kirby_(SSBU)/Side_special): "Total charge time
      // 120 frames", "Charges between 15-16"; before full "each charge frame
      // adding 0.085% damage to the hitboxes, for a maximum of 29.115%" (0.085
      // × 120 = 10.2 over the whole charge); full charge "changed directly":
      // 35%, angle 361, same BK/KS. Interruptible 70.
      //
      // Held at full: SmashWiki "Charge" (https://www.ssbwiki.com/Charge): it
      // "Can be held indefinitely"; "While fully charged, 1% damage is dealt to
      // Kirby". The side special page: "Interval for recoil damage at full
      // charge 26 frames", "Maximum percent for full charge recoil damage
      // 100%". UNVERIFIED readings: the first burn comes 26 frames after the
      // charge fills, and none at or above 100%.
      //
      // Published, not modelled: Kirby walking while he charges ("Kirby can move
      // while charging": "Walk speed while charging 0.4", "Jump speed
      // multiplier while charging 0.5"; carried to D58), and the full charge's
      // own frames (hit 11-12 and interruptible 60 from release, intangible
      // 2-10, super armour 11-17).
      specialCharge: {
        mode: "hold",
        frames: 120,
        loopFrame: 15,
        partial: { kind: "add", total: fx(10.2) },
        full: { 0: { damage: fx(35.0), angle: fx(361) } },
        atFull: "hold",
        recoil: { every: 26, damage: fx(1), below: fx(100) },
      },
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
      momentum: [
        { frame: 3, x: fx(0.2), y: fx(3.2), hold: 12 },
        { frame: 24, x: fx(0.2), y: fx(-3.4), hold: 14 },
      ],
      // Ends helpless (Plan 5, Task 4b): SmashWiki "Helpless"
      // (https://www.ssbwiki.com/Helpless) lists Final Cutter, whose helplessness
      // shows "only when landing on the ground", for the lag of SmashWiki "Kirby
      // (SSBU)/Up special" (https://www.ssbwiki.com/Kirby_(SSBU)/Up_special),
      // "Landing (cutter)": "Interruptible 31"; UltimateFrameData's landing lag 30
      // (https://ultimateframedata.com/kirby). UNVERIFIED: the drift, as no
      // multiplier is published (his own air speed); in the game the move falls on
      // until he lands, and here it ends in the air after its 60 frames.
      helpless: { landingLag: 30, airSpeed: fx(1) },
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(117),
          // Set weight: Final Cutter's `SpecialHi2` script, `FKB=117, BKB=0, KBG=100,
          // SetWeight=true` (rubendal/ssbu data, patch 13.0.1,
          // https://github.com/rubendal/ssbu/blob/b97bd3370c13eb34f40aad208e3527a2935c13a9/data/patch/13.0.1/character/Kirby/data.json;
          // the generated `game_specialhi` has no ATTACK). Plan 3, Task 16b.
          setWeight: true,
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(96),
          // Set weight: `SpecialHi2`, `FKB=96, KBG=100, SetWeight=true` (rubendal/ssbu data,
          // as the rising hit above). Plan 3, Task 16b.
          setWeight: true,
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
      superArmourFrames: [10, 48],
      momentum: [{ frame: 12, x: fx(0), y: fx(-5.4), hold: 34 }],
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(30),
          // Set weight: `game_catchattack` (generated/kirby.ts; Plan 3, Task 16b).
          setWeight: true,
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
          baseKnockback: fx(0),
          knockbackGrowth: fx(100),
          fixedKnockback: fx(10),
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

/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const kirby: FighterDef = withReferenceScripts(legacy, KIRBY, ACTIVE_SCRIPT_SLOTS.kirby);
