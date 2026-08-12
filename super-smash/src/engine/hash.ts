/**
 * A 32-bit fingerprint of the whole simulation, for desync detection.
 *
 * Rollback netcode cannot tell you it has gone wrong. Two peers drift apart
 * silently — one fixed-point unit here, one branch there — and the first symptom
 * is that the match ends with two different winners. So every 30 frames the
 * session hashes its state and compares (SPEC §5), and this is that hash.
 *
 * Three properties matter, in this order:
 *
 * 1. **Total.** Every field the simulation can branch on must be mixed in. A
 *    field left out is a class of desync the check cannot see, which is worse
 *    than no check at all because it reads as a clean bill of health.
 * 2. **Order-stable.** The same state must hash identically on two machines and
 *    on two runs, so nothing here iterates an object's keys or a `Set` — the
 *    order is written out longhand and the field order *is* the specification.
 * 3. **Cheap.** It runs on every frame in development and once every 30 in
 *    production, on top of a rollback budget that already re-simulates eight
 *    frames. FNV-1a is a multiply and an xor per byte.
 *
 * FNV-1a rather than a cryptographic hash because this defends against
 * *accident*, not against an adversary: nobody is constructing a second game
 * state that collides with yours.
 */

import type {
  GameState,
  FighterState,
  ProjectileState,
  SmashBallState,
  MatchRules,
} from "./types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Mix one 32-bit integer in, byte by byte.
 *
 * `Math.imul` is the only way to get a genuine 32-bit multiply out of JavaScript
 * — a plain `*` produces a double, silently loses the low bits past 2^53 and
 * hashes differently depending on how the engine felt about the intermediate.
 */
export function mixInt(h: number, value: number): number {
  let x = h;
  const v = value | 0;
  for (let i = 0; i < 4; i++) {
    x = Math.imul(x ^ ((v >>> (i * 8)) & 0xff), FNV_PRIME);
  }
  return x >>> 0;
}

/** Mix a boolean. Distinct constants so `false` is not the same as "absent". */
export function mixBool(h: number, value: boolean): number {
  return mixInt(h, value ? 0x9e3779b9 : 0x7f4a7c15);
}

/** Mix a string, character by character. Used for fighter, stage and move ids. */
export function mixString(h: number, value: string): number {
  let x = mixInt(h, value.length);
  for (let i = 0; i < value.length; i++) x = mixInt(x, value.charCodeAt(i));
  return x;
}

function mixRules(h: number, r: MatchRules): number {
  let x = mixString(h, r.mode);
  x = mixInt(x, r.stocks);
  x = mixInt(x, r.timeLimit);
  x = mixBool(x, r.smashBall);
  x = mixBool(x, r.oneOnOne);
  return x;
}

function mixSmashBall(h: number, b: SmashBallState): number {
  let x = mixBool(h, b.active);
  x = mixInt(x, b.x);
  x = mixInt(x, b.y);
  x = mixInt(x, b.vx);
  x = mixInt(x, b.vy);
  x = mixInt(x, b.health);
  x = mixInt(x, b.driftTimer);
  return x;
}

/**
 * One fighter, field by field, in declaration order.
 *
 * Longhand on purpose. `Object.values` would be shorter and would silently
 * change the hash the day someone reorders `FighterState`, turning a harmless
 * refactor into a version mismatch between two builds that are otherwise
 * identical — and the failure would look exactly like a genuine desync.
 */
