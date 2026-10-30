/**
 * Counters (Plan 5, Task 5): Marth's Counter.
 *
 * A counter is a window of frames in which being hit is the point. Whatever
 * reaches its bubble — a swing or a projectile — does nothing to the fighter;
 * the fighter freezes for the counter's hitlag, a melee attacker with them, and
 * then swings back with a strike whose damage is the caught attack's × the
 * counter's multiplier, never below its minimum nor above its maximum.
 *
 * SmashWiki "Marth (SSBU)/Down special"
 * (https://www.ssbwiki.com/Marth_(SSBU)/Down_special): "Counter 6-27"; "The
 * move's true base damage is equal to 1.2× of the countered attack's damage,
 * with a minimum of 8% and a maximum of 50%"; "Upon countering an attack, Marth
 * immediately transitions to the first frame of this state, in which he freezes
 * for 21 frames alongside the opponent before the counterattack proceeds";
 * "Counter hitlag on activation 21 frames"; "Counter bubble size 10.5u",
 * "Counter bubble offsets [0, 10, 0]".
 *
 * SmashWiki "Counterattack" (https://www.ssbwiki.com/Counterattack): a grab "is
 * immune to counterattacks", and "Counterattacks also do not trigger if the
 * fighter is invincible, even if the opponent hits them". A countered
 * projectile is consumed: Corrin's is "the only counterattack that avoids
 * attacks instead of negating them; thus, single-hit projectiles will not
 * shatter upon contact", so every other counter's do. Its thrower, not a party
 * to the contact, is not frozen, as for any projectile hit.
 *
 * Everything here mutates the countering fighter (and, in `step()`, the
 * attacker's hitlag) only, so it rolls back with them.
 */

import { clamp, mul } from "./fixed";
import { circle, moveFrameOf } from "./hitbox";
import type { Capsule } from "./hitbox";
import { startMove } from "./states";
import type { CounterDef, FighterDef, FighterState } from "./types";

/**
 * The counter this fighter has out this frame, if any: a special whose move
 * holds one, on a frame of its window. Not while invincible (SmashWiki
 * "Counterattack": counters "do not trigger if the fighter is invincible"), so
 * a hit on an invincible counter takes the invincible path. UNVERIFIED: that
 * intangibility does not stop it — the bubble is not a hurtbox, and the page's
 * own frames overlap ("Intangibility 5-6", "Counter 6-27").
 */
export function activeCounter(f: FighterState, def: FighterDef): CounterDef | null {
  if (f.move === null || f.action !== "special" || f.invincible > 0) return null;
  const c = def.moves[f.move]?.counter;
  if (c === undefined) return null;
  const g = moveFrameOf(f.actionFrame);
  return g >= c.active[0] && g <= c.active[1] ? c : null;
}

/** Where the counter's bubble is: `c.y` above the fighter's origin, `c.x` in front. */
export function counterBubble(f: FighterState, c: CounterDef): Capsule {
  return circle(f.x + (f.facing >= 0 ? c.x : -c.x), f.y + c.y, c.radius);
}

/** The counterattack's damage for a caught hit of `damage` (Q12). */
export function counterDamage(c: CounterDef, damage: number): number {
  return clamp(mul(damage, c.multiplier), c.minDamage, c.maxDamage);
}

/**
 * The counter connects with a hit of `caught` damage: `f` starts its
 * counterattack (`c.then`) on its first frame, frozen there for the counter's
 * hitlag. Returns the freeze, which `step()` gives a melee attacker too.
 *
 * The counterattack's own intangibility, when it starts on frame 1 (Marth's
 * "Intangibility 1-8"), holds through the freeze: the freeze is spent on that
 * frame. The fighter keeps facing the way it faced. UNVERIFIED: no source says
 * a counter turns to an attacker behind it (SmashWiki's "a turnaround Counter
 * can be used" for an attacker that ends up behind says it does not).
 */
export function triggerCounter(f: FighterState, def: FighterDef, c: CounterDef, caught: number): number {
  startMove(f, "special", c.then);
  f.combat.counterDamage = counterDamage(c, caught);
  f.hitlag = c.freeze;
  const w = def.moves[c.then]?.intangible;
  if (w !== undefined && w[0] <= 1) f.intangible = Math.max(f.intangible, c.freeze + 1);
  return c.freeze;
}
