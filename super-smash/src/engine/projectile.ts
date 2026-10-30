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

import { ONE, fx, abs, cosDeg, isqrt, mul, sinDeg } from "./fixed";
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
 * `damageMul` is the launching move's own damage multiplier (Plan 5, Task 9:
 * a copied special's ×1.2, `MoveDef.copyDamage`).
 */
export function spawnProjectile(
  def: ProjectileDef,
  owner: FighterState,
  instanceId: number,
  source: string = owner.defId,
  chargeFrames: number = SMASH_CHARGE_MAX,
  damageMul: number = ONE,
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
    damageMul,
    mode: "fly",
    life: 0,
    ground: -1,
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

const returningHitboxes = new WeakMap<ProjectileDef, Hitbox>();

/** A returning projectile's hit on the way back (`ProjectileDef.returns.hit`), built once per definition. */
function returningHitbox(def: ProjectileDef, hit: NonNullable<ProjectileDef["returns"]>["hit"]): Hitbox {
  let hb = returningHitboxes.get(def);
  if (hb === undefined) {
    hb = { ...def.hitbox, ...hit };
    returningHitboxes.set(def, hb);
  }
  return hb;
}

/**
 * This projectile's hitbox, at the charge it was launched with (Plan 5), or its
 * hit on the way back once a returning one has turned (Task 13c).
 */
export function projectileHitbox(p: ProjectileState, def: ProjectileDef): Hitbox {
  if (p.returning && def.returns !== undefined) return returningHitbox(def, def.returns.hit);
  return def.charged === undefined ? def.hitbox : chargedHitbox(def.hitbox, def.charged.hitbox, p.charge, def.charged.partial);
}

/**
 * Is this projectile's hitbox live? Its frames are counted from the spawn, and
 * only in its own flight: lodged or knocked away, it hits nothing (Task 13c).
 */
export function projectileHitboxActive(p: ProjectileState, def: ProjectileDef): boolean {
  return p.mode === "fly" && p.age >= def.hitbox.startFrame && p.age <= def.hitbox.endFrame;
}

/**
 * A clank it lost (Plan 5, Task 13c): knocked away (`ProjectileDef.clash`, Link's
 * boomerang), it keeps no hitbox, flies off and falls, and is gone after the
 * clash's lifetime; returns false for one with no such rule, which the clank
 * ends. UNVERIFIED: that the clash's speed is facing-relative, as `vx` is.
 */
export function knockProjectile(p: ProjectileState, def: ProjectileDef): boolean {
  const c = def.clash;
  if (c === undefined) return false;
  p.mode = "knocked";
  p.life = c.lifetime;
  p.vx = p.facing * c.vx;
  p.vy = c.vy;
  p.ground = -1;
  p.bouncesLeft = 0;
  return true;
}

export type ProjectileStep =
  | { readonly alive: true; readonly prevX: number; readonly prevY: number }
  | { readonly alive: false; readonly prevX: number; readonly prevY: number };

/**
 * Move a projectile one frame, and say whether it survived.
 *
 * The order is fixed and matters: age first (so `lifetime` is exact), then the
 * way back for a boomerang, then gravity and integration, then the catch, then
 * surfaces, then the blast zone. Bouncing after integrating means the bounce
 * responds to where the projectile actually went rather than where it was aimed.
 * One resting on a platform (a settled bomb, a lodged arrow; Plan 5, Task 13c)
 * only goes where the platform carries it.
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
  // Task 6 fix round 1). Lodged or knocked, its own count runs instead (Task 13c).
  p.age += 1;
  if (p.mode !== "fly") {
    p.life -= 1;
    if (p.life <= 0) return { alive: false, prevX, prevY };
  } else if (p.age >= def.lifetime) return { alive: false, prevX, prevY };

  if (p.ground >= 0) {
    carryOnGround(p, stage, frame);
    return { alive: true, prevX, prevY };
  }

  if (p.mode === "knocked") {
    const c = def.clash!;
    p.vy = fall(p.vy, c.gravity, c.maxFall);
    p.x += p.vx;
    p.y += p.vy;
    // UNVERIFIED: that a knocked boomerang is gone on the stage it meets; the page
    // gives its flight, not its landing.
    if (!surfaces(p, VANISH, stage, frame, prevX, prevY)) return { alive: false, prevX, prevY };
    return inBlastZone(p, stage) ? { alive: true, prevX, prevY } : { alive: false, prevX, prevY };
  }

  if (def.returns !== undefined) steerReturning(p, def.returns, owner);

  // A star slows, and is gone below its least speed (Plan 5, Task 9: Kirby's spit,
  // SmashWiki "Kirby (SSBU)/Neutral special", "The star's speed decreases by 0.05
  // per frame, and it releases the target when its speed drops below 0.4").
  // UNVERIFIED: that a frame slows it before it moves.
  if (def.drag !== undefined) {
    const speed = abs(p.vx) - def.drag.perFrame;
    if (speed < def.drag.minSpeed) return { alive: false, prevX, prevY };
    p.vx = p.vx >= 0 ? speed : -speed;
  }
  p.vy = fall(p.vy, def.gravity, def.maxFall);
  p.x += p.vx;
  p.y += p.vy;

  if (p.returning && owner !== null) {
    const caught =
      abs(p.x - owner.x) <= CATCH_RADIUS && abs(p.y - (owner.y + CATCH_HEIGHT)) <= CATCH_RADIUS;
    if (caught) return { alive: false, prevX, prevY };
  }

  if (!surfaces(p, def, stage, frame, prevX, prevY)) return { alive: false, prevX, prevY };
  return inBlastZone(p, stage) ? { alive: true, prevX, prevY } : { alive: false, prevX, prevY };
}

/** `vy` a frame later under `gravity`, no faster down than `maxFall` when it has one. */
function fall(vy: number, gravity: number, maxFall: number | undefined): number {
  const next = vy - gravity;
  return maxFall !== undefined && next < -maxFall ? -maxFall : next;
}

function inBlastZone(p: ProjectileState, stage: StageDef): boolean {
  const b = stage.blastZone;
  return p.x >= b.left && p.x <= b.right && p.y <= b.top && p.y >= b.bottom;
}

/**
 * A projectile resting on a platform goes where the platform goes, as a fighter
 * standing on it does (`physics.ts`). UNVERIFIED: that Ultimate carries a settled
 * bomb or a lodged arrow on Smashville's moving platform; no source says.
 */
function carryOnGround(p: ProjectileState, stage: StageDef, frame: number): void {
  const plat = stage.platforms[p.ground];
  if (plat?.motion) p.x += platformCentreX(plat, frame) - platformCentreX(plat, frame - 1);
}

/**
 * The way out and back of a returning projectile (Plan 5, Task 13c: Link's
 * boomerang). Out, it loses `deceleration` a frame, and once it would be slower
 * than `minSpeed` it turns back along its path at that speed; back, it gains the
 * same each frame up to `maxSpeed`, turned towards its owner's chest by at most
 * the homing angle a frame. UNVERIFIED: that it gains on the way back what it lost
 * on the way out (the page gives only the deceleration and the maximum), and its
 * "Distance spent turning back" is not modelled: it turns on the spot.
 */
function steerReturning(p: ProjectileState, r: NonNullable<ProjectileDef["returns"]>, owner: FighterState | null): void {
  const speed = length(p.vx, p.vy);
  if (!p.returning) {
    const slower = speed - r.deceleration;
    if (slower >= r.minSpeed) {
      setSpeed(p, p.vx, p.vy, slower);
      return;
    }
    p.returning = true;
    setSpeed(p, -p.vx, -p.vy, r.minSpeed);
    return;
  }
  const faster = Math.min(speed + r.deceleration, r.maxSpeed);
  if (owner === null) {
    setSpeed(p, p.vx, p.vy, faster);
    return;
  }
  const [dx, dy] = turnToward(p.vx, p.vy, owner.x - p.x, owner.y + CATCH_HEIGHT - p.y, r.homing.sin, r.homing.cos);
  setSpeed(p, dx, dy, faster);
}

/**
 * The length of a Q12 vector, exactly: the floor of √(dx² + dy²) on the raw
 * integers (`isqrt`). Not `magnitude`, which squares in Q12 and is a few units out
 * for a slow, slanted vector (a boomerang turning at 0.3).
 */
function length(dx: number, dy: number): number {
  return isqrt(dx * dx + dy * dy);
}

/**
 * `p`'s velocity along (dx, dy) at `speed`; along its facing when (dx, dy) has no
 * length. `|| 0` keeps a −0 out of the state (a truncated −0.5 is −0).
 */
function setSpeed(p: ProjectileState, dx: number, dy: number, speed: number): void {
  const m = length(dx, dy);
  if (m === 0) {
    p.vx = p.facing * speed;
    p.vy = 0;
    return;
  }
  p.vx = Math.trunc((dx * speed) / m) || 0;
  p.vy = Math.trunc((dy * speed) / m) || 0;
}

/**
 * (vx, vy) turned towards (tx, ty) by at most the angle whose sine and cosine are
 * given, the shorter way round; straight at it when it is already within that
 * angle ahead. Integer products throughout: the cross and dot products of two Q12
 * vectors are exact below 2^53 at any distance the stage allows.
 */
function turnToward(vx: number, vy: number, tx: number, ty: number, sin: number, cos: number): [number, number] {
  const vm = length(vx, vy);
  const tm = length(tx, ty);
  if (vm === 0 || tm === 0) return [vx, vy];
  const cross = vx * ty - vy * tx;
  const dot = vx * tx + vy * ty;
  // sin(angle between them) = |cross| / (|v| |t|), every term raw Q12.
  if (dot > 0 && Math.abs(cross) * ONE <= sin * vm * tm) return [tx, ty];
  const s = cross >= 0 ? sin : -sin;
  return [mul(vx, cos) - mul(vy, s), mul(vx, s) + mul(vy, cos)];
}

/** The parts of a `ProjectileDef` that say how it meets the stage. */
type SurfaceRule = Pick<ProjectileDef, "lodge" | "settle" | "hop" | "skim">;

/** What a surface does to a knocked projectile: nothing in `ProjectileDef` but its end. */
const VANISH: SurfaceRule = {};

/**
 * Surfaces: a floor (a top it comes down onto, soft or solid), and a solid
 * body's wall or underside (SmashWiki "Wall", https://www.ssbwiki.com/Wall: "All
 * walls will stop projectile attacks"; Plan 5, Task 13c brings in the underside,
 * which a rising projectile flew up through). Returns false when the projectile
 * is gone against one. Each meets them by its own rule: it lodges (`lodge`), it
 * bounces and settles (`settle`), it bounces while it has bounces left
 * (`bounces`), else the surface ends it — which is why a missile ends in the
 * wall and a Thunder Jolt skips back off it.
 */
function surfaces(
  p: ProjectileState,
  rule: SurfaceRule,
  stage: StageDef,
  frame: number,
  prevX: number,
  prevY: number,
): boolean {
  for (let i = 0; i < stage.platforms.length; i++) {
    const plat = stage.platforms[i];
    const cx = platformCentreX(plat, frame);

    // Landing on the top surface: a downward crossing inside the platform's span.
    if (p.vy <= 0 && prevY >= plat.y && p.y <= plat.y && abs(p.x - cx) <= plat.halfWidth) {
      return meetFloor(p, rule, i, plat.y, plat.soft);
    }

    if (plat.soft) continue;

    // The side of a solid body.
    const bottom = plat.y - HARD_PLATFORM_DEPTH;
    const insideVertically = p.y < plat.y && p.y > bottom;
    const crossedWall = abs(prevX - cx) >= plat.halfWidth && abs(p.x - cx) < plat.halfWidth;
    if (insideVertically && crossedWall) {
      return meetSide(p, rule, i, prevX <= cx ? cx - plat.halfWidth : cx + plat.halfWidth);
    }

    // The underside of a solid body: an upward crossing of it inside the span.
    if (prevY <= bottom && p.y > bottom && abs(p.x - cx) < plat.halfWidth) {
      return meetUnderside(p, rule, i, bottom);
    }
  }
  return true;
}

/** Stuck where it met platform `i` (`ProjectileDef.lodge`); its speed is kept, for the way it points. */
function lodgeAt(p: ProjectileState, frames: number, i: number, x: number, y: number): void {
  p.mode = "lodged";
  p.life = frames;
  p.ground = i;
  p.x = x;
  p.y = y;
}

function meetFloor(p: ProjectileState, rule: SurfaceRule, i: number, y: number, soft: boolean): boolean {
  if (rule.lodge !== undefined) {
    lodgeAt(p, rule.lodge, i, p.x, y);
    return true;
  }
  if (rule.skim !== undefined) return skimFloor(p, rule.skim, y, soft);
  if (rule.settle !== undefined) {
    p.y = y;
    const speed = -p.vy;
    // UNVERIFIED (fix round 1): "Minimum speed to bounce off ground" read as the
    // speed it lands at. Read as the speed after the bounce's multiplier instead,
    // Samus's bomb would rest from age 75, not 83.
    if (speed >= rule.settle.minSpeed) {
      // UNVERIFIED: that the bounce's "Speed multiplier" takes both components.
      p.vx = mul(p.vx, rule.settle.restitution);
      p.vy = mul(speed, rule.settle.restitution);
    } else {
      p.vx = 0;
      p.vy = 0;
      p.ground = i;
    }
    return true;
  }
  if (p.bouncesLeft <= 0) return false;
  p.bouncesLeft -= 1;
  p.y = y;
  if (rule.hop !== undefined) {
    // UNVERIFIED: that "Speed multiplier after bounce" scales the speed along the
    // floor, and the rise is then held between the page's least and most.
    p.vx = mul(p.vx, rule.hop.speed);
    p.vy = Math.min(Math.max(mul(-p.vy, rule.hop.speed), rule.hop.minVy), rule.hop.maxVy);
    return true;
  }
  p.vy = -p.vy;
  return true;
}

/**
 * A floor met by a skimming projectile (`ProjectileDef.skim`; Plan 5, Task 13c fix
 * round 1, ruling R-T13c-c: Link's boomerang, SmashWiki "Link (SSBU)/Side special",
 * https://www.ssbwiki.com/Link_(SSBU)/Side_special). Met shallower than its through
 * angle, it comes off at its own angle, at least its minimum ("Minimum bounce angle
 * off ground 16°"), at its speed; a soft platform met more steeply it goes through
 * ("Angle difference to go through floor instead of bouncing off 30°"). UNVERIFIED:
 * that reading of the angle pair; and that a solid floor met steeply bounces it as a
 * shallow one does, since going through it would put it inside the stage, which
 * "Wall" rules out for walls. Not modelled: "Downward ground collision range −0.5u".
 */
function skimFloor(p: ProjectileState, skim: NonNullable<ProjectileDef["skim"]>, y: number, soft: boolean): boolean {
  const steep = mul(abs(p.vy), cosDeg(skim.throughAngle)) > mul(abs(p.vx), sinDeg(skim.throughAngle));
  if (steep && soft) return true;
  p.y = y;
  p.vy = -p.vy;
  if (mul(p.vy, cosDeg(skim.minAngle)) < mul(abs(p.vx), sinDeg(skim.minAngle))) {
    const speed = length(p.vx, p.vy);
    p.vx = (p.vx >= 0 ? 1 : -1) * mul(speed, cosDeg(skim.minAngle));
    p.vy = mul(speed, sinDeg(skim.minAngle));
  }
  return true;
}

function meetSide(p: ProjectileState, rule: SurfaceRule, i: number, x: number): boolean {
  if (rule.lodge !== undefined) {
    lodgeAt(p, rule.lodge, i, x, p.y);
    return true;
  }
  // UNVERIFIED: that a wall stops a settling bomb rather than ending it; it lives
  // on its timer, and no source has it meet a wall.
  if (rule.settle !== undefined) {
    p.x = x;
    p.vx = 0;
    return true;
  }
  if (p.bouncesLeft <= 0) return false;
  p.bouncesLeft -= 1;
  p.x = x;
  p.vx = -p.vx;
  return true;
}

/**
 * The underside, met the way the projectile meets a wall: a lodge sticks it
 * there, a bounce turns its rise round, else it is gone (Plan 5, Task 13c).
 * UNVERIFIED: an underside's own rule for any of them; SmashWiki's "Wall" names
 * walls, and the arrow's page "a surface". A settling bomb only stops rising, as
 * at a wall.
 */
function meetUnderside(p: ProjectileState, rule: SurfaceRule, i: number, y: number): boolean {
  if (rule.lodge !== undefined) {
    lodgeAt(p, rule.lodge, i, p.x, y);
    return true;
  }
  if (rule.settle !== undefined) {
    p.y = y;
    p.vy = 0;
    return true;
  }
  if (p.bouncesLeft <= 0) return false;
  p.bouncesLeft -= 1;
  p.y = y;
  p.vy = -p.vy;
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
    damageMul: p.damageMul,
    mode: p.mode,
    life: p.life,
    ground: p.ground,
  };
}
