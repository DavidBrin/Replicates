/**
 * Collision: what a hitbox is, what it touches, and what happens when two of
 * them touch each other.
 *
 * Two decisions here are load-bearing rather than incidental.
 *
 * **Everything is a capsule.** A hurtbox is a segment with a radius, a hitbox is
 * a point with a radius, and both reduce to the same distance-between-segments
 * test — one function, no special cases, and no polygon clipping in fixed-point.
 *
 * **Hitboxes are swept, not sampled.** Ultimate interpolates a hitbox between its
 * position last frame and this frame and tests the whole line, because a hitbox
 * that moves 40 units in one frame would otherwise pass straight through a
 * 12-unit-wide fighter and report nothing. A moving sphere sweeps exactly a
 * capsule, so the swept test *is* the capsule test with the previous position as
 * the far end of the segment.
 */

import { ONE, mul, div, clamp } from "./fixed";
import { CLANK_RANGE } from "./constants";
import type { ActiveHit, FighterAttributes, FighterState, Hitbox, MoveDef } from "./types";

/** A segment with a radius. A circle is the degenerate case where both ends meet. */
export interface Capsule {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly r: number;
}

/** A capsule with no length — a plain circle. */
export function circle(x: number, y: number, r: number): Capsule {
  return { x1: x, y1: y, x2: x, y2: y, r };
}

/* -------------------------------------------------------------- geometry -- */

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return mul(dx, dx) + mul(dy, dy);
}

/** Squared distance from a point to a segment, all fixed-point. */
export function pointSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = mul(abx, abx) + mul(aby, aby);
  // A segment shorter than one fixed-point unit squared has no meaningful
  // direction; treating it as its own start point is both correct and stable.
  if (lenSq <= 0) return distSq(px, py, ax, ay);
  const t = clamp(div(mul(px - ax, abx) + mul(py - ay, aby), lenSq), 0, ONE);
  return distSq(px, py, ax + mul(abx, t), ay + mul(aby, t));
}

/** Sign of the cross product (b−a)×(c−a): +1 left turn, −1 right turn, 0 collinear. */
function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v = mul(bx - ax, cy - ay) - mul(by - ay, cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    py >= Math.min(ay, by) &&
    py <= Math.max(ay, by)
  );
}

/** Do two segments cross? Pure sign tests, so no division and no fixed-point blow-up. */
export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/**
 * Squared distance between two segments.
 *
 * In two dimensions this is either zero (they cross) or the smallest of the four
 * endpoint-to-other-segment distances — there is no interior minimum to find.
 * That identity is why this can be computed with one division instead of the
 * parametric solve, whose denominator goes to zero for parallel segments and
 * takes the fixed-point precision with it.
 */
export function segmentSegmentDistSq(a: Capsule, b: Capsule): number {
  if (segmentsIntersect(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2)) return 0;
  return Math.min(
    pointSegmentDistSq(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2),
    pointSegmentDistSq(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
    pointSegmentDistSq(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2),
    pointSegmentDistSq(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2),
  );
}

/** Two capsules overlap when their spines are closer than the sum of their radii. */
export function capsulesOverlap(a: Capsule, b: Capsule): boolean {
  const reach = a.r + b.r;
  return segmentSegmentDistSq(a, b) <= mul(reach, reach);
}

/** Two circles overlap. The common case, kept branch-free of the segment code. */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const reach = ar + br;
  return distSq(ax, ay, bx, by) <= mul(reach, reach);
}

/**
 * The capsule a hitbox sweeps out between last frame's position and this one.
 *
 * Fox's up smash is out for two frames and travels most of his height in them;
 * sampled at frame boundaries it would miss a fighter standing between the two
 * samples. Sweeping costs one extra segment endpoint and closes the hole.
 */
export function sweptHitboxCapsule(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  radius: number,
): Capsule {
  return { x1: prevX, y1: prevY, x2: x, y2: y, r: radius };
}

/** Does a hitbox, swept from its previous position, reach the target capsule? */
export function sweptHitboxOverlaps(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  radius: number,
  target: Capsule,
): boolean {
  return capsulesOverlap(sweptHitboxCapsule(prevX, prevY, x, y, radius), target);
}

/* -------------------------------------------------------------- fighters -- */

/**
 * A fighter's hurtbox: a vertical capsule standing on the origin.
 *
 * The origin is at the feet — the same point platform collision snaps to the
 * ground — so the spine runs from one radius up to `height` minus one radius,
 * and a fighter shorter than twice its own width degenerates to a circle rather
 * than an inside-out capsule.
 */
export function hurtboxCapsule(f: Pick<FighterState, "x" | "y">, attrs: FighterAttributes): Capsule {
  const r = attrs.width;
  const lo = f.y + r;
  const hi = f.y + attrs.height - r;
  if (hi <= lo) {
    const mid = f.y + Math.trunc(attrs.height / 2);
    return circle(f.x, mid, r);
  }
  return { x1: f.x, y1: lo, x2: f.x, y2: hi, r };
}

