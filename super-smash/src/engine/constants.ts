/**
 * Universal Super Smash Bros. Ultimate constants.
 *
 * Every number here was researched against SmashWiki or Kurogane Hammer rather
 * than tuned by feel, and each carries the citation that produced it. They are
 * in one file because they are the game's *rules* — a fighter may have its own
 * weight and its own gravity, but every fighter shares one jumpsquat, one
 * shieldstun formula and one hitlag cap. See `research/physics-and-knockback.md`.
 */

import { fx } from "./fixed";
import type { Ratio } from "./fixed";

/** The simulation runs at a fixed 60Hz. Every "frame" in this codebase is 1/60s. */
export const TICK_RATE = 60;

/**
 * The version of the engine's combat rules. Two online peers whose builds
 * differ here play different games and desync on the first hit, so the
 * version goes into `engineFingerprint` (`src/game/simContext.ts`). Plan 3
 * sets it to 3; each later plan that changes what `step()` does bumps it once,
 * as its first engine task (Plan 4 sets 4, Plan 5 sets 5).
 *
 * Inside a plan the rules move task by task and the version stays: a task that
 * changes behaviour regenerates the golden trace, and
 * `src/game/rulesVersion.test.ts` pins the trace's digest beside this number, so
 * that task rewrites the digest in the pin and nothing else. Bumping this
 * number fails the same test until the pin's version follows.
 */
export const ENGINE_RULES_VERSION = 3;

/* ------------------------------------------------------------------ combat -- */

/**
 * The multipliers below are `Ratio`s, not `fx()` values, and that is load-bearing.
 *
 * Every one of them scales a quantity that is eventually **floored to a whole
 * frame** — hitstun and hitlag directly, shieldstun directly, and knockback via
 * `floor(kb x 0.4) - 1`. Q12 cannot hold 1.4, 0.85, 0.65, 0.8, 0.725, 0.33,
 * 0.29 or 0.67 exactly, and at a floor a ten-thousandth of error is a whole
 * frame rather than a rounding error: `fx(0.65)` is fractionally *under* 0.65
 * and drops a frame of hitlag at every exact boundary, `fx(0.8)` is
 * fractionally *over* and gains one of shieldstun. See `Ratio` in `fixed.ts`.
 */

/** Knockback formula's constant multiplier. Unchanged since Melee. */
export const KB_MULTIPLIER: Ratio = [7, 5];
/** Knockback formula's additive term. Unchanged since Melee. */
export const KB_ADDEND = fx(18);

/** Hitstun = floor(knockback * 0.4) - 1. Ultimate subtracts the extra frame. */
export const HITSTUN_RATIO: Ratio = [2, 5];

/**
 * A hit causing this much hitstun or more puts the victim into tumble. Tumble
 * is the reaction frames (hitstun + 1) reaching 32, which is knockback 80:
 * rubendal SSBU-Calculator (https://github.com/rubendal/SSBU-Calculator), whose
 * `Hitstun` is `floor(kb × 0.4) − 1`, and `ssbu_ref.mjs` `isTumble`
 * (`floor(kb × 0.4) − 1 + 1 ≥ 32`). In hitstun frames that is 31.
 */
export const TUMBLE_HITSTUN = 31;

/**
 * Launch speed starts at this fraction of knockback and decays per frame:
 * SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback, Formula >
 * Variables): launch speed is knockback × 0.03, and it "decays by 0.051 every
 * frame". The page names no single game, so 0.051 is the series figure (D55,
 * Open).
 */
export const LAUNCH_SPEED_RATIO = fx(0.03);
export const LAUNCH_SPEED_DECAY = fx(0.051);

/**
 * Hitstun cancel: an airborne victim may air dodge from hitstun frame 41 while
 * the launch is slower than 2.5, or attack from frame 46 while it is slower than
 * 2. SmashWiki "Hitstun canceling" (https://www.ssbwiki.com/Hitstun_canceling):
 * "after frame 40" / "after frame 45"; rubendal SSBU-Calculator
 * `parameters.hitstunCancel` (frames 40/45, launch speeds 2.5/2).
 */
export const HITSTUN_CANCEL_AIR_DODGE_FRAME = 41;
export const HITSTUN_CANCEL_AERIAL_FRAME = 46;
export const HITSTUN_CANCEL_AIR_DODGE_SPEED = fx(2.5);
export const HITSTUN_CANCEL_AERIAL_SPEED = fx(2);

/**
 * A flinching hit's reaction frames never fall below 5, so hitstun never below
 * 4 (SmashWiki "Hitstun": "a minimum of 4 frames"; rubendal `Hitstun`).
 */
export const HITSTUN_MIN_FAF = 5;

/**
 * The balloon speed-up (`init_damage_speed_up`; rubendal SSBU-Calculator
 * `InitDamageSpeedUp`/`ReactionFrameMulSpeedUp`): a launch of 30 reaction
 * frames or fewer is not sped up, one of 80 or more starts at 6×, and the
 * multiplier falls to nothing once 70% of the reaction frames have passed.
 * The ">200 knockback adds (kb − 200) × 0.25" of SmashWiki "Hitstun" is this
 * schedule's 6× cap, not a separate rule.
 */
