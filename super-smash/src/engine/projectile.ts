/**
 * Projectiles — the things a move launches that outlive it.
 *
 * A hitbox belongs to an animation and dies with it. That is the right model for
 * a punch and the wrong one for an arrow: Link is free to act a third of a second
 * before his arrow reaches the other side of Battlefield, and encoding the arrow
 * as a hitbox on his neutral-B forces a choice between freezing him for the whole
 * flight and deleting the arrow the moment he can move. Three of the eight
 * fighters are built on this — Link's bomb, boomerang and arrow, Samus's charge
 * shot, Pikachu's Thunder Jolt — so a projectile is its own entity with its own
 * position, its own lifetime and its own hit record.
 *
 * What it is *not* is a second combat system. A projectile that connects goes
 * through exactly the same damage, knockback, hitstun and DI path in `simulate.ts`
 * as a fist does; the only thing this file owns is where the projectile is and
 * whether it still exists.
 */

import { ONE, fx, abs, mul } from "./fixed";
import { SMASH_CHARGE_MAX } from "./constants";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "./physics";
import { chargedHitbox } from "./specialCharge";
import type {
  FighterDef,
  FighterState,
  Hitbox,
  MoveDef,
  ProjectileDef,
  ProjectileState,
  StageDef,
} from "./types";

/** How close a returning projectile must get to its owner to be caught. */
export const CATCH_RADIUS = fx(8);

/** Where on a fighter a returning projectile is caught — chest height, not feet. */
export const CATCH_HEIGHT = fx(6);

/**
 * Every projectile a fighter can produce, indexed by id.
 *
 * `ProjectileState` stores an id rather than a reference, for the same reason
 * `FighterState` stores a `defId`: state is cloned ten times a frame and hashed,
 * and a moveset does not belong in either. The map is derived from immutable
 * roster data, so caching it per `FighterDef` is safe and saves rebuilding it on
 * every frame of every projectile in flight.
 */
const defCache = new WeakMap<FighterDef, Map<string, ProjectileDef>>();

export function projectileDefs(def: FighterDef): Map<string, ProjectileDef> {
  const cached = defCache.get(def);
  if (cached !== undefined) return cached;
  const map = new Map<string, ProjectileDef>();
  for (const slot of Object.keys(def.moves) as (keyof typeof def.moves)[]) {
    const move = def.moves[slot];
    if (move?.projectiles === undefined) continue;
    for (const p of move.projectiles) map.set(p.id, p);
  }
  defCache.set(def, map);
  return map;
}

export function findProjectileDef(def: FighterDef, id: string): ProjectileDef | undefined {
  return projectileDefs(def).get(id);
}

/**
 * How much a held charge multiplies this projectile, over a charge of `frames`.
 *
 * One scalar applied to both damage and speed, for a projectile authored with
 * `chargeScaling`. Plan 5's charged specials (Charge Shot, the bow) carry a
 * full-charge variant instead (`ProjectileDef.charged`, `projectileHitbox`) and
 * scale by 1 here. Never below 1 — a mis-authored scaling makes a projectile no
 * weaker than its uncharged self rather than deleting it.
 */
export function projectileChargeScale(def: ProjectileDef, charge: number, frames: number = SMASH_CHARGE_MAX): number {
  if (def.chargeScaling === undefined || charge <= 0) return ONE;
  const held = Math.min(charge, frames);
  const scale = ONE + Math.trunc(((def.chargeScaling - ONE) * held) / frames);
  return scale < ONE ? ONE : scale;
}

/**
 * Launch one projectile from a fighter.
 *
 * `offsetX` and `vx` are facing-relative, exactly like a hitbox's offset, so the
 * roster authors one Fireball and it comes out of the correct hand in both
 * directions. `vy` is absolute: up is up whichever way you are looking.
 */
export function spawnProjectile(
  def: ProjectileDef,
  owner: FighterState,
  instanceId: number,
  source: string = owner.defId,
  chargeFrames: number = SMASH_CHARGE_MAX,
): ProjectileState {
  const facing = owner.facing >= 0 ? 1 : -1;
  const chargeScale = projectileChargeScale(def, owner.charge, chargeFrames);
  const charge = chargeFraction(owner.charge, chargeFrames);
  // A full-charge variant interpolates its speed (Plan 5); otherwise the
  // multiplier scales it, as it scales the damage.
  const vx = def.charged !== undefined ? def.vx + Math.trunc(((def.charged.vx - def.vx) * charge) / ONE) : mul(def.vx, chargeScale);
  const fullVy = def.charged?.vy;
  const vy = fullVy !== undefined ? def.vy + Math.trunc(((fullVy - def.vy) * charge) / ONE) : def.vy;
  return {
    instanceId,
    defId: def.id,
    owner: owner.port,
    x: owner.x + facing * def.offsetX,
    y: owner.y + def.offsetY,
    vx: facing * vx,
    vy,
    facing,
    age: 0,
    bouncesLeft: def.bounces ?? 0,
    chargeScale,
    hitPorts: [],
    returning: false,
    source,
    charge,
    reflected: 0,
  };
}

/** `charge` of `frames` as a Q12 fraction of a full charge, clamped to [0, ONE]. */
export function chargeFraction(charge: number, frames: number): number {
  if (charge <= 0 || frames <= 0) return 0;
  return Math.trunc((Math.min(charge, frames) * ONE) / frames);
}

