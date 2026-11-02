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
import { airJump, peekBuffer, startAction, startAirDodge, startRoll } from "./states";
import type { Intent, StateContext } from "./states";
import type { ChargedHitbox, FighterState, Hitbox, HoldCharge, PartialCharge, SpecialCharge, StoreCharge } from "./types";

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
  return sc.mode === "hold" ? holdMain(f, intent, sc) : storeMain(f, intent, ctx, sc);
}

/**
 * Hold mode: the charge grows while B is held and fires when it comes up. At
 * full, a move that "Automatically activates at full charge" fires (Shield
 * Breaker, Skull Bash: `atFull` `"release"`); one that "Can be held
 * indefinitely" stays there until B comes up (Hero's Bow, Hammer Flip:
 * `"hold"`; SmashWiki "Charge", https://www.ssbwiki.com/Charge), or until its
 * maximum hold runs out (the bow's 180). `charge` keeps counting past full
 * while it is held, which is what times the maximum and the recoil; everything
 * that reads it as a charge clamps it to full (`chargeFraction`).
 */
function holdMain(f: FighterState, intent: Intent, sc: HoldCharge): boolean {
  if (!intent.specialHeld) return false;
  if (f.charge >= sc.frames && sc.atFull === "release") return false;
  if (sc.maxHold !== undefined && f.charge >= sc.maxHold) return false;
  f.actionFrame = sc.loopFrame - 1;
  f.charge += 1;
  const r = sc.recoil;
  if (r !== undefined && f.charge > sc.frames && (f.charge - sc.frames) % r.every === 0 && f.damage < r.below) {
    f.damage += r.damage;
  }
  return true;
}

/**
 * Store mode, on the loop frame:
 * - a full charge brought back out of storage fires (Charge Shot plays its
 *   entry frames first; Giant Punch never comes here: `beginSpecial` starts it
 *   on the loop frame, `StoredFullCharge.start`);
 * - B fires: pressed on this frame, or during the entry frames and still in
 *   the 9-frame buffer (`bufferPress`; UNVERIFIED that Ultimate buffers a
 *   second press inside this status, but it buffers presses everywhere else);
 * - a shield, roll, spot dodge, jump or air dodge puts the charge away
 *   (`storeInto`);
 * - otherwise the charge grows, and on the frame it fills it puts itself away
 *   and the fighter stands (or falls): SmashWiki "Charge" calls both moves
 *   "auto-charge" specials, which "automatically cancel and store the charge
 *   upon being fully charged"; "Charge Shot" (https://www.ssbwiki.com/Charge_Shot):
 *   "Samus will stop charging and resume her neutral standing position".
 *
 * Published, not modelled: the 4 frames of lag a charge cancel takes before the
 * chosen action (SmashWiki "Samus (SSBU)/Neutral special" and "Donkey Kong
 * (SSBU)/Neutral special": "Charge-canceling the move incurs 4 frames of lag
 * before the selected action"), the same 4 frames after a charge fills
 * (SmashWiki "Giant Punch", https://www.ssbwiki.com/Giant_Punch: "121 frames,
 * including the 7 frame pre-charge lag and 4 frame post-charge lag"), and a
 * grab press: "Charge Shot" lists it among the cancels in its overview of every
 * game, but no source says what follows it in Ultimate.
 */
function storeMain(f: FighterState, intent: Intent, ctx: StateContext, sc: StoreCharge): boolean {
  if (f.charge >= sc.frames) return false;
  if (intent.specialPressed || takeBufferedSpecial(f, ctx.frame)) return false;
  if (intent.shieldPressed || intent.jumpPressed) {
    storeInto(f, intent, ctx);
    return true;
  }
  f.actionFrame = sc.loopFrame - 1;
  f.charge += 1;
  if (f.charge >= sc.frames) {
    f.combat.storedCharge = f.charge;
    startAction(f, f.grounded ? "stand" : "fall");
  }
  return true;
}

/**
 * Put the charge away, into whatever the shield or jump press asks for.
 *
 * On the ground: a shield press is a shield, a spot dodge with down held, a
 * roll with a side held. Each move's page publishes one of the two dodges:
 * SmashWiki "Charge Shot": in Ultimate "she can cancel the charge with a jump or
 * spotdodge", and the move list's "Can keep the charge after dodging or
 * shielding"; "Giant Punch": "shielding, rolling or jumping". That both moves
 * take both is the replica's inference, from the one shield press. A jump
 * press is a jump. In the air: a jump press is a midair jump ("Giant Punch":
 * "It can also be cancelled through jumping in the air"), and a shield press is
 * an air dodge, UNVERIFIED for Ultimate: SmashWiki "Charge storage cancel"
 * (https://www.ssbwiki.com/Charge_storage_cancel) has the shield press in the
 * air buffer an air dodge in Brawl and Smash 4, and for Ultimate says only that
 * the cancel "can still be performed in the air ... by landing before the
 * charge cancel animation can be completed". UNVERIFIED: with the air dodge or
 * the midair jump already spent, the charge is still put away and the fighter
 * falls.
 */
function storeInto(f: FighterState, intent: Intent, ctx: StateContext): void {
  f.combat.storedCharge = f.charge;
  if (intent.shieldPressed) {
    if (!f.grounded) {
      if (!startAirDodge(f, intent)) startAction(f, "fall");
    } else if (intent.y < 0) startAction(f, "spotDodge");
    else if (intent.x !== 0) startRoll(f, intent.x, ctx);
    else startAction(f, "shieldStart");
    return;
  }
  if (f.grounded) startAction(f, "jumpSquat");
  else if (!airJump(f, ctx)) startAction(f, "fall");
}

/** A B press made in the entry frames, still in the buffer: taken, so it fires once. */
function takeBufferedSpecial(f: FighterState, frame: number): boolean {
  if (peekBuffer(f, frame) !== "special") return false;
  f.bufferedAction = null;
  return true;
}