export const SPEED_UP_FAF_MIN = 30;
export const SPEED_UP_FAF_MAX = 80;
export const SPEED_UP_MAX_MAG = 6;

/** Vertical launches (70°-110°) get a fixed fall speed — "balloon knockback". */
export const BALLOON_ANGLE_MIN = fx(70);
export const BALLOON_ANGLE_MAX = fx(110);
/**
 * Read only by the legacy `applyGravity` test oracle (`physics.ts`). The
 * engine's balloon fall is each fighter's `damage_fly_top_speed_y_stable`
 * (`kineticReel`), which is also 1.8 for the whole roster.
 */
export const BALLOON_FALL_SPEED = fx(1.8);

/**
 * Set weight (smash-script `set_weight`): every victim weighs this in the
 * knockback formula, the set-knockback one included. SmashWiki "Knockback"
 * (https://www.ssbwiki.com/Knockback, revision 2063895): `w` "is set to 100 if
 * the attack is weight independent"; rubendal SSBU-Calculator passes
 * `set_weight ? 100 : weight` to `VSKB` and to `WeightBasedKB` alike
 * (https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/worker/multiworker.js#L206-L210).
 */
export const SET_WEIGHT = 100;
/**
 * A set-weight launch's own fall (same page, Weight-independent knockback): in
 * Ultimate the victim gets "a fall speed of 1.5 and gravity of 0.087 for the
 * first 10 frames of the launch, before reverting back to a fighter's regular
 * fall speed and gravity. Notably, this effect overrides the homogenised fall
 * speed and gravity used by attacks which have an angle between 70˚ and 110˚"
 * — so a set-weight launch is never balloon fall ("weight-independent moves do
 * not homogenize falling speeds", Formula). 0.087 is 356/4096 in Q12. The
 * frames are counted as the launch's reaction frames in hitstun: UNVERIFIED,
 * the page does not say what ends them early (`kinetic.ts`, `setWeightFrames`).
 */
export const SET_WEIGHT_GRAVITY = fx(0.087);
export const SET_WEIGHT_FALL_SPEED = fx(1.5);
export const SET_WEIGHT_LAUNCH_FRAMES = 10;

/** Rage: 1 + ((percent - 35) / 115) * 0.1, applied to knockback only. */
export const RAGE_START = fx(35);
export const RAGE_CAP = fx(150);
export const RAGE_MAX_BONUS = fx(0.1);

/** Ultimate's 1v1 bonus. Applies to damage *taken*, in a 2-player match only. */
export const ONE_ON_ONE_MULTIPLIER = fx(1.2);

/** Short-hopped aerials deal 85% damage, which lowers their knockback too. */
export const SHORT_HOP_DAMAGE = fx(0.85);

/** Hitlag = floor((damage * 0.65 + 6) * multipliers), capped. */
export const HITLAG_RATIO: Ratio = [13, 20];
export const HITLAG_ADDEND = fx(6);
export const HITLAG_CAP = 30;
export const HITLAG_ELECTRIC: Ratio = [3, 2];
export const HITLAG_SHIELDING: Ratio = [67, 100];
/**
 * A crouching victim cuts hitlag to 0.67x — for *both* fighters, not just the
 * one who crouched. research/physics-and-knockback.md section 4.
 */
export const HITLAG_CROUCH_CANCEL: Ratio = [67, 100];

/** The angle value meaning "depends on whether the victim is grounded". */
export const SAKURAI_ANGLE = fx(361);
/**
 * What the Sakurai angle resolves to. SmashWiki "Sakurai angle"
 * (https://www.ssbwiki.com/Sakurai_angle), Ultimate: an airborne victim always
 * goes at 38°; a grounded one goes flat below 60 knockback, at 38° from 88, and
 * on a linear ramp between — rubendal SSBU-Calculator `SakuraiAngle`:
 * `min((kb − 60)/(88 − 60) × 38 + 1, 38)`.
 */
export const SAKURAI_GROUNDED = fx(0);
export const SAKURAI_AIRBORNE = fx(38);
export const SAKURAI_KB_LOW = fx(60);
export const SAKURAI_KB_HIGH = fx(88);
/**
 * A flat launch (0°) of 120 knockback or more goes out at 32° instead
 * (SmashWiki "Sakurai angle", Ultimate; rubendal `js/knockback.js`, which
 * applies it to 0° and 180°). For 180° the replica uses the mirror, 148°, so a
 * backward launch stays backward — UNVERIFIED: rubendal sets 32° for both.
 */
export const FLAT_LIFT_KB = fx(120);
export const FLAT_LIFT_ANGLE = fx(32);
/**
 * A grounded victim launched at 0° leaves at 0.8 of the launch speed
 * (rubendal `js/knockback.js`, `groundedZeroAngle`).
 */
