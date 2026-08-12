/**
 * The roster registry.
 *
 * Eight fighters chosen to span the archetype space (SPEC §7), so that the
 * physics engine is exercised rather than merely exercised *once*: a
 * heavyweight and a featherweight, a zoner and a rushdown, a multi-jumper and
 * a fast-faller. If a formula only works for Mario, one of the other seven will
 * say so.
 *
 * ── how to read the data in this directory ────────────────────────────────
 *
 * **Provenance.** Attributes come from SmashWiki's per-fighter stats tables.
 * Startup, active frames, FAF and landing lag come from Ultimate Frame Data.
 * Angle, base knockback and knockback growth come from the game's own ACMD
 * scripts at patch 13.0.1 — **neither of the first two sites publishes them**,
 * a fact that catches out most attempts at this. Ultimate Frame Data's columns
 * are startup, total frames, landing lag, damage, shield lag, shield stun and
 * shield advantage; read carelessly, its shield lag and shield stun come back
 * wearing the names "base knockback" and "knockback growth" and every number is
 * wrong. Anything that could not be sourced carries an `UNVERIFIED:` comment
 * naming what is missing.
 *
 * **Units.** Every numeric field is Q12 fixed-point via `fx()`. Hitbox `x`/`y`
 * are facing-relative offsets from the fighter's origin (between the feet) in
 * the same units as the stage, so a fighter is about eleven units tall and
 * Battlefield is a hundred and sixty across.
 *
 * **Knockback.** `baseKnockback` and `knockbackGrowth` hold the game's raw
 * values — growth 99 means 99, and SPEC §4's formula divides it by 100. Where
 * `setKnockback` is true, `baseKnockback` holds the *fixed* knockback value
 * instead and percent, weight and rage are all ignored.
 *
 * **Angles.** 361 is the Sakurai angle (`SAKURAI_ANGLE`), which resolves
 * differently for grounded and airborne victims. 365 and 367 are autolink
 * angles, which drag a victim along with the attacker rather than launching
 * them — they appear on multi-hit moves and are what stops the victim falling
 * out between hits. 180 launches straight backwards, into the attacker.
 *
 * **Damage is base damage**, the four-player value. Ultimate's 1v1 bonus is a
 * property of the match, not of the move, and the engine applies
 * `ONE_ON_ONE_MULTIPLIER` on top. Storing pre-multiplied damage here would make
 * every four-player match wrong.
 */

import type { FighterDef, MoveSlot } from "@/engine/types";
import { donkeyKong } from "./donkeyKong";
import { fox } from "./fox";
import { kirby } from "./kirby";
import { link } from "./link";
import { mario } from "./mario";
import { marth } from "./marth";
import { pikachu } from "./pikachu";
import { samus } from "./samus";

export { donkeyKong } from "./donkeyKong";
export { fox } from "./fox";
export { kirby } from "./kirby";
export { link } from "./link";
export { mario } from "./mario";
export { marth } from "./marth";
export { pikachu } from "./pikachu";
export { samus } from "./samus";

/**
 * The roster, in fighter-number order — which is the order the character select
 * screen lays out, and the reason `number` exists on `FighterDef` at all.
 */
export const FIGHTERS: readonly FighterDef[] = [
  mario, // 01
  donkeyKong, // 02
  link, // 03
  samus, // 04
  kirby, // 06
  fox, // 07
  pikachu, // 10
  marth, // 13
];

const BY_ID: ReadonlyMap<string, FighterDef> = new Map(FIGHTERS.map((f) => [f.id, f]));

export function getFighter(id: string): FighterDef | undefined {
  return BY_ID.get(id);
}

/** Every fighter id, for the CSS grid and for tests that iterate the roster. */
export const FIGHTER_IDS: readonly string[] = FIGHTERS.map((f) => f.id);

/**
 * The move slots every fighter must fill.
 *
 * Deliberately *not* the whole `MoveSlot` union. `jab2`, `jab3` and `rapidJab`
 * are excluded because the jab is the one part of the universal moveset that
 * genuinely differs between fighters — Pikachu's is a single looping attack,
 * Marth's, Samus's and Donkey Kong's are two-hit strings, Kirby's and Fox's end
 * in a rapid jab. Requiring `jab3` of everyone would mean inventing one for
 * four of the eight, which is exactly the sort of quiet fabrication the data in
 * this directory is meant to avoid. `jab1` is required; what follows it is not.
 *
 * `ledgeAttack`, `getUpAttack` and `finalSmash` are universal animations the
 * engine supplies, not per-fighter data, so they are absent too.
 */
export const REQUIRED_SLOTS: readonly MoveSlot[] = [
  "jab1",
  "ftilt",
  "utilt",
  "dtilt",
  "dashAttack",
  "fsmash",
  "usmash",
  "dsmash",
  "nair",
  "fair",
  "bair",
  "uair",
  "dair",
  "neutralB",
  "sideB",
  "upB",
  "downB",
  "grab",
  "dashGrab",
  "pummel",
  "fthrow",
  "bthrow",
  "uthrow",
  "dthrow",
];

/** The five aerials, which are the slots that must declare `landingLag`. */
export const AERIAL_SLOTS: readonly MoveSlot[] = ["nair", "fair", "bair", "uair", "dair"];

/** Ultimate's real weight range, from Jigglypuff (62) to Bowser (135). */
export const MIN_WEIGHT = 62;
export const MAX_WEIGHT = 135;
