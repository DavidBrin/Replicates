/**
 * The knockback pipeline — the arithmetic that decides whether a hit kills.
 *
 * Every function here is pure and takes fixed-point in, fixed-point out, because
 * these are the numbers rollback compares: two peers that disagree by one unit
 * on a launch angle disagree about who won the game forty frames later. The
 * formulas are Ultimate's own, transcribed from `research/physics-and-knockback.md`
 * and SPEC §4 rather than tuned by feel, and each is its own exported function so
 * a worked example from the research can be pointed at exactly one of them.
 *
 * The order the game applies them in is: damage lands and raises the victim's
 * percent → knockback is computed from the *new* percent → hitstun and launch
 * speed are derived from that knockback → the victim's stick bends the angle (DI)
 * and scales the speed (LSI). Nothing downstream feeds back upstream, which is
 * why each step can be tested alone.
 */

import { ONE, fx, mul, clamp, byRatio, byRatios, sinDeg, cosDeg } from "./fixed";
import type { Ratio } from "./fixed";
import {
  KB_MULTIPLIER,
  KB_ADDEND,
  HITSTUN_RATIO,
  LAUNCH_SPEED_CAP_KB,
  LAUNCH_SPEED_RATIO,
  HITSTUN_OVERFLOW_RATIO,
  RAGE_START,
  RAGE_CAP,
  RAGE_MAX_BONUS,
  HITLAG_RATIO,
  HITLAG_ADDEND,
  HITLAG_CAP,
  HITLAG_ELECTRIC,
  HITLAG_SHIELDING,
  HITLAG_CROUCH_CANCEL,
  TUMBLE_HITSTUN,
  SHIELDSTUN_RATIO,
  SHIELDSTUN_ADDEND,
  SHIELDSTUN_SMASH,
  SHIELDSTUN_AERIAL,
  SHIELDSTUN_PROJECTILE,
  SHIELDSTUN_CAP,
  SAKURAI_ANGLE,
  SAKURAI_GROUNDED,
  SAKURAI_AIRBORNE,
  STALE_QUEUE_LENGTH,
  STALE_KNOCKBACK_DAMPING,
  DI_MAX_DEVIATION,
  LSI_UP,
  LSI_DOWN,
  LSI_DEAD_ZONE,
  BALLOON_ANGLE_MIN,
  BALLOON_ANGLE_MAX,
} from "./constants";
import type { Hitbox, MoveSlot } from "./types";

/* --------------------------------------------------------------- helpers -- */

/**
 * `(a·b)/c` for three fixed-point values, truncating exactly once.
 *
 * Chaining `mul` then `div` truncates twice, and the second truncation is applied
 * to an already-rounded number — over the five multiplications the knockback
 * formula performs that compounds into visible drift against the worked examples.
 * The intermediate product peaks around 2^45 for the magnitudes this game uses,
 * comfortably inside a double's exact-integer range.
 */
function mulDiv(a: number, b: number, c: number): number {
  return Math.trunc((a * b) / c);
}

const TEN = fx(10);
const TWENTY = fx(20);
const TWO_HUNDRED = fx(200);
const HUNDRED = fx(100);
/** 150 − 35: the percent span over which rage ramps from 1.0 to 1.1. */
const RAGE_SPAN = RAGE_CAP - RAGE_START;
/** A crouching victim takes 0.85× knockback. SPEC §4. Exact: see `Ratio`. */
export const CROUCH_CANCEL_MULTIPLIER: Ratio = [17, 20];
/** A meteor that connects with a grounded victim is cut to 0.8×. SPEC §4. */
export const GROUNDED_METEOR_MULTIPLIER: Ratio = [4, 5];
/** Full turn, in fixed degrees. */
export const TURN = fx(360);

/** Fold an angle into [0, 360). Fixed degrees in, fixed degrees out. */
export function normalizeAngle(angleFx: number): number {
  const a = angleFx % TURN;
  return a < 0 ? a + TURN : a;
}

/**
 * Reflect an attacker-relative angle into world space.
 *
 * Hitbox angles are authored as "degrees counter-clockwise from directly in front
 * of the attacker" (types.ts), so a fighter facing left launches its victim along
 * the mirror image: cos flips sign, sin does not.
 */
export function toWorldAngle(angleFx: number, facing: number): number {
  return facing >= 0 ? normalizeAngle(angleFx) : normalizeAngle(fx(180) - angleFx);
}

/* ------------------------------------------------------------- knockback -- */