export const GROUNDED_ZERO_LAUNCH_RATIO: Ratio = [4, 5];

/**
 * Knockback stacking (SmashWiki "Knockback", stacking, Ultimate): a new launch
 * from another source at 0.5×–0.9× of the live one keeps the live one; under
 * 0.5× the target armours through it.
 */
export const KB_STACK_ARMOUR: Ratio = [1, 2];
export const KB_STACK_KEEP: Ratio = [9, 10];

/**
 * A hitbox that reaches less than 0.1 units into a hurtbox is a glancing blow and
 * does not hit (SmashWiki "Glancing blow", https://www.ssbwiki.com/Glancing_blow:
 * "less than 0.1 units through a hurtbox"; unchanged from Brawl into Ultimate).
 */
export const GLANCING_BLOW_DEPTH = fx(0.1);

/**
 * Autolink angles (SmashWiki "Autolink angle", https://www.ssbwiki.com/Autolink_angle):
 * 365° launches at half the attacker's momentum; 367° at the attacker's
 * momentum plus 20% of the hitbox-to-victim difference, 80° against a grounded
 * victim, launch speed capped at 3 and vertical speed at −1. Autolink angles
 * are above the 0-360 range of real angles, so they are told apart by value.
 * 363°, 366° and 368° are not modelled (`AUTOLINK_UNMODELLED`).
 */
export const AUTOLINK_MIN = fx(365);
export const AUTOLINK_MAX = fx(368);
export const AUTOLINK_HALF_MOMENTUM = fx(365);
export const AUTOLINK_PULL_RATIO: Ratio = [1, 5];
export const AUTOLINK_GROUNDED_ANGLE = fx(80);
export const AUTOLINK_SPEED_CAP = fx(3);
export const AUTOLINK_MIN_VY = fx(-1);

/**
 * The autolink angles the engine does not model, and refuses at load
 * (`prepareFighterScripts`, `activatable`; Plan 3, Task 19 fix round 1). The
 * page describes each as unlike 367°: 363° launches "in the direction the
 * attacker is moving into, albeit without launch speed modifications"; 366°
 * "does not reduce the launch speed obtained from knockback", "does not have
 * any caps for launch speed, nor it launches grounded opponents at a fixed
 * angle", and its pull "only lasts for 5 frames"; 368° "appears to function as
 * a mix between the 366° and 367° angles", with position vectors (SmashWiki
 * "Autolink angle", https://www.ssbwiki.com/Autolink_angle). 364° is on no
 * page and is no angle.
 */
export const AUTOLINK_UNMODELLED: readonly number[] = [fx(363), fx(366), fx(368)];

/** Two hitboxes within this damage difference clank instead of trading. */
export const CLANK_RANGE = fx(9);

/** Staleness: Ultimate keeps most knockback on a stale move (0.3x the effect). */
export const STALE_QUEUE_LENGTH = 9;
export const STALE_KNOCKBACK_DAMPING = fx(0.3);

/* ------------------------------------------------------------------ shield -- */

export const SHIELD_MAX_HEALTH = fx(50);
export const SHIELD_DECAY_PER_FRAME = fx(0.15);
export const SHIELD_REGEN_PER_FRAME = fx(0.08);
/** Frames of the shield-drop animation. */
export const SHIELD_RELEASE_FRAMES = 11;
/** Shield must be held this long before it can be dropped. */
export const SHIELD_MIN_HOLD = 3;
/**
 * Perfect shield is on *release* in Ultimate, not on press: dropping shield
 * within this many frames of the animation starting parries the hit.
 */
export const PERFECT_SHIELD_WINDOW = 5;

/**
 * Extra hitlag on a perfect shield, [attacker, defender], added to the hit's
 * *shield* hitlag (×0.67) — SmashWiki "Perfect shield"
 * (https://www.ssbwiki.com/Perfect_shield), Ultimate: direct non-projectile
 * +14/+11 ("the defender can act 3 frames earlier than shielding the attack
 * normally"), indirect non-projectile +14/+2, direct projectile 0/+8, indirect
 * projectile 0/−1. The values are the wiki's.
 *
 * UNVERIFIED (`PARRY_MELEE_*`): rubendal SSBU-Calculator's `ParryHitlag` and
 * `AttackerParryHitlag` (`js/formulas.js`) disagree on the melee rows. They add
 * to the plain, unshielded hitlag, not the ×0.67 one, and give attacker/defender
 * +11/+8 direct and +8/−1 indirect. The two sources contradict each other, so
 * these two rows are a choice, recorded as an open question; the projectile rows
 * (defender +8 direct, −1 indirect; thrower 0) agree on their offsets.
 */
export const PARRY_MELEE_DIRECT = [14, 11] as const;
export const PARRY_MELEE_INDIRECT = [14, 2] as const;
export const PARRY_PROJECTILE_DIRECT = [0, 8] as const;
export const PARRY_PROJECTILE_INDIRECT = [0, -1] as const;
/**
 * A perfect shield's pushback factor (SmashWiki "Shield (SSBU)", pushback table: "0.15 for a perfect
 * shield"). It multiplies inside the formula, before the 1.3 cap (`shieldPushback`).
 */