export function mixFighter(h: number, f: FighterState): number {
  let x = mixInt(h, f.port);
  x = mixString(x, f.defId);
  x = mixInt(x, f.costume);

  x = mixInt(x, f.x);
  x = mixInt(x, f.y);
  x = mixInt(x, f.vx);
  x = mixInt(x, f.vy);
  x = mixInt(x, f.facing);
  x = mixBool(x, f.grounded);
  x = mixInt(x, f.platform);

  x = mixString(x, f.action);
  x = mixInt(x, f.actionFrame);
  x = f.move === null ? mixInt(x, 0) : mixString(x, f.move);
  x = mixInt(x, f.charge);

  x = mixInt(x, f.damage);
  x = mixInt(x, f.stocks);
  x = mixInt(x, f.jumpsUsed);
  x = mixBool(x, f.airDodged);
  x = mixBool(x, f.fastFalling);
  x = mixBool(x, f.shortHop);

  x = mixInt(x, f.shieldHealth);
  x = mixInt(x, f.hitstun);
  x = mixInt(x, f.hitlag);
  x = mixInt(x, f.launchSpeed);
  x = mixInt(x, f.pendingKnockback);
  x = mixInt(x, f.pendingAngle);
  x = mixInt(x, f.pendingFacing);
  x = mixBool(x, f.balloon);
  x = mixInt(x, f.intangible);
  x = mixInt(x, f.invincible);

  x = mixInt(x, f.grabbedBy);
  x = mixInt(x, f.grabbing);
  x = mixInt(x, f.grabTimer);

  if (f.ledge === null) {
    x = mixInt(x, -1);
  } else {
    x = mixInt(x, f.ledge.platform);
    x = mixInt(x, f.ledge.side);
  }
  x = mixInt(x, f.ledgeRegrabs);
  x = mixInt(x, f.airTime);

  x = mixInt(x, f.finalSmashReady);

  x = mixInt(x, f.staleQueue.length);
  for (const slot of f.staleQueue) x = mixString(x, slot);
  x = mixInt(x, f.hitThisMove.length);
  for (const target of f.hitThisMove) x = mixInt(x, target);

  x = mixInt(x, f.framesSinceDirPress);
  x = mixInt(x, f.lastDirPressed);
  if (f.bufferedAction === null) {
    x = mixInt(x, 0);
  } else {
    x = mixString(x, f.bufferedAction.kind);
    x = mixInt(x, f.bufferedAction.frame);
  }
  return x;
}

/**
 * One projectile in flight.
 *
 * An arrow's position is as much a branch point as a fighter's — it decides who
 * gets hit — so leaving projectiles out of the hash would leave the loudest
 * source of divergence in a zoner matchup invisible to desync detection.
 */
export function mixProjectile(h: number, p: ProjectileState): number {
  let x = mixInt(h, p.instanceId);
  x = mixString(x, p.defId);
  x = mixInt(x, p.owner);
  x = mixInt(x, p.x);
  x = mixInt(x, p.y);
  x = mixInt(x, p.vx);
  x = mixInt(x, p.vy);
  x = mixInt(x, p.facing);
  x = mixInt(x, p.age);
  x = mixInt(x, p.bouncesLeft);
  x = mixInt(x, p.chargeScale);
  x = mixInt(x, p.hitPorts.length);
  for (const port of p.hitPorts) x = mixInt(x, port);
  x = mixBool(x, p.returning);
  return x;
}

/**
 * Hash the entire simulation state.
 *
 * Deliberately absent: anything in `StepEvents`. Events are the *output* of a
 * frame rather than part of its state, and a rollback re-simulation is supposed
 * to produce the same state without producing the same explosions. Hashing them
 * would make a correct rollback look like a desync.
 */
export function hashState(state: GameState): number {
  let h = FNV_OFFSET;
  h = mixInt(h, state.frame);
  h = mixInt(h, state.rngSeed);
  h = mixString(h, state.stageId);
  h = mixRules(h, state.rules);
  h = mixSmashBall(h, state.smashBall);
  h = mixInt(h, state.timeRemaining);
  h = mixInt(h, state.freezeFrames);
  if (state.outcome === null) {
    h = mixInt(h, 0);
  } else {
    h = mixString(h, state.outcome.kind);
    for (const port of state.outcome.placings) h = mixInt(h, port);
  }
  h = mixInt(h, state.fighters.length);
  for (const f of state.fighters) h = mixFighter(h, f);
  h = mixInt(h, state.nextProjectileId);
  h = mixInt(h, state.projectiles.length);
  for (const p of state.projectiles) h = mixProjectile(h, p);
  return h >>> 0;
}
