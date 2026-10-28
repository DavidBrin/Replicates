/**
 * Shield numbers (Plan 3, Task 9): what a hit costs a shield, how big the
 * shield is, how far both fighters slide apart, and how long a break stuns.
 *
 * Pure functions on Q12 values, like `knockback.ts`, so each published number
 * is pinned by exactly one test in `shield.test.ts`.
 */

import type { CombatState } from "./combat";
import {
  PARRY_MELEE_DIRECT,
  PARRY_MELEE_INDIRECT,
  PARRY_PROJECTILE_DIRECT,
  PARRY_PROJECTILE_INDIRECT,
  SHIELD_ATTACKER_PUSHBACK_ADD,
  SHIELD_ATTACKER_PUSHBACK_RATIO,
  SHIELD_BREAK_STUN_BASE,
  SHIELD_DAMAGE_RATIO,
  SHIELD_MAX_HEALTH,
  SHIELD_PUSHBACK_MAX,
  SHIELD_PUSHBACK_RATIO,
  SHIELD_SIZE_MIN,
} from "./constants";
import { ONE, byRatio, mul } from "./fixed";
import type { Capsule } from "./hitbox";
import { circle } from "./hitbox";
import { fighterParams } from "./params";
import type { FighterDef, FighterState } from "./types";

/** What a hit of `damage` takes off a shield: ×1.19 (SmashWiki "Shield", Ultimate). */
export function shieldDamage(damage: number): number {
  return byRatio(damage, SHIELD_DAMAGE_RATIO);
}

/**
 * The shield's size as a fraction of its full radius, Q12:
 * `(HP / 50) × 0.85 + 0.15` (SmashWiki "Shield"). A worn shield leaves the
 * body uncovered — a shield poke.
 */
export function shieldScale(health: number): number {
  const hp = health < 0 ? 0 : health > SHIELD_MAX_HEALTH ? SHIELD_MAX_HEALTH : health;
  return SHIELD_SIZE_MIN + Math.trunc(((ONE - SHIELD_SIZE_MIN) * hp) / SHIELD_MAX_HEALTH);
}

/**
 * How far a shielding defender slides, Q12 units a frame:
 * `min((shieldstun + 1) × 0.09, 1.3)` on the shieldstun *before* rounding,
 * Q12 (`shieldstunExact`) — SmashWiki "Shield" (pushback table); rubendal
 * SSBU-Calculator `ShieldPushback`.
 */
export function shieldPushback(shieldstun: number): number {
  const push = byRatio(shieldstun + ONE, SHIELD_PUSHBACK_RATIO);
  return push > SHIELD_PUSHBACK_MAX ? SHIELD_PUSHBACK_MAX : push;
}

/** How far a melee attacker slides off a shield: `0.04 × damage + 0.025` (rubendal `AttackerShieldPushback`). */
export function attackerShieldPushback(damage: number): number {
  return byRatio(damage, SHIELD_ATTACKER_PUSHBACK_RATIO) + SHIELD_ATTACKER_PUSHBACK_ADD;
}

/**
 * Shield-break stun in frames: `400 − p`, none at 400% or more
 * (SmashWiki "Stun", https://www.ssbwiki.com/Stun: "From Brawl onward, the
 * formula is changed to 400 − p"). `percent` is Q12.
 */
export function shieldBreakStun(percent: number): number {
  const frames = Math.floor((SHIELD_BREAK_STUN_BASE * ONE - percent) / ONE);
  return frames < 0 ? 0 : frames;
}

/**
 * Whole frames a mash takes off a struggle this frame: `buttons` presses at
 * `perButton` and `sticks` at `perStick`, both in **tenths of a frame** so the
 * published 5.4 and 14.4 stay exact, with the remainder carried in
 * `CombatState.mash`.
 */
export function mashFrames(c: CombatState, buttons: number, sticks: number, perButton: number, perStick: number): number {
  c.mash += buttons * perButton + sticks * perStick;
  const whole = Math.trunc(c.mash / 10);
  c.mash -= whole * 10;
  return whole;
}

/**
 * The shield bubble: `shield_radius` (calculator `ShieldSize`) × the fighter's
 * `scale` × `shieldScale(health)`, centred half-way up the body. The centre is
 * UNVERIFIED — the game hangs the shield on a bone, which Plan 4's bake will
 * provide; until then the middle of the hurtbox stands in for it.
 */
export function shieldBubble(f: Pick<FighterState, "x" | "y" | "shieldHealth">, def: FighterDef): Capsule {
  const p = fighterParams(def);
  const r = mul(mul(p.shield_radius, p.scale), shieldScale(f.shieldHealth));
  return circle(f.x, f.y + Math.trunc(def.attributes.height / 2), r);
}

/**
 * Hitlag on a perfect shield (SmashWiki "Perfect shield",
 * https://www.ssbwiki.com/Perfect_shield, Ultimate): on top of the hit's
 * shield hitlag `lag` (`computeHitlag(…, { shielding: true })`), a direct melee hit freezes the attacker 14 more frames
 * and the defender 11; an indirect melee hit 14 and 2; a projectile freezes its
 * thrower not at all and the defender 8 more (direct) or 1 fewer (indirect).
 */
export function perfectShieldHitlag(
  lag: number,
  projectile: boolean,
  direct: boolean,
): { attacker: number; defender: number } {
  const [a, d] = projectile
    ? direct
      ? PARRY_PROJECTILE_DIRECT
      : PARRY_PROJECTILE_INDIRECT
    : direct
      ? PARRY_MELEE_DIRECT
      : PARRY_MELEE_INDIRECT;
  const attacker = projectile ? 0 : lag + a;
  const defender = lag + d;
  return { attacker: attacker < 0 ? 0 : attacker, defender: defender < 0 ? 0 : defender };
}