export const PERFECT_SHIELD_PUSHBACK_RATIO: Ratio = [3, 20];

/** shieldstun = floor(0.8 * damage * typeMult * moveMult * projMult + 2). */
export const SHIELDSTUN_RATIO: Ratio = [4, 5];
export const SHIELDSTUN_ADDEND = fx(2);
export const SHIELDSTUN_SMASH: Ratio = [29, 40];
export const SHIELDSTUN_AERIAL: Ratio = [33, 100];
export const SHIELDSTUN_PROJECTILE: Ratio = [29, 100];
/** Ultimate is the only game in the series that caps shieldstun. */
export const SHIELDSTUN_CAP = 60;

/**
 * The shieldBroken clip's length in the renderer (`render/poses/timing.ts`).
 * The engine's stun is `shieldBreakStun` (`shield.ts`): 400 − percent.
 */
export const SHIELD_BREAK_STUN = 240;

/** Shield damage is the hit's ×1.19 (SmashWiki "Shield", Ultimate). */
export const SHIELD_DAMAGE_RATIO: Ratio = [119, 100];
/** Shield size `(HP/50) × 0.85 + 0.15` of the full radius (SmashWiki "Shield"). */
export const SHIELD_SIZE_MIN = fx(0.15);
/** Defender pushback `min((shieldstun + 1) × 0.09, 1.3)` (SmashWiki "Shield"). */
export const SHIELD_PUSHBACK_RATIO: Ratio = [9, 100];
export const SHIELD_PUSHBACK_MAX = fx(1.3);
/** Attacker pushback `0.04 × damage + 0.025` (rubendal SSBU-Calculator `AttackerShieldPushback`). */
export const SHIELD_ATTACKER_PUSHBACK_RATIO: Ratio = [1, 25];
export const SHIELD_ATTACKER_PUSHBACK_ADD = fx(0.025);
/** Shield-break stun `400 − percent` frames (SmashWiki "Stun"). */
export const SHIELD_BREAK_STUN_BASE = 400;
/** A broken shield comes back at 37.5 HP, 75% (SmashWiki "Shield break"). */
export const SHIELD_BREAK_RESET = fx(37.5);
/**
 * Mashing out of shield-break stun, in tenths of a frame: 5.4 frames a button
 * press, 3 a stick input (SmashWiki "Stun").
 */
export const SHIELD_BREAK_MASH_BUTTON = 54;
export const SHIELD_BREAK_MASH_STICK = 30;
/**
 * After the stun, "every character has an animation for regaining
 * consciousness … (known internally as FuraFuraEnd), which lasts … 33 frames
 * from Smash 4 onward" (SmashWiki "Stun").
 */
export const FURAFURA_END_FRAMES = 33;

/* ------------------------------------------------------------- movement -- */

/** Universal in Ultimate — the change that made short-hop aerials a decision. */
export const JUMP_SQUAT_FRAMES = 3;

/** Most of the cast fast-falls 60% faster than their normal fall speed. */
export const FAST_FALL_MULTIPLIER = fx(1.6);

/** The initial-dash animation may be interrupted from this frame, for everyone. */
export const DASH_INTERRUPT_FRAME = 15;
/** A direction held this long past the press becomes a dash rather than a walk. */
export const DASH_THRESHOLD_FRAMES = 3;

/** Ultimate's input buffer: an early press still fires when it becomes legal. */
export const BUFFER_FRAMES = 9;

/**
 * A direction pressed within this many frames of the attack button makes the
 * attack a smash rather than a tilt. Ultimate resolves this from stick velocity;
 * on a keyboard, a fresh key edge is the only "the stick just moved" signal
 * available, so the window becomes the whole mechanism. See DECISIONS D7.
 */
export const SMASH_INPUT_WINDOW = 5;

/**
 * How long an "up" press waits before it becomes a jump.
 *
 * On the Switch the stick jumps when you flick it up, and the same stick aims
 * every up-attack. A stick resolves that by *magnitude* — a gentle tilt is an
 * up-tilt, a flick is a jump — and a key has no magnitude, so a keyboard has to
 * resolve it by *time* instead: an up press that is followed by attack, special
 * or grab was an aimed attack, and one that stands alone was a jump.
 *
 * Which means the jump has to wait long enough to find out. Deliberately equal
 * to `SMASH_INPUT_WINDOW`, because that is exactly how long an up press stays
 * eligible to become an up-smash: a shorter wait would fire the jump first and
 * make up-smash unreachable from the arrow keys, and a longer one would delay
 * every jump for no further gain.
 *
 * Five frames is 83ms, which is felt. That is what the dedicated jump key is
 * for — it has no ambiguity to resolve, so it fires on the frame it is pressed.
 */
export const TAP_JUMP_FRAMES = SMASH_INPUT_WINDOW;