export interface KnockbackArgs {
  /**
   * The formula's `p`: the victim's percent **after** this hit's damage has been
   * applied. Ultimate raises damage first and launches from the new number, which
   * is why a 0% victim of a 19.6% hit is launched as though at 19.6%.
   */
  readonly percent: number;
  /** Damage this hitbox deals, fixed. Already staled/charged by the caller. */
  readonly damage: number;
  /**
   * Ultimate's weight stat as a plain integer — Mario 98, Bowser 135. Not fixed:
   * it is a whole number in the game's own data and staying integral keeps
   * `(w + 100) · ONE` exact. Weight-independent moves pass 100, which makes the
   * `200/(w+100)` term exactly 1.
   */
  readonly weight: number;
  readonly baseKnockback: number;
  readonly knockbackGrowth: number;
  /** Rage multiplier from `computeRage`. Defaults to 1. */
  readonly rage?: number;
  readonly crouchCancel?: boolean;
  /** A meteor that hit a grounded opponent, which Ultimate cuts to 0.8×. */
  readonly groundedMeteor?: boolean;
  /** Knockback is a flat value: percent, weight and rage do not enter. */
  readonly setKnockback?: boolean;
}

/**
 * `KB = ((((p/10 + p·d/20) · (200/(w+100)) · 1.4) + 18) · s) + b`
 *
 * Worked, from the research (Mario up smash: 19.6 damage, BKB 32, KBG 94):
 * against Bowser at 0% this is 72.63, against Jigglypuff 82.08, and against
 * Bowser at 60% it is 145.20. Those three numbers are the test for this function.
 *
 * Returns knockback *units*, in fixed-point. They are not pixels: `LAUNCH_SPEED_RATIO`
 * turns them into a velocity and `HITSTUN_RATIO` turns them into frames.
 */
export function computeKnockback(args: KnockbackArgs): number {
  const rage = args.rage ?? ONE;

  // "Set knockback is now immovable" — Ultimate removed *every* knockback
  // modifier from a set-knockback hitbox, not merely the percent-derived ones.
  // Rage, weight and the victim's percent are the obvious three; crouch cancel
  // and the grounded-meteor penalty are the two that are easy to leave applied
  // and would turn an authored 60 into 51 against a crouching victim.
  // research/physics-and-knockback.md §1.
  if (args.setKnockback) {
    const kb = args.baseKnockback;
    return kb < 0 ? 0 : kb;
  }

  const percentTerm =
    mulDiv(args.percent, ONE, TEN) + mulDiv(args.percent, args.damage, TWENTY);
  const weightTerm = mulDiv(TWO_HUNDRED, ONE, (args.weight + 100) * ONE);
  let kb = byRatio(mulDiv(percentTerm, weightTerm, ONE), KB_MULTIPLIER) + KB_ADDEND;
  kb = mulDiv(kb, args.knockbackGrowth, HUNDRED) + args.baseKnockback;
  kb = mulDiv(kb, rage, ONE);

  if (args.crouchCancel) kb = byRatio(kb, CROUCH_CANCEL_MULTIPLIER);
  if (args.groundedMeteor) kb = byRatio(kb, GROUNDED_METEOR_MULTIPLIER);
  return kb < 0 ? 0 : kb;
}

/**
 * `hitstun = floor(KB × 0.4) − 1`, with Ultimate's shallower slope above 200.
 *
 * The subtracted frame is Ultimate's own change and is the reason combos are
 * tighter than in Smash 4. Past 200 knockback the victim is dying anyway, so the
 * game stops paying out the full 0.4 frames per unit and grows at 0.25 instead —
 * without that, a 400-unit launch would freeze the victim for over two seconds
 * of screen time they cannot influence.
 */
export function computeHitstun(kb: number): number {
  let stunFx: number;
  if (kb <= LAUNCH_SPEED_CAP_KB) {
    stunFx = byRatio(kb, HITSTUN_RATIO);
  } else {
    stunFx =
      byRatio(LAUNCH_SPEED_CAP_KB, HITSTUN_RATIO) +
      byRatio(kb - LAUNCH_SPEED_CAP_KB, HITSTUN_OVERFLOW_RATIO);
  }
  const frames = Math.floor(stunFx / ONE) - 1;
  return frames < 0 ? 0 : frames;
}

