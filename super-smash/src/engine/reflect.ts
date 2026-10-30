/**
 * Reflectors (Plan 5, Task 3): Fox's Reflector and Mario's Cape.
 *
 * A reflector is a bubble a move raises for a span of frames. A reflectable
 * projectile that touches it changes hands: it belongs to the reflector's
 * owner from then on, flies back the way it came, faster and harder by the
 * move's multipliers, with its life renewed by the lifetime multiplier and its
 * hit record cleared so it can hit the fighter who threw it. SmashWiki
 * "Reflect" (https://www.ssbwiki.com/Reflect): "Reflected projectiles also
 * change ownership from the original user to the reflector"; a projectile can
 * be reflected at most seven times; a projectile past the reflector's damage
 * threshold is not reflected and hits instead.
 *
 * Only the owner changes hands. `ProjectileState.source`, the fighter whose
 * moveset defines the projectile, stays the spawner's: it is still that
 * fighter's fireball or laser, and `step()` looks its definition up there.
 *
 * Everything here mutates the projectile and the reflector's fighter only, so
 * it rolls back with them.
 */

import { ONE, mul } from "./fixed";
import { circle, moveFrameOf, sweptCapsulePenetration } from "./hitbox";
import type { Capsule } from "./hitbox";
import { kineticSetX, kineticSetY } from "./kinetic";
import { fighterParams } from "./params";
import type { Intent, StateContext } from "./states";
import type { FighterDef, FighterState, GameState, ProjectileDef, ProjectileState, ReflectorDef, StepEvents } from "./types";

/** SmashWiki "Reflect": "projectiles can only be reflected up to 7 times before disappearing." */
export const MAX_REFLECTIONS = 7;

/** The reflector this fighter has up this frame, if any. */
export function activeReflector(f: FighterState, def: FighterDef): ReflectorDef | null {
  if (f.move === null || (f.action !== "special" && f.action !== "attack")) return null;
  const r = def.moves[f.move]?.reflector;
  if (r === undefined) return null;
  const g = moveFrameOf(f.actionFrame);
  return g >= r.active[0] && g <= r.active[1] ? r : null;
}

/** Where the bubble is: `r.y` above the fighter's origin, `r.x` in front. */
export function reflectorBubble(f: FighterState, r: ReflectorDef): Capsule {
  return circle(f.x + (f.facing >= 0 ? r.x : -r.x), f.y + r.y, r.radius);
}

/**
 * The projectile as the reflector sends it back. Pure in the projectile's
 * fields; `source` is left alone (see the file header).
 */
export function reflectProjectile(p: ProjectileState, def: ProjectileDef, by: FighterState, r: ReflectorDef): void {
  p.owner = by.port;
  p.vx = -mul(p.vx, r.speed);
  p.facing = -p.facing;
  p.chargeScale = mul(p.chargeScale, r.damage);
  // Lifetime ×m: it has `lifetime · m` frames left from here. UNVERIFIED
  // reading of SmashWiki's "Lifetime multiplier" — it renews the clock.
  p.age = def.lifetime - Math.trunc((def.lifetime * r.lifetime) / ONE);
  p.hitPorts.length = 0;
  p.returning = false;
  p.reflected += 1;
}

export interface ReflectCandidate {
  readonly projectile: ProjectileState | null;
  readonly hitbox: { readonly radius: number; readonly damage: number };
  readonly x: number;
  readonly y: number;
  readonly prevX: number;
  readonly prevY: number;
  suppressed: boolean;
}

/**
 * Phase 6a: every projectile that touches a raised reflector is reflected
 * before anything clanks or hits. Fighters are tried in port order, so two
 * reflectors meeting one projectile resolve the same way on both peers.
 */