/** Frames a smash attack may be charged before it fires on its own. */
export const SMASH_CHARGE_MAX = 60;
/** Full charge multiplies damage by this much. */
export const SMASH_CHARGE_DAMAGE = fx(1.4);

/* ---------------------------------------------------------------- dodges -- */

/*
 * The spot dodge and the rolls are each fighter's own (Plan 3 final wave):
 * `FighterAttributes.groundDodge`, from UltimateFrameData, read by
 * `groundDodge.ts`.
 */
/*
 * Air dodges (Plan 3, Task 20c). Each fighter's lengths and intangibility are
 * its own (`FighterAttributes.airDodge`); what follows is shared by the whole
 * roster. Sources:
 *
 * - P: fudgepop01/amiibo_research `fighter_param_motion.xml` @523374aa,
 *   https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/fighter_param_motion.xml.
 *   Cited at Mario's entry (L5-116); the other seven fighters' entries carry
 *   the same values for every param below.
 * - C: the same repo's `common.xml` @523374aa,
 *   https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/common.xml.
 * - W: SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge.
 */

/** A neutral air dodge's landing lag: C L117 `landing_frame_escape_air` 10; W "10 frames, down from 21". */
export const AIR_DODGE_LANDING_LAG = 10;
/**
 * A directional air dodge's landing lag runs from 19 at its earliest landing
 * down to 10 at its latest: SmashWiki "Lucario (SSBU)/Air dodge"
 * (https://www.ssbwiki.com/Lucario_(SSBU)/Air_dodge): "If Lucario lands the
 * earliest it can ... Lucario suffers the maximum 19 frames. Landing later
 * suffers less, and can be as little as 10 frames." Bracketed by P L42-43
 * (`landing_frame_escape_air_slide_max` 20, `landing_frame_escape_air_slide`
 * 10) and W ("ranging from 11 to 19 frames"). UNVERIFIED: the schedule between
 * the ends (`directionalLandingLag`).
 */
export const DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX = 19;
export const DIRECTIONAL_AIR_DODGE_LANDING_LAG_MIN = 10;
/**
 * The slingshot: first a shift of 7 units back, against the dodge's direction,
 * over its first 4 frames (P L33 `escape_air_slide_back_distance` 7, L34
 * `escape_air_slide_back_end_frame` 4; W: "characters first shift a small
 * distance towards the opposite direction in a slingshot fashion"). They are
 * the dodge's frames 1-4, `actionFrame` 0-3 (`airDodge.ts`: `actionFrame` N is
 * frame N + 1), and the slide starts on frame 5. UNVERIFIED, the sources
 * disagree: SmashWiki "Lucario (SSBU)/Air dodge" has the shift "during frames
 * 1-5 before moving toward stage starting frame 6", one frame more than P's 4.
 */
export const AIR_DODGE_SLINGSHOT_DISTANCE = fx(7);
export const AIR_DODGE_SLINGSHOT_FRAMES = 4;
/**
 * The slingshot's shape: the cubic Bezier through 0.5, 0.8, 0.9, 1.0 (in
 * tenths here), sampled at the back frames' 0, 1/3, 2/3 and 1, each frame
 * moving by the curve's step times the distance. UNVERIFIED: that is the
 * commented-out back phase of WuBor Patch `escape_air.rs` L343-366
 * (`sv_math::bezier_curve(0.5, 0.8, 0.9, 1.0, result)` over `back_end_frame - 1`,
 * https://github.com/WuBoytH/The-WuBor-Patch/blob/9d5e5cf90d7d686f5ab367a92789019c05574dec/fighters/common/src/status/escape/escape_air.rs#L343-L366),
 * apparently the vanilla code it replaced, started from 0: 3.5, 1.69, 1.06 and
 * 0.75 units back, 7 in all.
 */
export const AIR_DODGE_SLINGSHOT_CURVE = [5, 8, 9, 10] as const;
/**
 * The slide: from 4.2 a frame down to 1.3, covering 20 units (P L35
 * `escape_air_slide_speed` 4.2, L39 `escape_air_slide_end_speed` 1.3, L36
 * `escape_air_slide_distance` 20; W "Directional air dodge distance":
 * "Everyone else | 20"). UNVERIFIED: the curve between the ends, which the
 * game's STOP-energy reset (`ENERGY_STOP_RESET_TYPE_ESCAPE_AIR_SLIDE`) holds and
 * nothing publishes; the replica brakes it by a constant (`airDodgeSlideStep`).
 */
export const AIR_DODGE_SLIDE_SPEED = fx(4.2);
export const AIR_DODGE_SLIDE_END_SPEED = fx(1.3);
export const AIR_DODGE_SLIDE_DISTANCE = fx(20);
/**
 * Landing in a directional air dodge slides at no more than 2 a frame: C L119
 * `escape_air_slide_landing_speed_max` 2 (the waveland's slide).
 */