/** The projectiles a move launches on this frame of its animation. */
export function projectilesDueOnFrame(move: MoveDef, moveFrame: number): readonly ProjectileDef[] {
  if (move.projectiles === undefined) return [];
  return move.projectiles.filter((p) => p.spawnFrame === moveFrame);
}

/** This projectile's hitbox, at the charge it was launched with (Plan 5). */
export function projectileHitbox(p: ProjectileState, def: ProjectileDef): Hitbox {
  return def.charged === undefined ? def.hitbox : chargedHitbox(def.hitbox, def.charged.hitbox, p.charge, def.charged.partial);
}

/** Is this projectile's hitbox live? Its frames are counted from the spawn. */
export function projectileHitboxActive(p: ProjectileState, def: ProjectileDef): boolean {
  return p.age >= def.hitbox.startFrame && p.age <= def.hitbox.endFrame;
}

export type ProjectileStep =
  | { readonly alive: true; readonly prevX: number; readonly prevY: number }
  | { readonly alive: false; readonly prevX: number; readonly prevY: number };

/**
 * Move a projectile one frame, and say whether it survived.
 *
 * The order is fixed and matters: age first (so `lifetime` is exact), then the
 * turn-around for a boomerang, then gravity and integration, then the catch, then
 * surfaces, then the blast zone. Bouncing after integrating means the bounce
 * responds to where the projectile actually went rather than where it was aimed.
 */
export function advanceProjectile(
  p: ProjectileState,
  def: ProjectileDef,
  stage: StageDef,
  owner: FighterState | null,
  frame: number,
): ProjectileStep {
  const prevX = p.x;
  const prevY = p.y;

  // A projectile is live on the frame it spawns (age 0) and lives `lifetime`
  // frames in all, ages 0 to `lifetime` − 1: SmashWiki's counts include the
  // spawn frame (Mario's "Lifetime 70 frames" Fireball is "17-86"; Plan 5,
  // Task 6 fix round 1).
  p.age += 1;
  if (p.age >= def.lifetime) return { alive: false, prevX, prevY };

  // A boomerang turns at the halfway point of its life, which is what makes its
  // range a fixed distance rather than a function of how long you hold it.
  if (def.returns === true && !p.returning && p.age * 2 >= def.lifetime) {
    p.vx = -p.vx;
    p.returning = true;
  }

  p.vy -= def.gravity;
  p.x += p.vx;
  p.y += p.vy;

  if (p.returning && owner !== null) {
    const caught =
      abs(p.x - owner.x) <= CATCH_RADIUS && abs(p.y - (owner.y + CATCH_HEIGHT)) <= CATCH_RADIUS;
    if (caught) return { alive: false, prevX, prevY };
  }

  if (!bounce(p, stage, frame, prevX, prevY)) return { alive: false, prevX, prevY };

  const b = stage.blastZone;
  if (p.x < b.left || p.x > b.right || p.y > b.top || p.y < b.bottom) {
    return { alive: false, prevX, prevY };
  }
  return { alive: true, prevX, prevY };
}

/**
 * Surfaces. Returns false when the projectile should be destroyed by one.
 *
 * A projectile with bounces left inverts the component it struck; one without
 * dies against the stage, which is why an arrow that misses ends in the dirt and
 * a bomb keeps going until it runs out of hops.
 */
function bounce(
  p: ProjectileState,
  stage: StageDef,
  frame: number,
  prevX: number,
  prevY: number,
): boolean {
  for (const plat of stage.platforms) {
    const cx = platformCentreX(plat, frame);

    // Landing on the top surface: a downward crossing inside the platform's span.
    if (p.vy <= 0 && prevY >= plat.y && p.y <= plat.y && abs(p.x - cx) <= plat.halfWidth) {
      if (p.bouncesLeft <= 0) return false;
      p.bouncesLeft -= 1;
      p.y = plat.y;
      p.vy = -p.vy;
      return true;
    }

    if (plat.soft) continue;

    // The side of a solid body.
    const bottom = plat.y - HARD_PLATFORM_DEPTH;
    const insideVertically = p.y < plat.y && p.y > bottom;
    const crossedWall = abs(prevX - cx) >= plat.halfWidth && abs(p.x - cx) < plat.halfWidth;
    if (insideVertically && crossedWall) {
      if (p.bouncesLeft <= 0) return false;
      p.bouncesLeft -= 1;
      p.x = prevX <= cx ? cx - plat.halfWidth : cx + plat.halfWidth;
      p.vx = -p.vx;
      return true;
    }
  }
  return true;
}

/** Has this projectile already connected with that port? */
export function projectileAlreadyHit(p: ProjectileState, port: number): boolean {
  return p.hitPorts.includes(port);
}

export function markProjectileHit(p: ProjectileState, port: number): void {
  if (!p.hitPorts.includes(port)) p.hitPorts.push(port);
}

/** A deep copy of one projectile, arrays and all. Used by `cloneState`. */
export function cloneProjectile(p: ProjectileState): ProjectileState {
  return {
    instanceId: p.instanceId,
    defId: p.defId,
    owner: p.owner,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    facing: p.facing,
    age: p.age,
    bouncesLeft: p.bouncesLeft,
    chargeScale: p.chargeScale,
    // Sliced, not shared: a snapshot whose `hitPorts` is the live array is a
    // rollback that silently remembers hits that were rewound.
    hitPorts: p.hitPorts.slice(),
    returning: p.returning,
    source: p.source,
    charge: p.charge,
    reflected: p.reflected,
  };
}
