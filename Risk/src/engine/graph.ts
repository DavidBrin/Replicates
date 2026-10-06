/**
 * The board graph: static adjacency plus whatever the active portals add
 * (SPEC §1 "Adjacency", R11, R29, R66, R68, R69, R74–R76, R90).
 *
 * Two different questions read this file and they are deliberately not the
 * same question. **Attack** needs a direct edge — a land border, a sea link,
 * or an active portal (R29, R69). **Fortify** needs only a path through
 * territories the mover owns (R66, D32), and a blizzard is never a path node
 * (R74). Portal edges count for both, identically (R68).
 *
 * `MapDef.adjacency` already carries land borders UNION sea links (F45), so
 * nothing here ever consults `Territory.seaLinked` — that field exists for the
 * renderer's dashed routes alone.
 *
 * Every returned list is sorted ascending, because an unsorted neighbour list
 * reaching a bot's scoring loop is a determinism bug (R91).
 */
import { SEAT_NONE } from "./types";
import type { GameState, MapDef, PortalState, Seat, TerritoryId } from "./types";

/** `true` while this portal conducts in `round` (R75, R76). */
export function portalActive(portal: PortalState, round: number): boolean {
  return round >= portal.activeFrom;
}

/** The portals conducting this round, in the order the state holds them. */
export function activePortals(state: GameState): readonly PortalState[] {
  return state.portals.filter((p) => portalActive(p, state.round));
}

/** `true` when `t` is a real index into the map. */
export function knownTerritory(map: MapDef, t: TerritoryId): boolean {
  return Number.isInteger(t) && t >= 0 && t < map.territories.length;
}

/** `true` when `t` is frozen for the game (R74). */
export function isBlizzard(state: GameState, t: TerritoryId): boolean {
  return state.territories[t]?.blizzard === true;
}

/**
 * Every direct neighbour of `t` this round: the map's static edges plus both
 * ends of every active portal touching `t`. Sorted ascending, no duplicates.
 */
export function neighbours(state: GameState, map: MapDef, t: TerritoryId): readonly TerritoryId[] {
  const base = map.adjacency[t] ?? [];
  const extra: TerritoryId[] = [];
  for (const portal of state.portals) {
    if (!portalActive(portal, state.round)) continue;
    if (portal.a === t && !base.includes(portal.b)) extra.push(portal.b);
    if (portal.b === t && !base.includes(portal.a)) extra.push(portal.a);
  }
  if (extra.length === 0) return base;
  const merged = [...base, ...extra.filter((x) => x !== t)];
  return [...new Set(merged)].sort((a, b) => a - b);
}

/** `true` when `a` and `b` share a direct edge this round (R29, R90). */
export function areAdjacent(state: GameState, map: MapDef, a: TerritoryId, b: TerritoryId): boolean {
  if (a === b) return false;
  return neighbours(state, map, a).includes(b);
}

/**
 * Every territory `seat` can reach from `from` through its own non-blizzard
 * territories, excluding `from` itself (R66, R68, R74). Breadth-first over a
 * sorted frontier, so the result is order-stable (R91).
 */
export function reachableOwn(
  state: GameState,
  map: MapDef,
  from: TerritoryId,
  seat: Seat,
): readonly TerritoryId[] {
  if (!knownTerritory(map, from)) return [];
  const seen = new Uint8Array(map.territories.length);
  seen[from] = 1;
  const out: TerritoryId[] = [];
  let frontier: TerritoryId[] = [from];
  while (frontier.length > 0) {
    const next: TerritoryId[] = [];
    for (const here of frontier) {
      for (const n of neighbours(state, map, here)) {
        if (seen[n] === 1) continue;
        const cell = state.territories[n];
        if (cell === undefined || cell.blizzard || cell.owner !== seat) continue;
        seen[n] = 1;
        out.push(n);
        next.push(n);
      }
    }
    next.sort((a, b) => a - b);
    frontier = next;
  }
  return out.sort((a, b) => a - b);
}

/** Every territory `seat` owns, ascending (R91). */
export function ownedBy(state: GameState, seat: Seat): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    if ((state.territories[i] as { owner: Seat }).owner === seat) out.push(i);
  }
  return out;
}

/** Territories no seat holds and no blizzard freezes — the claim phase's pool (R9). */
export function unclaimed(state: GameState): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i] as { owner: Seat; blizzard: boolean };
    if (!cell.blizzard && cell.owner === SEAT_NONE) out.push(i);
  }
  return out;
}

/** Territories a game is played over: every non-blizzard tile (R70, R71, R74). */
export function playableTerritories(state: GameState): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    if (!(state.territories[i] as { blizzard: boolean }).blizzard) out.push(i);
  }
  return out;
}