export const AIR_DODGE_LANDING_SLIDE_MAX = fx(2);
/**
 * No ledge is grabbed in a directional air dodge's first 24 frames: W "all
 * characters can grab edges after the first 24 frames of their directional air
 * dodge" (SmashWiki "Lucario (SSBU)/Air dodge": "all directional air dodges
 * grab ledge on frame 25"). The first grab is on `actionFrame` 24, the dodge's
 * frame 25 (`airDodge.ts`: `actionFrame` N is frame N + 1).
 */
export const AIR_DODGE_LEDGE_FRAMES = 24;

/* ------------------------------------------------------------------ tech -- */

/**
 * Teching (SmashWiki "Tech", https://www.ssbwiki.com/Tech): a shield press opens
 * an 11-frame window ("8 frames and 11 frames" in Smash 4 and Ultimate), and
 * no new window opens for 40 frames after a press ("a player won't be able to
 * tech for 40 frames", the page's general rule; it gives no separate Ultimate
 * figure).
 *
 * UNVERIFIED boundary: SmashWiki "Lucario (SSBU)/Techs"
 * (https://www.ssbwiki.com/Lucario_(SSBU)/Techs) says the window "is slightly
 * increased to 12 frames", and the vanilla param `passive_trigger_frame` is 12
 * (fudgepop01/amiibo_research `common.xml` L301,
 * https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/common.xml#L301).
 * That may be an inclusive/exclusive count of the same 11; the replica counts
 * the press frame and the 10 after it (`updateTechInput`).
 */
export const TECH_WINDOW = 11;
export const TECH_LOCKOUT = 40;
/**
 * A surface can be teched only at a launch speed of 3 or less (floor) or 6 or
 * less (wall, ceiling); a tumbling fighter bounces off at 0.8 or more (floor)
 * or 1 or more (wall, ceiling). rubendal SSBU-Calculator `js/knockback.js`
 * (`techable`, L79-80 and L148-149, and the bounce check, L133-134:
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/knockback.js#L133-L149);
 * the vanilla params `damage_fly_reflect_d_speed` 0.8 (`common.xml` L364) and
 * `damage_fly_reflect_speed` 1 (L360) agree on the bounce thresholds.
 *
 * UNVERIFIED boundary: rubendal tests `<= 6`, so a launch of exactly 6 techs a
 * wall; SmashWiki "Tech" says "a current launch speed of 6 or higher" cannot
 * (and the param `invalid_passive_speed` is 6, `common.xml` L307). The replica
 * follows rubendal. The floor's 3 is rubendal's alone (SmashWiki only says
 * ground techs are "much smaller"); a fighter tumbling after its hitstun
 * (`tumbleFall`) keeps the same cap, UNVERIFIED, since its launch is nearly spent.
 */
export const TECH_FLOOR_MAX_SPEED = fx(3);
export const TECH_SURFACE_MAX_SPEED = fx(6);
export const BOUNCE_FLOOR_MIN_SPEED = fx(0.8);
export const BOUNCE_SURFACE_MIN_SPEED = fx(1);
/**
 * A bounce keeps 0.9 of the launch off a floor and 0.95 off a wall or ceiling:
 * the vanilla params `damage_fly_reflect_d_speed_mul` 0.9 (L365) and
 * `damage_fly_reflect_speed_mul` 0.95 (L361) in the fudgepop01/amiibo_research
 * dump,
 * https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/common.xml#L356-L374
 * (names from https://github.com/ultimate-research/param-labels). rubendal's
 * `applyDecaySpeedUp` splits them the same way (`lsr` 0.95, 0.9 on a floor:
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/knockback.js#L69-L74;
 * only the copy inside its bounce branch, where `lsr` is 1, is commented out).
 * SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback) gives "5% in
 * Ultimate", the wall and ceiling figure.
 */
export const BOUNCE_FLOOR_LAUNCH_RATIO: Ratio = [9, 10];
export const BOUNCE_SURFACE_LAUNCH_RATIO: Ratio = [19, 20];
/**
 * A bounce keeps 0.8 of the hitstun left: SmashWiki "Hitstun"
 * (https://www.ssbwiki.com/Hitstun: Ultimate keeps Smash 4's bounce reduction,
 * "0.8× relative to the initial amount") and the vanilla param
 * `damage_fly_reflect_reaction_frame_mul` 0.8 (`common.xml` L366). Applied to
 * what is left, UNVERIFIED.
 */
export const BOUNCE_HITSTUN_RATIO: Ratio = [4, 5];
/**
 * An air dodge begun out of a tumble that meets a surface in its first 15
 * frames is a tech (`actionFrame` 0-14: the dodge's starting frame is its frame
 * 1, `actionFrame` 0, as it already moves and collides, so 0-14 are the first
 * 15; `airDodge.ts` counts every air-dodge rule so): SmashWiki "Lucario (SSBU)/Techs" ("neutral and directional
 * air dodges can be used for every form of teching during the first 15
 * frames", "After 16 frames ... no longer able to tech against surfaces") and
 * the vanilla param `air_escape_passive_trigger_frame` 15 (`common.xml` L306).
 * UNVERIFIED: that it is only an air dodge out of a tumble (the hitstun cancel
 * or `tumbleFall`). The pages read as if any air dodge within 15 frames could,
 * but SmashWiki "Air dodge" (https://www.ssbwiki.com/Air_dodge) says wavelanding
 * is still possible in Ultimate, so an ordinary air dodge keeps its landing lag.
 */
