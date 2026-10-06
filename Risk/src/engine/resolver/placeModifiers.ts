/**
 * `placeModifiers` — blizzards and portals (R10, R11; D35, D58).
 *
 * Called by `dealTerritories` **before** the deal (R3 ②), which is what makes
 * R10's old "territories with no capital" filter vacuous and lets it be
 * dropped: no capital exists yet, and a blizzard tile is never dealt, so no
 * capital can ever land on one (R8).
 *
 * Draw counts are fixed and asserted by a test, because a change to a draw
 * count is a replay-breaking change (D4):
 *
 * - blizzards: exactly `modifierSlots.blizzards` draws when the modifier is on;
 * - portals: exactly `2 * modifierSlots.portals` draws when portals are on —
 *   one for each end. A portal that cannot be placed (no non-adjacent partner
 *   is left) still spends its two draws, so a cramped map cannot shift the
 *   stream for a roomy one.
 */
import { drawIndex } from "../prng";
import type { MapDef, PortalState, Rng, Rules, TerritoryId } from "../types";

/**
 * R10 — freeze `modifierSlots.blizzards` territories, uniformly at random,
 * never more than one per continent while alternatives remain.
 */
function chooseBlizzards(map: MapDef, count: number, rng: Rng): TerritoryId[] {
  const chosen: TerritoryId[] = [];
  const usedContinents = new Set<number>();
  for (let i = 0; i < count; i++) {
    const fresh = map.territories
      .filter((t) => !chosen.includes(t.index) && !usedContinents.has(t.continent))
      .map((t) => t.index);
    const fallback = map.territories.filter((t) => !chosen.includes(t.index)).map((t) => t.index);
    const pool = fresh.length > 0 ? fresh : fallback;
    const at = drawIndex(rng, pool.length);
    if (at < 0) continue; // the draw is spent either way
    const pick = pool[at] as TerritoryId;
    chosen.push(pick);
    usedContinents.add((map.territories[pick] as { continent: number }).continent);
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * R11 — `modifierSlots.portals` pairs of **non-adjacent, non-blizzard**
 * territories, no territory in two portals. Stable portals conduct from the
 * start; unstable ones also start active and only go quiet after their first
 * relocation (R76, D58).
 */
function choosePortals(
  map: MapDef,
  count: number,
  kind: Exclude<Rules["portals"], "off">,
  blizzards: readonly TerritoryId[],
  rng: Rng,
): PortalState[] {
  const out: PortalState[] = [];
  const used = new Set<TerritoryId>(blizzards);
  for (let i = 0; i < count; i++) {
    const firstPool = map.territories.filter((t) => !used.has(t.index)).map((t) => t.index);
    const firstAt = drawIndex(rng, firstPool.length);
    if (firstAt < 0) {
      drawIndex(rng, 0); // both draws are spent even when nothing can be placed
      continue;
    }
    const a = firstPool[firstAt] as TerritoryId;
    const adjacent = map.adjacency[a] ?? [];
    const secondPool = map.territories
      .filter((t) => t.index !== a && !used.has(t.index) && !adjacent.includes(t.index))
      .map((t) => t.index);
    const secondAt = drawIndex(rng, secondPool.length);
    if (secondAt < 0) continue; // no non-adjacent partner left; the draw is spent
    const b = secondPool[secondAt] as TerritoryId;
    used.add(a);
    used.add(b);
    out.push({ a: Math.min(a, b), b: Math.max(a, b), kind, activeFrom: 0 });
  }
  return out.sort((p, q) => p.a - q.a || p.b - q.b);
}

/** Blizzards and portals only, before the deal (R10, R11). */
export function placeModifiers(
  map: MapDef,
  rules: Rules,
  rng: Rng,
): { blizzards: readonly TerritoryId[]; portals: readonly PortalState[] } {
  const blizzards = rules.blizzards ? chooseBlizzards(map, map.modifierSlots.blizzards, rng) : [];
  const portals =
    rules.portals === "off"
      ? []
      : choosePortals(map, map.modifierSlots.portals, rules.portals, blizzards, rng);
  return { blizzards, portals };
}
