/**
 * `movePortals` — the unstable-portal relocation (R11, R76; D58).
 *
 * Returns a `PORTALS_MOVED` action when `rules.portals === "unstable"` and
 * `round % 3 === 0`, and `null` otherwise, so the authority can ask on every
 * round start without a condition of its own (§5.7). The relocation is a log
 * row like a dice roll, so every client learns about it the same way (R76, D3).
 *
 * Each relocated portal takes **two draws**, one per end, and a portal that
 * cannot find a fresh non-adjacent partner still spends both — the draw count
 * is `2 * unstablePortals` whatever the board allows (D4).
 *
 * `activeFrom = round + 1`: an unstable portal is **inactive for the whole of
 * the round in which it moves** (R76).
 */
import { drawIndex } from "../prng";
import {
  UNSTABLE_PORTAL_PERIOD,
  type Action,
  type GameState,
  type MapDef,
  type PortalState,
  type Rng,
  type Seat,
  type TerritoryId,
} from "../types";

/** `true` when an unstable relocation is due at the start of `round` (R76). */
export function relocationDue(state: GameState): boolean {
  return state.rules.portals === "unstable" && state.round % UNSTABLE_PORTAL_PERIOD === 0;
}

export function movePortals(
  state: GameState,
  map: MapDef,
  rng: Rng,
): Extract<Action, { type: "PORTALS_MOVED" }> | null {
  if (!relocationDue(state)) return null;

  const unstable = state.portals.filter((p) => p.kind === "unstable");
  if (unstable.length === 0) return null;
  const stable = state.portals.filter((p) => p.kind !== "unstable");

  const used = new Set<TerritoryId>();
  for (const portal of stable) {
    used.add(portal.a);
    used.add(portal.b);
  }
  for (let i = 0; i < state.territories.length; i++) {
    if ((state.territories[i] as { blizzard: boolean }).blizzard) used.add(i);
  }

  const moved: PortalState[] = [];
  for (let i = 0; i < unstable.length; i++) {
    const firstPool = map.territories.filter((t) => !used.has(t.index)).map((t) => t.index);
    const firstAt = drawIndex(rng, firstPool.length);
    if (firstAt < 0) {
      drawIndex(rng, 0);
      continue;
    }
    const a = firstPool[firstAt] as TerritoryId;
    const adjacent = map.adjacency[a] ?? [];
    const secondPool = map.territories
      .filter((t) => t.index !== a && !used.has(t.index) && !adjacent.includes(t.index))
      .map((t) => t.index);
    const secondAt = drawIndex(rng, secondPool.length);
    if (secondAt < 0) continue;
    const b = secondPool[secondAt] as TerritoryId;
    used.add(a);
    used.add(b);
    moved.push({
      a: Math.min(a, b),
      b: Math.max(a, b),
      kind: "unstable",
      // R76 — inactive for the whole of the round it moves in.
      activeFrom: state.round + 1,
    });
  }

  const portals = [...stable, ...moved].sort((p, q) => p.a - q.a || p.b - q.b);
  const seat: Seat = state.turnOrder[state.currentIndex] ?? 0;
  return { type: "PORTALS_MOVED", seat, portals };
}