export const AIR_DODGE_TECH_FRAMES = 15;
/**
 * Tech animations, from SmashWiki "Lucario (SSBU)/Techs"
 * (https://www.ssbwiki.com/Lucario_(SSBU)/Techs) — the one fighter with
 * published tech frame data; used for all eight (UNVERIFIED per fighter):
 * in place 26 frames (the page's first actionable frame is 27), roll 40
 * (actionable 41), wall 26 (actionable from 6), ceiling 26; intangible on
 * frames 1–20 (ceiling 1–17).
 */
export const TECH_FRAMES = 26;
export const TECH_ROLL_FRAMES = 40;
export const TECH_WALL_FRAMES = 26;
export const TECH_WALL_INTERRUPT = 6;
/**
 * A wall tech holds on the wall for 5 frames before gravity takes it: the vanilla
 * param `passive_wall_stop_frame` 5 (`common.xml` L305). UNVERIFIED as applied
 * (the param's use is not published; it is read as a hold). The ceiling tech
 * falls at once: the dump has no ceiling counterpart.
 */
export const TECH_WALL_HOLD = 5;
export const TECH_CEILING_FRAMES = 26;
export const TECH_INTANGIBLE = [1, 20] as const;
export const TECH_CEILING_INTANGIBLE = [1, 17] as const;
/** How far a tech roll travels. UNVERIFIED: the ground roll's distance stands in. */
export const TECH_ROLL_DISTANCE = fx(28);

/* ----------------------------------------------------------------- ledge -- */

/**
 * Ledge intangibility = floor(60 * (airTime / 300) + 64 - (percent / 120) * 44),
 * bounded to [24, 124]. SmashWiki gives the constant as 44, but that is
 * arithmetically inconsistent with the 23-123 range it states on the same page;
 * Kurogane Hammer's 64 reproduces its own stated 24-124 range exactly, so that
 * is what is implemented here. Recorded in DECISIONS D5.
 */
export const LEDGE_INTANGIBILITY_BASE = 64;
export const LEDGE_AIRTIME_CAP = 300;
export const LEDGE_PERCENT_CAP = fx(120);
export const LEDGE_PERCENT_PENALTY = 44;
export const LEDGE_INTANGIBILITY_MIN = 24;
export const LEDGE_INTANGIBILITY_MAX = 124;

/** Ledge grabs before the fighter is forced to get up. Reset by taking a hit. */
export const LEDGE_REGRAB_LIMIT = 6;
/** Intangibility multiplier after the 1st and 2nd regrab; zero from the 3rd. */
export const LEDGE_REGRAB_SCALING = [fx(1), fx(0.8), fx(0.5), fx(0)] as const;

/**
 * Frames after letting go of a ledge (a drop by down or away) or being hit or
 * grabbed off one during which the fighter cannot grab ANY ledge (a trump sets
 * `LEDGE_TRUMPED_FRAMES` + 1 instead). Counts down every frame,
 * and landing clears it. Without it the wall that pushes a dropped body clear
 * of the stage (the ECB) puts it straight back inside the grab box on the same
 * frame, and a ledge drop regrabs forever.
 *
 * Sources, none of them for Ultimate:
 * - Melee's "Disabled Regrab Period" starts at 29 frames "as soon as they drop
 *   from the ledge" (SmashWiki Ledgestall, https://www.ssbwiki.com/Ledgestall).
 * - Smash 4 stops a fighter who was hit from grabbing a ledge for 55 frames
 *   (SmashWiki Edge, https://www.ssbwiki.com/Edge). That is the "roughly 55"
 *   of the forum thread, and it is about being hit, not about a drop.
 * - SmashWiki Edge's Ultimate sections (regrab penalties, the 6-grab limit)
 *   give no delay after a release, and rubendal's data has no cliff param.
 *
 * UNVERIFIED: the value, 29 (Melee's, the only published drop figure), for
 * Ultimate; that Ultimate has such a lockout at all; and that it covers every
 * ledge rather than only the one released (no source says either way, and
 * lockout-all is the simpler rule). The window it has to sit in, measured with
 * the `simulate.test.ts` fighter (gravity 0.087, fall speed 1.5, air jump 2.85):
 * at least about 12 frames, so a drop falls out of the 6-unit grab box and does
 * not just regrab a few frames later; at most 43, past which a fighter who waits
 * the lockout out has fallen too far for one double jump to reach back (the
 * lockout tests there pass at 43 and fail at 44).
 */
export const LEDGE_REGRAB_LOCKOUT_FRAMES = 29;

