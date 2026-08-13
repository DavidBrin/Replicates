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

/** A hit causing this much hitstun or more puts the victim into tumble. */
export const TUMBLE_HITSTUN = 32;

/** Launch speed starts at this fraction of knockback and decays per frame. */
export const LAUNCH_SPEED_RATIO = fx(0.03);
export const LAUNCH_SPEED_DECAY = fx(0.051);

/** Above this knockback, hitstun grows by (kb - 200) * 0.25 instead. */
export const LAUNCH_SPEED_CAP_KB = fx(200);
export const HITSTUN_OVERFLOW_RATIO: Ratio = [1, 4];

/** Vertical launches (70°-110°) get a fixed fall speed — "balloon knockback". */
export const BALLOON_ANGLE_MIN = fx(70);
export const BALLOON_ANGLE_MAX = fx(110);
export const BALLOON_FALL_SPEED = fx(1.8);

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
/** What the Sakurai angle resolves to, grounded and airborne. */
export const SAKURAI_GROUNDED = fx(0);
export const SAKURAI_AIRBORNE = fx(44);

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

/** shieldstun = floor(0.8 * damage * typeMult * moveMult * projMult + 2). */
export const SHIELDSTUN_RATIO: Ratio = [4, 5];
export const SHIELDSTUN_ADDEND = fx(2);
export const SHIELDSTUN_SMASH: Ratio = [29, 40];
export const SHIELDSTUN_AERIAL: Ratio = [33, 100];
export const SHIELDSTUN_PROJECTILE: Ratio = [29, 100];
/** Ultimate is the only game in the series that caps shieldstun. */
export const SHIELDSTUN_CAP = 60;

/** Frames of stun on a shield break, before the mash-out reduction. */
export const SHIELD_BREAK_STUN = 240;

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

export const SPOT_DODGE_FRAMES = 24;
export const SPOT_DODGE_INTANGIBLE = [3, 20] as const;
export const ROLL_FRAMES = 31;
export const ROLL_INTANGIBLE = [4, 20] as const;
export const AIR_DODGE_FRAMES = 50;
export const AIR_DODGE_INTANGIBLE = [3, 28] as const;
export const AIR_DODGE_LANDING_LAG = 10;
/**
 * A directional air dodge is punished for landing in it, and heavily.
 *
 * Nearly double the neutral dodge's lag, which is what stops Ultimate's
 * directional air dodge from being a free approach: it is the descendant of the
 * wavedash and it costs. Both were 10 here, which made the directional dodge
 * strictly better than the neutral one — more distance, same recovery.
 */
export const DIRECTIONAL_AIR_DODGE_LANDING_LAG = 19;
export const DIRECTIONAL_AIR_DODGE_FRAMES = 63;
export const DIRECTIONAL_AIR_DODGE_INTANGIBLE = [3, 20] as const;
export const DIRECTIONAL_AIR_DODGE_SPEED = fx(3.2);

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

/** How far from a ledge a fighter may be and still grab it. Fixed. */
export const LEDGE_GRAB_RANGE_X = fx(3.2);
export const LEDGE_GRAB_RANGE_Y = fx(6);
/** Grabbing a ledge from behind reaches 40% less far. */
export const LEDGE_GRAB_BACK_PENALTY = fx(0.6);

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

/** DI can deviate the launch angle by at most this much. */
export const DI_MAX_DEVIATION = fx(9.74);
/** Holding up or down at launch scales launch speed. */
export const LSI_UP = fx(1.095);
export const LSI_DOWN = fx(0.92);
/** LSI does nothing on near-vertical launches. */
export const LSI_DEAD_ZONE = [fx(65), fx(115)] as const;

/** SDI moves the victim this far per input pulse, at most one per 4 frames. */
export const SDI_DISTANCE = fx(2);
export const SDI_INPUT_INTERVAL = 4;