/**
 * Is this hit heavy enough for LSI to do anything?
 *
 * "LSI … does nothing to knockback that does not cause tumble"
 * (research/physics-and-knockback.md §6), and tumble is the 32-hitstun-frame
 * threshold rather than a knockback number. So a jab cannot be made to launch
 * 1.095× further by holding up: the mechanic exists to let a victim survive a
 * kill move, and a hit that does not tumble is not one.
 */
export function lsiApplies(hitstunFrames: number): boolean {
  return hitstunFrames >= TUMBLE_HITSTUN;
}

/**
 * `rage = 1 + ((percent − 35)/115) × 0.1`, flat below 35% and capped at 1.1×.
 *
 * Rage is the comeback mechanic: the fighter who is losing launches harder. It
 * multiplies the attacker's *own* knockback output based on the attacker's
 * percent, never the victim's, and never applies to set-knockback moves.
 */
export function computeRage(attackerPercent: number): number {
  if (attackerPercent <= RAGE_START) return ONE;
  const p = clamp(attackerPercent, RAGE_START, RAGE_CAP);
  return ONE + mulDiv(p - RAGE_START, RAGE_MAX_BONUS, RAGE_SPAN);
}

export interface HitlagOptions {
  readonly electric?: boolean;
  readonly shielding?: boolean;
  /**
   * The victim was crouching. Cuts the freeze to 0.67× — and the caller must
   * apply the same number to the attacker, because crouch cancel shortens the
   * exchange for *both* fighters rather than only for the one who crouched.
   */
  readonly crouchCancel?: boolean;
  /** Per-move scaling from `Hitbox.hitlagMultiplier`. */
  readonly moveMultiplier?: number;
}

/**
 * `hitlag = floor((damage × 0.65 + 6) × electric × shielding × crouchCancel)`,
 * capped at 30.
 *
 * Both fighters freeze for these frames — it is the crunch that sells the hit,
 * and it is also the window in which the victim mashes SDI. Electric hits freeze
 * 1.5× longer (Pikachu's whole game plan), hitting a shield only 0.67×, and a
 * crouching victim 0.67× as well.
 *
 * The 0.65 is applied as 13/20 rather than through `fx()` because the result is
 * floored to a frame; see `Ratio`. `moveMultiplier` stays a Q12 value because it
 * comes from authored hitbox data rather than from a formula constant.
 */
export function computeHitlag(damage: number, opts: HitlagOptions = {}): number {
  /*
   * `floor( floor( (d × 0.65 + 6) × move × electric × shielding ) × crouchCancel )`
   *
   * Two floors, not one, and that is the published shape rather than a rounding
   * convenience: the game works in whole frames, so crouch cancel scales a frame
   * count that has already been rounded. Shieldstun, by contrast, floors exactly
   * once — the two formulas are not the same shape and must not share a helper.
   *
   * Everything up to the first floor is carried as one exact numerator over one
   * exact denominator, so `0.65` never becomes 0.64990 and the `+ 6` is not
   * added to an already-truncated value. Worst-case magnitudes here are around
   * 1e13 against a 2^53 exact-integer ceiling.
   */
  let num = damage * HITLAG_RATIO[0] + HITLAG_ADDEND * HITLAG_RATIO[1];
  let den = HITLAG_RATIO[1];

  const ratios: Ratio[] = [];
  if (opts.moveMultiplier !== undefined) ratios.push([opts.moveMultiplier, ONE]);
  if (opts.electric) ratios.push(HITLAG_ELECTRIC);
  if (opts.shielding) ratios.push(HITLAG_SHIELDING);
  for (const [n, d] of ratios) {
    num *= n;
    den *= d;
  }

  let frames = Math.floor(num / (den * ONE));
  if (opts.crouchCancel) {
    frames = Math.floor((frames * HITLAG_CROUCH_CANCEL[0]) / HITLAG_CROUCH_CANCEL[1]);
  }
  return clamp(frames, 0, HITLAG_CAP);
}

export interface ShieldstunOptions {
  readonly smash?: boolean;
  readonly aerial?: boolean;
  readonly projectile?: boolean;
  /** Per-move scaling from `Hitbox.shieldstunMultiplier`. */
  readonly moveMultiplier?: number;
}

/**
 * `shieldstun = floor(0.8 × damage × type × move × projectile + 2)`, capped at 60.
 *
 * The type term is what makes shield pressure a real decision in Ultimate: an
 * aerial is 0.33× and therefore nearly always punishable out of shield, a smash
 * is 0.725×, and a projectile takes a further 0.29× on top because a zoner should
 * not be able to freeze a shield from across the stage.
 */