/**
 * How long a fighter whose ledge was taken from under it (ledge trump) cannot
 * act: SmashWiki "Ledge trump" (https://www.ssbwiki.com/Ledge_trump) says it
 * "cannot take any action for a moment" and publishes no frame count.
 * UNVERIFIED: 30. `ledgeLockout` keeps it off every ledge for all of it, the
 * last frame included (`trumpLedge` sets it one higher, as it counts down from
 * the next frame), so that it cannot take the ledge straight back.
 */
export const LEDGE_TRUMPED_FRAMES = 30;

/** How far from a ledge a fighter may be and still grab it. Fixed. */
export const LEDGE_GRAB_RANGE_X = fx(3.2);
export const LEDGE_GRAB_RANGE_Y = fx(6);
/** Grabbing a ledge from behind reaches 40% less far. */
export const LEDGE_GRAB_BACK_PENALTY = fx(0.6);

/**
 * Upward velocity of a ledge jump. UNVERIFIED: no published source is cited for
 * this value. It lives here rather than beside the ledge-option frame counts in
 * `states.ts` because `kinetic.ts` replays it (`jumpRiseSpeeds`, for the
 * renderer) and `kinetic.ts` cannot import `states.ts`, which imports it.
 */
export const LEDGE_JUMP_VELOCITY = fx(3.1);

/* ------------------------------------------------------------------- misc -- */

/** The respawn platform vanishes on its own after this long. */
export const RESPAWN_PLATFORM_FRAMES = 300;
/** Minimum invincibility on leaving it — granted if you waited the full time. */
export const RESPAWN_INVINCIBILITY_MIN = 60;
export const RESPAWN_INVINCIBILITY_MAX = 180;

/** Smash Ball: 40 HP, decaying 2 every 60 frames on its own. */
export const SMASH_BALL_HEALTH = fx(40);
export const SMASH_BALL_DECAY = fx(2);
export const SMASH_BALL_DECAY_INTERVAL = 60;
export const SMASH_BALL_SPAWN_INTERVAL = 900;
/** Frames the winner glows in standby before the Final Smash must be used. */
export const FINAL_SMASH_STANDBY = 600;

/** Sudden death starts everyone here. */
export const SUDDEN_DEATH_DAMAGE = fx(300);

/** Damage taken per second while off-screen inside the magnifying glass. */
export const OFFSCREEN_DAMAGE_PER_SECOND = fx(1);
export const OFFSCREEN_DAMAGE_CEILING = fx(150);

/**
 * DI can deviate the launch angle by at most 0.17 rad (9.74°), and a launch
 * within 0.17 rad of straight ahead cannot be DI'd. SmashWiki "Directional
 * influence"; rubendal SSBU-Calculator `parameters.di = 0.17`.
 */
export const DI_MAX_DEVIATION = fx(9.74);
/** Raw stick dead zone and full-throw value for DI/LSI (rubendal `StickSensibility`). */
export const DI_STICK_DEAD_ZONE = 24;
export const DI_STICK_FULL = 120;
/**
 * How much a soft stick (`Btn.Soft`) shortens DI, as a right shift: a quarter.
 *
 * DI is linear in the stick's perpendicular component (applyDI), so a quarter of
 * the bend is a stick at a quarter of its throw.
 * UNVERIFIED: the quarter-throw reading is tuned, not sourced — the bitfield
 * carries one bit of magnitude where the real game reads the analog value.
 */
export const SOFT_DI_SHIFT = 2;
/** Holding up or down at launch scales launch speed. */
export const LSI_UP = fx(1.095);
export const LSI_DOWN = fx(0.92);
/** LSI does nothing on near-vertical launches. */
export const LSI_DEAD_ZONE = [fx(65), fx(115)] as const;

/** SDI moves the victim this far per input pulse, at most one per 4 frames. */
export const SDI_DISTANCE = fx(2);
export const SDI_INPUT_INTERVAL = 4;

/**
 * "For every five consecutive hits a character takes, the SDI distance for the
 * next five hits is increased by 1.15×" (SmashWiki "Smash directional
 * influence"). UNVERIFIED: whether the increase compounds past the tenth hit is
 * not published; here it does not: ×1.15 from the sixth hit on.
 */
export const SDI_COMBO_HITS = 5;
export const SDI_COMBO_RATIO: Ratio = [23, 20];
/**
 * Automatic SDI: on the last frame of hitlag from an electric or paralyzing
 * hit that does not launch between 70° and 110°, the victim shifts toward the
 * held stick (SmashWiki "Smash directional influence", Ultimate).
 * 1.33 units: the page gives Smash 4's as "1.33 units with ASDI (down from 3)",
 * and of Ultimate says "SDI retains its shorter distance from Smash 4" (Plan 3
 * final wave; the Task 11 ruling). UNVERIFIED: Ultimate's exact distance, which
 * the page does not state for ASDI. It also says ASDI "now applies twice against
 * moves with these effects", which is not modelled.
 */
export const ASDI_DISTANCE = fx(1.33);
export const ASDI_VERTICAL = [fx(70), fx(110)] as const;
