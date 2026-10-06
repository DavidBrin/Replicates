/**
 * `MapFile` → `MapDef` (SPEC §4.5).
 *
 * S3 owns the canonical `loadMap` in `@/engine/map`; that barrel does not
 * exist yet, and S4 may not create it, so this module carries the same
 * transformation for the setup flow and S4's own fixtures. The two agree on
 * the contract that matters: **sea links are unioned into every
 * `Territory.adjacent` and into `MapDef.adjacency`** (F45), every adjacency
 * list is sorted ascending (R91), and `Continent.border` is the subset of a
 * continent's territories with at least one edge leaving it.
 *
 * When `@/engine/map` lands, `toMapDef` becomes a one-line delegation.
 */
import type { Continent, MapDef, MapFile, Territory, TerritoryId } from "@/engine/types";

export class MapLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapLoadError";
  }
}

function parseViewBox(viewBox: string): readonly [number, number, number, number] {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new MapLoadError(`malformed viewBox: "${viewBox}"`);
  }
  const [x, y, w, h] = parts as [number, number, number, number];
  if (w <= 0 || h <= 0) throw new MapLoadError(`viewBox has no area: "${viewBox}"`);
  return [x, y, w, h];
}

/** Index every territory and continent slug once, so lookups are O(1) and a dangling ref is loud. */
function indexOf(ids: readonly string[], kind: string): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, index) => {
    if (map.has(id)) throw new MapLoadError(`duplicate ${kind} id "${id}"`);
    map.set(id, index);
  });
  return map;
}

/**
 * Build the runtime map. Throws `MapLoadError` on a dangling reference or a
 * malformed `viewBox`; every other validation is S3's `validateMap`.
 */
export function toMapDef(file: MapFile): MapDef {
  const territoryIndex = indexOf(file.territories.map((t) => t.id), "territory");
  const continentIndex = indexOf(file.continents.map((c) => c.id), "continent");

  const resolve = (id: string, from: string): TerritoryId => {
    const index = territoryIndex.get(id);
    if (index === undefined) throw new MapLoadError(`unknown territory "${id}" referenced by ${from}`);
    return index;
  };

  // Land borders first, then the sea links unioned in (F45). A Set per row
  // keeps the union idempotent when a file lists a sea link as a land border
  // too, which two of the upstream Classic graphs do.
  const rows: Set<TerritoryId>[] = file.territories.map(() => new Set<TerritoryId>());
  const seaRows: Set<TerritoryId>[] = file.territories.map(() => new Set<TerritoryId>());

  file.territories.forEach((t, i) => {
    for (const neighbour of t.adjacent) {
      const j = resolve(neighbour, `${t.id}.adjacent`);
      if (i === j) throw new MapLoadError(`territory "${t.id}" is adjacent to itself`);
      rows[i]?.add(j);
      rows[j]?.add(i);
    }
  });

  for (const link of file.seaLinks) {
    const a = resolve(link.from, "seaLinks");
    const b = resolve(link.to, "seaLinks");
    if (a === b) throw new MapLoadError(`sea link "${link.from}" joins a territory to itself`);
    rows[a]?.add(b);
    rows[b]?.add(a);
    seaRows[a]?.add(b);
    seaRows[b]?.add(a);
  }

  const sorted = (set: Set<TerritoryId> | undefined): readonly TerritoryId[] =>
    [...(set ?? [])].sort((a, b) => a - b);

  const territories: Territory[] = file.territories.map((t, index) => {
    const continent = continentIndex.get(t.continent);
    if (continent === undefined) {
      throw new MapLoadError(`territory "${t.id}" names unknown continent "${t.continent}"`);
    }
    return {
      index,
      id: t.id,
      name: t.name,
      continent,
      suit: t.suit,
      adjacent: sorted(rows[index]),
      seaLinked: sorted(seaRows[index]),
      d: t.d,
      token: [t.tokenX, t.tokenY] as const,
      label: [t.labelX, t.labelY] as const,
    };
  });

  const continents: Continent[] = file.continents.map((c, index) => {
    const members = c.territories.map((id) => resolve(id, `continent ${c.id}`)).sort((a, b) => a - b);
    const inside = new Set(members);
    const border = members.filter((t) => territories[t]?.adjacent.some((n) => !inside.has(n)) ?? false);
    return {
      index,
      id: c.id,
      name: c.name,
      bonus: c.bonus,
      color: c.color,
      territories: members,
      border,
    };
  });

  return {
    slug: file.slug,
    name: file.name,
    viewBox: parseViewBox(file.viewBox),
    territories,
    continents,
    modifierSlots: file.modifierSlots,
    adjacency: territories.map((t) => t.adjacent),
  };
}

/** Memoised per slug, because `toMapDef` is pure (§5.1). */
const cache = new Map<string, MapDef>();

export function toMapDefCached(file: MapFile): MapDef {
  const hit = cache.get(file.slug);
  if (hit) return hit;
  const def = toMapDef(file);
  cache.set(file.slug, def);
  return def;
}

/** Test hook: forget every memoised map. */
export function clearMapCache(): void {
  cache.clear();
}
