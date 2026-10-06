/**
 * Modifier-slot placement (SPEC §3.9 R74–R76, D35).
 *
 * Blizzards, Portals and Capitals are one global system plus a per-map count,
 * never per-map rules (D35) — so "which tiles" is a function of the map and a
 * seeded draw, and it lives here next to the graph rather than in the reducer.
 * `apply` contains no randomness at all (R88, D2): the resolver calls these
 * with its own `Rng` and puts the answer in the `GAME_STARTED` /
 * `PORTALS_MOVED` payload, where every client reads it the way it reads a dice
 * roll.
 *
 * Everything here takes `nextU32` as a plain parameter and is deterministic in
 * it, so the same seed places the same blizzards on every device. Integer
 * arithmetic only.
 */

import type { MapDef, TerritoryId } from "../types";

/** An unbiased integer in `[0, bound)`, by rejection — `% bound` skews low values. */
export function boundedU32(nextU32: () => number, bound: number): number {
  if (bound <= 1) return 0;
  // The largest multiple of `bound` that fits in 32 bits; draws above it are
  // discarded rather than folded, which is what keeps the draw uniform.
  const limit = 0x100000000 - (0x100000000 % bound);
  for (let guard = 0; guard < 64; guard++) {
    const n = nextU32() >>> 0;
    if (n < limit) return n % bound;
  }
  // A generator pathological enough to miss 64 times would be a bug elsewhere;
  // fold rather than loop forever.
  return (nextU32() >>> 0) % bound;
}

/** Fisher–Yates over `0..n-1`, drawing from `nextU32`. */
export function shuffledIndices(n: number, nextU32: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = boundedU32(nextU32, i + 1);
    const a = out[i] as number;
    out[i] = out[j] as number;
    out[j] = a;
  }
  return out;
}

/* ------------------------------------------------------------------ blizzards -- */

/**
 * `count` territories to freeze (R74).
 *
 * A blizzard is impassable, unconquerable and **not a path node for fortify
 * reachability**, so a careless draw can cut the board in two or wall a seat
 * into a dead end. Two rejections keep the board playable:
 *
 *  - the non-blizzard graph stays connected (land borders ∪ sea links), and
 *  - no continent is frozen solid — a blizzard still pays its region's bonus
 *    (R14), so an all-blizzard continent would be a free, untouchable bonus.
 *
 * Candidates are drawn in shuffled order and skipped when they fail, so the
 * result is deterministic in `nextU32` and never fewer than the map allows.
 */
export function blizzardCandidates(map: MapDef, count: number, nextU32: () => number): TerritoryId[] {
  const n = map.territories.length;
  const want = Math.max(0, Math.min(count, n - 2));
  const chosen: TerritoryId[] = [];
  const frozen = new Set<TerritoryId>();

  // How many of each continent are still thawed, so the "not solid" test is O(1).
  const thawed = map.continents.map((c) => c.territories.length);

  for (const candidate of shuffledIndices(n, nextU32)) {
    if (chosen.length >= want) break;
    const continent = map.territories[candidate]?.continent;
    if (continent === undefined) continue;
    if ((thawed[continent] ?? 0) <= 1) continue;

    frozen.add(candidate);
    if (connectedWithout(map, frozen)) {
      chosen.push(candidate);
      thawed[continent] = (thawed[continent] ?? 1) - 1;
    } else {
      frozen.delete(candidate);
    }
  }
  return chosen.sort((a, b) => a - b);
}

/** Is the graph still one piece once `frozen` is removed? */
function connectedWithout(map: MapDef, frozen: ReadonlySet<TerritoryId>): boolean {
  const n = map.territories.length;
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (!frozen.has(i)) {
      start = i;
      break;
    }
  }
  if (start < 0) return false;

  const seen = new Uint8Array(n);
  seen[start] = 1;
  const stack: number[] = [start];
  let reached = 1;
  while (stack.length > 0) {
    const id = stack.pop() as number;
    for (const other of map.adjacency[id] ?? []) {
      if (frozen.has(other) || seen[other] === 1) continue;
      seen[other] = 1;
      reached++;
      stack.push(other);
    }
  }
  return reached === n - frozen.size;
}

/* ------------------------------------------------------------------ portals -- */

/** One portal's endpoints. Matches `PortalState`'s `a`/`b` without its lifecycle fields. */
export interface PortalPair {
  readonly a: TerritoryId;
  readonly b: TerritoryId;
}

/**
 * `count` portal pairs (R75, R76).
 *
 * A portal adds one undirected edge, so a pair that is **already adjacent**
 * would add nothing; and two portals sharing an endpoint turn one tile into a
 * hub, which reads as a bug on the board. Both are rejected. Blizzard tiles are
 * excluded: they are never owned and never a path node, so a portal into one
 * is dead geometry.
 *
 * This is also the relocation draw for unstable portals (R76) — pass the
 * current round's blizzards and the caller stamps `activeFrom: round + 1`.
 */
export function portalCandidates(
  map: MapDef,
  count: number,
  nextU32: () => number,
  blizzards: readonly TerritoryId[] = [],
): PortalPair[] {
  const frozen = new Set<TerritoryId>(blizzards);
  const open = shuffledIndices(map.territories.length, nextU32).filter((i) => !frozen.has(i));
  const used = new Set<TerritoryId>();
  const pairs: PortalPair[] = [];

  for (const a of open) {
    if (pairs.length >= count) break;
    if (used.has(a)) continue;
    const neighbours = new Set(map.adjacency[a] ?? []);
    for (const b of open) {
      if (b === a || used.has(b) || neighbours.has(b)) continue;
      pairs.push({ a: Math.min(a, b), b: Math.max(a, b) });
      used.add(a);
      used.add(b);
      break;
    }
  }
  return pairs.sort((p, q) => p.a - q.a || p.b - q.b);
}

/**
 * The slots a map declares, clamped to what it can actually hold.
 *
 * `modifierSlots` is authored per map (D35) but a 3-territory fixture cannot
 * seat 6 capitals, and the resolver should get a number it can satisfy rather
 * than discover the shortfall mid-deal.
 */
export function slotsFor(map: MapDef, seats: number): { blizzards: number; portals: number; capitals: number } {
  const n = map.territories.length;
  return {
    blizzards: Math.max(0, Math.min(map.modifierSlots.blizzards, n - 2)),
    portals: Math.max(0, Math.min(map.modifierSlots.portals, Math.floor(n / 2))),
    capitals: Math.max(0, Math.min(map.modifierSlots.capitals, seats, n)),
  };
}