/** Where a facing-relative hitbox actually sits this frame. */
export function hitboxWorldPos(
  x: number,
  y: number,
  facing: number,
  hb: Pick<Hitbox, "x" | "y">,
): { x: number; y: number } {
  return { x: x + (facing >= 0 ? hb.x : -hb.x), y: y + hb.y };
}

/**
 * The move frame a fighter's `actionFrame` is on.
 *
 * `actionFrame` counts from zero on the frame a move starts; frame data — every
 * `startFrame` and `endFrame` in `fighters/` — is quoted the way the community
 * quotes it, from one. So a hitbox marked `startFrame: 15` is live when
 * `actionFrame` is 14, and every consumer of both numbers has to agree about
 * that or it is off by a frame.
 *
 * It lives here, named, because there are now three such consumers — the
 * collision loop, the animation timing and the swing graphic — and two of them
 * are in the renderer, far enough from this file that the convention would
 * otherwise be rediscovered by hand each time.
 */
export function moveFrameOf(actionFrame: number): number {
  return actionFrame + 1;
}

/** The inverse: which `actionFrame` a quoted move frame lands on. */
export function actionFrameOf(moveFrame: number): number {
  return moveFrame - 1;
}

/** The hitboxes of `move` that are live on `frame` (0-based within the move). */
export function activeHitboxes(move: MoveDef, frame: number): Hitbox[] {
  const out: Hitbox[] = [];
  for (const hb of move.hitboxes) {
    if (frame >= hb.startFrame && frame <= hb.endFrame) out.push(hb);
  }
  return out;
}

/**
 * Which of one fighter's own overlapping hitboxes wins: the lowest id.
 *
 * This is how Marth's tipper works. The sweetspot is authored as id 0 and the
 * body of the blade as id 1, both live on the same frames and overlapping in
 * space; ordering by id — never by damage, never by declaration order — is what
 * makes "the tip does markedly more" a property of the data rather than of the
 * loop that happens to scan it.
 */
export function bestHitbox<T extends { readonly hitbox: Hitbox }>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (best === null || c.hitbox.id < best.hitbox.id) best = c;
  }
  return best;
}

/* ---------------------------------------------------------------- clanks -- */

export type ClankOutcome =
  /** No interaction: one side is transcendent, or a grab, or the two never met. */
  | "none"
  /** Within 9 damage of each other: both cancel and both fighters rebound. */
  | "rebound"
  | "aWins"
  | "bWins";

/**
 * Two opposing hitboxes met. Who survives?
 *
 * Within 9% damage of each other, both attacks are cancelled and both fighters
 * rebound — the *ping*. Outside that, the stronger move continues and the weaker
 * is cancelled outright. Either way **neither hitbox deals damage on the clank
 * frame itself**, which is the rule that stops a trade from being a free hit for
 * whoever happened to be scanned first.
 *
 * Transcendent hitboxes — most projectiles, Marth's blade — pass through instead
 * of clanking, so a projectile is not deleted by a jab.
 */
export function resolveClank(a: Hitbox, b: Hitbox): ClankOutcome {
  if (a.transcendent || b.transcendent) return "none";
  // Grabs are not attacks: they have no priority to contest, they simply lose to
  // anything that hits them first.
  if (a.grabbing || b.grabbing) return "none";
  const diff = a.damage - b.damage;
  if (diff <= CLANK_RANGE && diff >= -CLANK_RANGE) return "rebound";
  return diff > 0 ? "aWins" : "bWins";
}

/* ------------------------------------------------- one swing, one victim -- */

/**
 * The Smash Ball's slot in a fighter's `hitThisMove` record.
 *
 * Ports are 0–3, so 8 can never collide with one and the record stays a flat
 * array of small integers that the state hash can walk without a special case.
 */
export const SMASH_BALL_TARGET = 8;

/** Has this swing already connected with that target? */
export function alreadyHit(f: Pick<FighterState, "hitThisMove">, target: number): boolean {
  return f.hitThisMove.includes(target);
}

/**
 * Record a connection so the same swing cannot hit the same target twice.
 *
 * Cleared whenever a new move starts (`clearHitRecord`), which is what makes a
 * multi-hit move like Link's up smash hit three times while a single-hit move
 * with three overlapping hitboxes hits once.
 */
export function markHit(f: Pick<FighterState, "hitThisMove">, target: number): void {
  if (!f.hitThisMove.includes(target)) f.hitThisMove.push(target);
}

export function clearHitRecord(f: Pick<FighterState, "hitThisMove">): void {
  f.hitThisMove.length = 0;
}

/** Convenience for the resolver: a candidate hit with its swept geometry resolved. */
export function makeActiveHit(owner: number, hitbox: Hitbox, x: number, y: number): ActiveHit {
  return { owner, hitbox, x, y };
}