export function computeShieldstun(damage: number, opts: ShieldstunOptions = {}): number {
  // Every multiplier is gathered first and applied as a single exact rational,
  // because the formula has exactly **one** floor and truncating between the
  // multipliers can cross it. A per-multiplier `byRatio` chain reports 6 frames
  // where the formula gives 7 for a twice-stale charged Marth down smash — and
  // one frame is the difference between punishable on shield and safe.
  const ratios: Ratio[] = [SHIELDSTUN_RATIO];
  if (opts.smash) ratios.push(SHIELDSTUN_SMASH);
  else if (opts.aerial) ratios.push(SHIELDSTUN_AERIAL);
  // A per-move multiplier arrives as fixed-point rather than as a ratio, so it
  // joins the product as `m / ONE` and stays inside the same single truncation.
  if (opts.moveMultiplier !== undefined) ratios.push([opts.moveMultiplier, ONE]);
  if (opts.projectile) ratios.push(SHIELDSTUN_PROJECTILE);

  const v = byRatios(damage, ratios) + SHIELDSTUN_ADDEND;
  const frames = Math.floor(v / ONE);
  return clamp(frames, 0, SHIELDSTUN_CAP);
}

/* ------------------------------------------------------------ staleness -- */

/**
 * How much each of the nine queue slots takes off a repeated move.
 *
 * Index 0 is the move used most recently, and it costs the most: 9% of the
 * move's damage, tapering to 1% for the one that is about to fall off the end.
 * Spam every slot with the same move and you land 45% below fresh.
 */
const STALE_SLOT_REDUCTION = [
  fx(0.09),
  fx(0.08),
  fx(0.07),
  fx(0.06),
  fx(0.05),
  fx(0.04),
  fx(0.03),
  fx(0.02),
  fx(0.01),
] as const;

/**
 * A move absent from the queue entirely deals 105%, not 100%.
 *
 * The freshness bonus is why mixing up your kill options is worth doing rather
 * than merely not-harmful: rotating moves is a live 1.05× on the one you finally
 * commit to.
 */
export const STALE_FRESH_BONUS = fx(1.05);

export interface Staleness {
  /** Multiplier applied to the move's damage. */
  readonly damage: number;
  /** Multiplier applied to the damage figure fed into the knockback formula. */
  readonly knockback: number;
}

/**
 * Ultimate's nine-slot staleness queue, and the reason its combos stay real.
 *
 * Damage takes the full reduction, but knockback is computed from a damage value
 * only 30% staled (`STALE_KNOCKBACK_DAMPING`). That single constant is the
 * difference between Ultimate and Brawl: a stale move still kills at roughly the
 * percent it always killed at, so a fighter's kill confirm does not evaporate
 * because they used it twice in neutral.
 *
 * `queue[0]` is the most recently landed move.
 */
export function computeStaleness(queue: readonly MoveSlot[], slot: MoveSlot): Staleness {
  let reduction = 0;
  const n = Math.min(queue.length, STALE_QUEUE_LENGTH);
  for (let i = 0; i < n; i++) {
    if (queue[i] === slot) reduction += STALE_SLOT_REDUCTION[i];
  }
  const damage = STALE_FRESH_BONUS - reduction;
  const knockback = ONE + mulDiv(damage - ONE, STALE_KNOCKBACK_DAMPING, ONE);
  return { damage, knockback };
}

/* ------------------------------------------------------------------- DI -- */

/** 1/√2, for the diagonal of a digital stick. Authoring-time constant. */
const DIAGONAL = fx(0.7071067811865476);

/** Unit vector for a digital direction pair, in fixed-point. */
function unitStick(sx: number, sy: number): { x: number; y: number } {
  if (sx === 0 && sy === 0) return { x: 0, y: 0 };
  if (sx === 0) return { x: 0, y: sy > 0 ? ONE : -ONE };
  if (sy === 0) return { x: sx > 0 ? ONE : -ONE, y: 0 };
  return { x: sx > 0 ? DIAGONAL : -DIAGONAL, y: sy > 0 ? DIAGONAL : -DIAGONAL };
}

