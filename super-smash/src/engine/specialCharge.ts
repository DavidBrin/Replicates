/**
 * Specials that charge (Plan 5, Task 2): Hero's Bow, Shield Breaker, Hammer
 * Flip and Skull Bash charge while B is held; Charge Shot, Giant Punch and
 * F.L.U.D.D. loop until B is pressed again and can be put away for later.
 *
 * The charge is `FighterState.charge` (frames), as a smash's is; the loop is
 * the move's `actionFrame` held on its loop frame, so nothing new is cloned or
 * hashed except the stored charge (`CombatState.storedCharge`).
 */

import { ONE, mul } from "./fixed";
import { airJump, startAction, startAirDodge } from "./states";
import type { Intent, StateContext } from "./states";
import type { ChargedHitbox, FighterState, Hitbox, PartialCharge, SpecialCharge } from "./types";

function lerp(a: number, b: number | undefined, t: number): number {
  return b === undefined ? a : a + Math.trunc(((b - a) * t) / ONE);
}

/** Rounded down to a whole percent (Q12). */
function wholePercent(v: number): number {
  return Math.floor(v / ONE) * ONE;
}

const LINEAR: PartialCharge = { kind: "lerp" };

/**
 * A hitbox at a charge of `t` (Q12, `ONE` = full). Below full it grows as the
 * move's `partial` rule says (`PartialCharge`: SmashWiki's per-move charge
 * formulas); at full the `full` values replace the authored ones outright
 * ("When fully charged, the hitboxes are instead changed directly"), angle
 * included. The angle never sweeps between — UNVERIFIED: SmashWiki publishes
 * no angle formula for a charge.
 */
export function chargedHitbox(hb: Hitbox, full: ChargedHitbox | undefined, t: number, partial: PartialCharge = LINEAR): Hitbox {
  if (t <= 0) return hb;
  if (t >= ONE) {
    if (full === undefined) return partial.kind === "lerp" ? hb : { ...hb, damage: partialDamage(hb.damage, ONE, partial) };
    return {
      ...hb,
      damage: full.damage ?? hb.damage,
      baseKnockback: full.baseKnockback ?? hb.baseKnockback,
      knockbackGrowth: full.knockbackGrowth ?? hb.knockbackGrowth,
      radius: full.radius ?? hb.radius,
      angle: full.angle ?? hb.angle,
    };
  }
  if (partial.kind !== "lerp") return { ...hb, damage: partialDamage(hb.damage, t, partial) };
  if (full === undefined) return hb;
  const damage = lerp(hb.damage, full.damage, t);
  return {
    ...hb,
    damage: partial.floor === true ? wholePercent(damage) : damage,
    baseKnockback: lerp(hb.baseKnockback, full.baseKnockback, t),
    knockbackGrowth: lerp(hb.knockbackGrowth, full.knockbackGrowth, t),
    radius: lerp(hb.radius, full.radius, t),
  };
}

function partialDamage(base: number, t: number, partial: Exclude<PartialCharge, { kind: "lerp" }>): number {
  if (partial.kind === "multiply") return mul(base, ONE + mul(partial.by, t));
  const damage = base + mul(partial.total, t);
  return partial.floor === true ? wholePercent(damage) : damage;
}

/**
 * Run one frame of a charging special's loop. Returns true when it consumed
 * the frame (the caller's ordinary move logic must not run).
 *
 * `loopFrame` is quoted as a game frame (SmashWiki "Charges between a–b"), so
 * the move holds on `actionFrame = loopFrame − 1` and the loop is re-entered
 * each time the frame advances onto `loopFrame`. Released, the move simply
 * carries on past it and never comes back.
 */
export function specialChargeMain(f: FighterState, intent: Intent, ctx: StateContext, sc: SpecialCharge): boolean {
  if (f.actionFrame !== sc.loopFrame) return false;

  if (sc.mode === "hold") {
    if (!intent.specialHeld || f.charge >= sc.frames) return false;
    f.actionFrame = sc.loopFrame - 1;
    f.charge += 1;
    return true;
  }

  // Store mode: B fires; shield or jump puts the charge away; a full charge
  // puts itself away (UNVERIFIED: that it auto-stores — SmashWiki's tables give
  // the charge time and the cancels, not what happens at full).
  if (intent.specialPressed) return false;
  if (intent.shieldPressed) {
    storeCharge(f);
    if (f.grounded) startAction(f, "shieldStart");
    else if (!startAirDodge(f, intent)) startAction(f, "fall");
    return true;
  }
  if (intent.jumpPressed) {
    storeCharge(f);
    if (f.grounded) startAction(f, "jumpSquat");
    else if (!airJump(f, ctx)) startAction(f, "fall");
    return true;
  }
  if (f.charge >= sc.frames) {
    storeCharge(f);
    startAction(f, f.grounded ? "stand" : "fall");
    return true;
  }
  f.actionFrame = sc.loopFrame - 1;
  f.charge += 1;
  return true;
}

function storeCharge(f: FighterState): void {
  f.combat.storedCharge = f.charge;
}