export function reflectProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  projectileDef: (p: ProjectileState) => ProjectileDef | undefined,
  candidates: ReflectCandidate[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  for (const c of candidates) {
    const p = c.projectile;
    if (p === null || c.suppressed || destroyed.has(p.instanceId)) continue;
    const def = projectileDef(p);
    if (def === undefined || def.reflectable !== true) continue;
    for (let i = 0; i < s.fighters.length; i++) {
      const f = s.fighters[i];
      if (i === p.owner || f.action === "dead") continue;
      const r = activeReflector(f, defs[i]);
      if (r === null) continue;
      if (sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, 0, 0, c.hitbox.radius, reflectorBubble(f, r)) < 0) continue;
      // Past the threshold the projectile goes through and hits (SmashWiki:
      // "Damage threshold 50%"; "the projectile just passes through the
      // reflector and damages Fox normally").
      if (mul(c.hitbox.damage, p.chargeScale) > r.maxDamage) continue;
      c.suppressed = true;
      if (p.reflected >= MAX_REFLECTIONS) {
        destroyed.add(p.instanceId);
      } else {
        reflectProjectile(p, def, f, r);
        // Fox's reflector stays up at least 20 frames after a reflection.
        f.combat.reflectHold = r.holdAfterReflect;
        events.reflects.push({ port: f.port, x: p.x, y: p.y });
      }
      break;
    }
  }
}

/**
 * The reflector's own status logic, run from the special status's `main`.
 * Returns true when it consumed the frame.
 *
 * - **Loop** (`r.loop`, Fox): the reflecting frames repeat while B is held or
 *   a reflection's minimum period runs. After one full pass, letting go skips
 *   to the end (SmashWiki "Fox (SSBU)/Down special": "After one full loop,
 *   releasing the button at any point causes the move to transition into the
 *   ending portion"). `FighterState.charge` counts the passes, as it counts a
 *   smash's charge.
 * - **Turn** (`r.turnFrom`): holding back turns the fighter round from that
 *   frame of the reflecting frames.
 */
export function reflectorMain(f: FighterState, intent: Intent, r: ReflectorDef): boolean {
  if (f.combat.reflectHold > 0) f.combat.reflectHold -= 1;
  const g = moveFrameOf(f.actionFrame);
  if (r.turnFrom !== undefined && g >= r.turnFrom && g <= r.active[1] && intent.x === -f.facing) {
    f.facing = -f.facing;
  }
  if (r.loop === undefined) return false;
  const [from, to] = r.loop;
  const holding = intent.specialHeld || f.combat.reflectHold > 0;
  if (g === to + 1 && holding) {
    // Back to the first reflecting frame (actionFrame is game frame − 1).
    f.actionFrame = from - 1;
    f.charge += 1;
    return true;
  }
  if (f.charge >= 1 && !holding && g >= from && g <= to) {
    f.actionFrame = to;
    return true;
  }
  return false;
}

/**
 * The once-per-airtime stall (Fox: SmashWiki "Fox (SSBU)", "Reflector now only
 * stalls Fox's momentum out once", "he can only do it once until he lands or
 * gets hit"; "Fox (SSBU)/Down special", "Horizontal speed multiplier on startup
 * 0.5", "Period before applying gravity 4 frames", "Gravity 0.027"). Run as the
 * special status's `exec`, after the FALL kinetic type has applied ordinary
 * gravity. `CombatState.specialStall` says the airtime's stall is spent.
 */
export function reflectorStallExec(f: FighterState, ctx: StateContext, r: ReflectorDef): void {
  const stall = r.stall;
  if (stall === undefined || f.grounded) return;
  const g = moveFrameOf(f.actionFrame);
  if (g === 1) {
    if (f.combat.specialStall) return;
    f.combat.specialStall = true;
    f.combat.stalling = true;
    kineticSetX(f, mul(f.vx, stall.startX));
  }
  if (!f.combat.stalling) return;
  if (g <= stall.noGravityFrames) {
    kineticSetY(f, 0);
    return;
  }
  // Undo the fighter's own gravity for this frame and apply the move's instead.
  const p = fighterParams(ctx.def);
  const terminal = -p.air_speed_y_stable;
  if (f.vy > terminal) kineticSetY(f, Math.max(terminal, f.vy + p.air_accel_y - stall.gravity));
}