/**
 * Directional Influence: bend the launch angle by up to 9.74° toward perpendicular.
 *
 * The lever is the component of the stick *perpendicular* to the launch — pushing
 * along the launch direction does nothing at all, pushing square to it does
 * everything — and the game squares that component before scaling, so DI falls
 * off quickly as you drift off perpendicular. This is the single defensive
 * mechanic that decides whether a hit at 120% kills, so it has to be exact.
 *
 * `angleFx` and the stick must be in the same frame of reference; the simulation
 * mirrors the stick by the attacker's facing and works in attacker-relative space
 * throughout, so the result can be handed straight to `knockbackToVelocity`.
 */
export function applyDI(angleFx: number, stickX: number, stickY: number): number {
  if (stickX === 0 && stickY === 0) return angleFx;
  const u = unitStick(stickX, stickY);
  // Cross product of the launch direction with the stick: the signed sine of the
  // angle between them, which is exactly the perpendicular component.
  const perp = mul(cosDeg(angleFx), u.y) - mul(sinDeg(angleFx), u.x);
  const deviation = mul(DI_MAX_DEVIATION, mul(perp, perp));
  return angleFx + (perp >= 0 ? deviation : -deviation);
}

/**
 * Launch Speed Influence: holding up or down at launch scales the speed, not the angle.
 *
 * Up is 1.095× and down 0.92×, which is why survival DI on a horizontal launch is
 * "away and down" rather than just "away". Near-vertical launches are exempt —
 * the 65°–115° dead zone, and its downward mirror — because otherwise every
 * up-throw kill would be decided by whether the victim happened to be holding
 * down, which is not a decision anybody could make in three frames.
 */
export function applyLSI(launchSpeed: number, stickY: number, angleFx: number): number {
  if (stickY === 0) return launchSpeed;
  const a = normalizeAngle(angleFx);
  const inUpDeadZone = a >= LSI_DEAD_ZONE[0] && a <= LSI_DEAD_ZONE[1];
  const inDownDeadZone = a >= TURN - LSI_DEAD_ZONE[1] && a <= TURN - LSI_DEAD_ZONE[0];
  if (inUpDeadZone || inDownDeadZone) return launchSpeed;
  return mul(launchSpeed, stickY > 0 ? LSI_UP : LSI_DOWN);
}

/* --------------------------------------------------------------- launch -- */

/**
 * Resolve the Sakurai angle (361) against the victim's situation.
 *
 * 361 is not a direction, it is an instruction: launch a grounded victim flat
 * along the ground so they slide and can be followed up, and a airborne one at
 * 44° so they are actually sent somewhere. Jab and most tilts use it, which is
 * why the same move combos on the ground and edgeguards in the air.
 */
export function resolveAngle(hitbox: Pick<Hitbox, "angle">, victimGrounded: boolean): number {
  if (hitbox.angle === SAKURAI_ANGLE) {
    return victimGrounded ? SAKURAI_GROUNDED : SAKURAI_AIRBORNE;
  }
  return hitbox.angle;
}

export interface LaunchVector {
  readonly vx: number;
  readonly vy: number;
  /** Magnitude, kept separately because hitstun decays it by a flat amount. */
  readonly speed: number;
  /** The launch was near-vertical, so the victim falls at a fixed 1.8. */
  readonly balloon: boolean;
}

/**
 * Turn knockback units into a velocity, at 0.03 units of speed per unit of knockback.
 *
 * `angleFx` is attacker-relative, so `facing` mirrors the horizontal component —
 * a 45° hitbox launches up-right from a fighter facing right and up-left from one
 * facing left, and no fighter data has to be authored twice.
 *
 * A launch between 70° and 110° is "balloon knockback": Ultimate replaces the
 * victim's gravity with a flat 1.8 fall speed on the way down, which is what
 * makes a vertical launch hang at the top of the screen instead of snapping back.
 * The classification happens **here, once, from the launch angle**, and is then
 * carried on the victim for the length of the hitstun — re-deriving it each frame
 * from the current velocity would let gravity and launch decay rotate a shallow
 * trajectory into the cone halfway through the flight and flip it to balloon fall
 * mid-hitstun, which is not a thing the real game does. See `FighterState.balloon`.
 */
export function knockbackToVelocity(kb: number, angleFx: number, facing: number): LaunchVector {
  const speed = mul(kb, LAUNCH_SPEED_RATIO);
  const a = normalizeAngle(angleFx);
  const balloon = a >= BALLOON_ANGLE_MIN && a <= BALLOON_ANGLE_MAX;
  return {
    vx: mul(speed, cosDeg(a)) * (facing >= 0 ? 1 : -1),
    vy: mul(speed, sinDeg(a)),
    speed,
    balloon,
  };
}
