/**
 * The map schema: `loadMap` and `validateMap` (SPEC §4.5, §4.14, D36).
 *
 * `MapFile` is what sits on disk — string ids, geometry inline, one fetch.
 * `MapDef` is the index-resolved runtime shape. The one interesting thing
 * `loadMap` does is **union the sea links into `adjacent` and `adjacency`**
 * (F45), so `legalAttackTargets`, fortify reachability and the symmetry check
 * all read one set and no caller has to remember `seaLinked` as well.
 * `Territory.seaLinked` survives only so §8's renderer knows which of those
 * edges to draw as a dashed route.
 *
 * `validateMap` is a build-time gate, not a runtime guard: two of the nine
 * upstream Classic graphs shipped bugs this would have caught (D36).
 */

import type { ContinentId, MapDef, MapFile, Suit, TerritoryId } from "../types";
import { MAX_SEATS } from "../types";

import { bboxOfRings, countVertices, parseRings, pointInRings } from "./path";

/* ------------------------------------------------------------------ gates -- */

/** §8's vertex budget per territory. The lower bound is what the validator can honestly assert:
 *  a triangle is the smallest closed shape, and tiny islands legitimately simplify below 12. */
export const MIN_VERTICES = 3;
export const MAX_VERTICES = 30;
/** `modifierSlots` ranges (R74–R76, SPEC §4.5). */
export const BLIZZARD_RANGE = [2, 11] as const;
export const PORTAL_RANGE = [3, 7] as const;
/** Geometry may sit this far outside the declared `viewBox` — a stroke's worth of rounding. */
const VIEWBOX_SLACK = 1.5;

const SUITS: readonly Exclude<Suit, "wild">[] = ["infantry", "cavalry", "artillery"];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/* ------------------------------------------------------------------ viewBox -- */

/** `"0 8 1024 643"` → `[0, 8, 1024, 643]`, or `null` when it is not four finite numbers. */
export function parseViewBox(viewBox: string): readonly [number, number, number, number] | null {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4) return null;
  for (const n of parts) if (!Number.isFinite(n)) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  if (w <= 0 || h <= 0) return null;
  return [x, y, w, h];
}

/* ------------------------------------------------------------------ validate -- */

/**
 * Everything wrong with `file`, as human-readable lines; `[]` means it passes.
 *
 * Returns rather than throws because the build reports every fault in one pass
 * — finding the next dangling reference one `pnpm run build:maps` at a time is
 * how upstream shipped theirs.
 */
export function validateMap(file: MapFile): string[] {
  const errors: string[] = [];
  const fail = (msg: string): void => {
    errors.push(msg);
  };

  /* ---- identity ---- */
  if (typeof file.slug !== "string" || !KEBAB.test(file.slug)) fail(`slug ${JSON.stringify(file.slug)} is not kebab-case`);
  if (typeof file.name !== "string" || file.name.trim() === "") fail("name is empty");

  const box = parseViewBox(file.viewBox ?? "");
  if (box === null) fail(`viewBox ${JSON.stringify(file.viewBox)} is not four finite numbers with a positive size`);

  /* ---- territory and continent ids ---- */
  const index = new Map<string, number>();
  file.territories.forEach((t, i) => {
    if (index.has(t.id)) fail(`duplicate territory id ${t.id}`);
    else index.set(t.id, i);
    if (!SNAKE.test(t.id)) fail(`territory id ${JSON.stringify(t.id)} is not lower_snake_case`);
    if (typeof t.name !== "string" || t.name.trim() === "") fail(`territory ${t.id} has no name`);
  });
  if (file.territories.length === 0) fail("map has no territories");

  const continentIndex = new Map<string, number>();
  file.continents.forEach((c, i) => {
    if (continentIndex.has(c.id)) fail(`duplicate continent id ${c.id}`);
    else continentIndex.set(c.id, i);
    if (!SNAKE.test(c.id)) fail(`continent id ${JSON.stringify(c.id)} is not lower_snake_case`);
    if (typeof c.name !== "string" || c.name.trim() === "") fail(`continent ${c.id} has no name`);
    if (!Number.isInteger(c.bonus) || c.bonus <= 0) fail(`continent ${c.id} bonus ${c.bonus} is not a positive integer`);
    if (typeof c.color !== "string" || c.color.trim() === "") fail(`continent ${c.id} has no color`);
    if (c.territories.length === 0) fail(`continent ${c.id} is empty`);
  });
  if (file.continents.length === 0) fail("map has no continents");

  /* ---- continent membership, both directions ---- */
  const declared = new Map<string, string>(); // territory id -> continent id, from the continent lists
  for (const c of file.continents) {
    for (const id of c.territories) {
      if (!index.has(id)) fail(`continent ${c.id} lists unknown territory ${id}`);
      else if (declared.has(id)) fail(`territory ${id} is listed by two continents (${declared.get(id)}, ${c.id})`);
      else declared.set(id, c.id);
    }
  }
  for (const t of file.territories) {
    if (!continentIndex.has(t.continent)) fail(`territory ${t.id} names unknown continent ${t.continent}`);
    const back = declared.get(t.id);
    if (back === undefined) fail(`territory ${t.id} is in no continent's list`);
    else if (back !== t.continent) fail(`territory ${t.id} says continent ${t.continent} but ${back} lists it`);
  }

  /* ---- adjacency ---- */
  const land = new Map<string, Set<string>>(file.territories.map((t) => [t.id, new Set<string>()]));
  for (const t of file.territories) {
    const seen = new Set<string>();
    for (const other of t.adjacent) {
      if (other === t.id) fail(`territory ${t.id} is adjacent to itself`);
      else if (!index.has(other)) fail(`territory ${t.id} is adjacent to unknown territory ${other}`);
      else if (seen.has(other)) fail(`territory ${t.id} lists ${other} twice`);
      else {
        seen.add(other);
        land.get(t.id)?.add(other);
      }
    }
  }
  for (const t of file.territories) {
    for (const other of land.get(t.id) ?? []) {
      if (!(land.get(other)?.has(t.id) ?? false)) fail(`adjacency is asymmetric: ${t.id} -> ${other} has no reciprocal`);
    }
  }

  /* ---- sea links ---- */
  const seaSeen = new Set<string>();
  for (const link of file.seaLinks) {
    const key = [link.from, link.to].sort().join("|");
    if (!index.has(link.from)) fail(`sea link endpoint ${link.from} is not a territory`);
    if (!index.has(link.to)) fail(`sea link endpoint ${link.to} is not a territory`);
    if (link.from === link.to) fail(`sea link ${link.from} joins a territory to itself`);
    if (seaSeen.has(key)) fail(`duplicate sea link ${key}`);
    seaSeen.add(key);
    // A sea link is drawn as a dashed route (§8), so it must not also be a land
    // border — otherwise the renderer draws a route across a shared frontier.
    if (land.get(link.from)?.has(link.to) ?? false) fail(`sea link ${key} duplicates a land border`);
  }

  /* ---- suits ---- */
  const suitCount: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
  for (const t of file.territories) {
    if (!SUITS.includes(t.suit)) fail(`territory ${t.id} has suit ${JSON.stringify(t.suit)}`);
    else suitCount[t.suit] = (suitCount[t.suit] ?? 0) + 1;
  }
  const counts = SUITS.map((s) => suitCount[s] ?? 0);
  if (Math.max(...counts) - Math.min(...counts) > 1) {
    fail(`suit counts differ by more than 1: infantry ${counts[0]}, cavalry ${counts[1]}, artillery ${counts[2]}`);
  }

  /* ---- geometry and anchors ---- */
  for (const t of file.territories) {
    if (typeof t.d !== "string" || t.d.trim() === "") {
      fail(`territory ${t.id} has no geometry`);
      continue;
    }
    const vertices = countVertices(t.d);
    if (vertices < MIN_VERTICES) fail(`territory ${t.id} has ${vertices} vertices, fewer than ${MIN_VERTICES}`);
    if (vertices > MAX_VERTICES) fail(`territory ${t.id} has ${vertices} vertices, more than ${MAX_VERTICES}`);

    const rings = parseRings(t.d);
    if (rings.length === 0) {
      fail(`territory ${t.id} has geometry that encloses no area`);
      continue;
    }
    for (const n of [t.tokenX, t.tokenY, t.labelX, t.labelY]) {
      if (!Number.isFinite(n)) {
        fail(`territory ${t.id} has a non-finite anchor`);
        break;
      }
    }
    if (!pointInRings([t.tokenX, t.tokenY], rings)) {
      fail(`territory ${t.id}'s token anchor (${t.tokenX}, ${t.tokenY}) is outside its own polygon`);
    }
    if (box !== null) {
      const [bx, by, bw, bh] = box;
      const outside = (x: number, y: number): boolean =>
        x < bx - VIEWBOX_SLACK || y < by - VIEWBOX_SLACK || x > bx + bw + VIEWBOX_SLACK || y > by + bh + VIEWBOX_SLACK;
      if (outside(t.tokenX, t.tokenY)) fail(`territory ${t.id}'s token anchor is outside the viewBox`);
      if (outside(t.labelX, t.labelY)) fail(`territory ${t.id}'s label anchor is outside the viewBox`);
      const bounds = bboxOfRings(rings);
      if (bounds !== null && (outside(bounds[0], bounds[1]) || outside(bounds[2], bounds[3]))) {
        fail(`territory ${t.id}'s geometry leaves the viewBox`);
      }
    }
  }

  /* ---- modifier slots ---- */
  const slots = file.modifierSlots;
  if (slots === undefined || slots === null) fail("modifierSlots is missing");
  else {
    if (!Number.isInteger(slots.blizzards) || slots.blizzards < BLIZZARD_RANGE[0] || slots.blizzards > BLIZZARD_RANGE[1]) {
      fail(`modifierSlots.blizzards ${slots.blizzards} is outside ${BLIZZARD_RANGE[0]}..${BLIZZARD_RANGE[1]}`);
    }
    if (!Number.isInteger(slots.portals) || slots.portals < PORTAL_RANGE[0] || slots.portals > PORTAL_RANGE[1]) {
      fail(`modifierSlots.portals ${slots.portals} is outside ${PORTAL_RANGE[0]}..${PORTAL_RANGE[1]}`);
    }
    if (!Number.isInteger(slots.capitals) || slots.capitals < 1 || slots.capitals > MAX_SEATS) {
      fail(`modifierSlots.capitals ${slots.capitals} is outside 1..${MAX_SEATS}`);
    }
  }

  /* ---- connectivity over land borders UNION sea links (F45) ---- */
  if (file.territories.length > 0 && errors.every((e) => !e.includes("unknown"))) {
    const all = new Map<string, Set<string>>(file.territories.map((t) => [t.id, new Set(land.get(t.id) ?? [])]));
    for (const link of file.seaLinks) {
      all.get(link.from)?.add(link.to);
      all.get(link.to)?.add(link.from);
    }
    const start = file.territories[0]?.id as string;
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      for (const other of [...(all.get(id) ?? [])].sort()) {
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    if (seen.size !== file.territories.length) {
      const stranded = file.territories.filter((t) => !seen.has(t.id)).map((t) => t.id);
      fail(`map is not connected: ${stranded.length} territories unreachable from ${start} (${stranded.slice(0, 6).join(", ")})`);
    }
  }

  return errors;
}

/** SPEC §4.14's `{ valid, errors }` shape, over the same single implementation. */
export function checkMap(file: MapFile): { valid: boolean; errors: readonly string[] } {
  const errors = validateMap(file);
  return { valid: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ load -- */

/**
 * Resolve a `MapFile` into the engine's `MapDef`. Throws only when
 * `validateMap` rejects the file — a malformed map is a build failure (D36),
 * so by the time one reaches a player it cannot fail here.
 */
export function loadMap(file: MapFile): MapDef {
  const errors = validateMap(file);
  if (errors.length > 0) {
    throw new Error(`invalid map ${file.slug}:\n  ${errors.join("\n  ")}`);
  }

  const index = new Map<string, TerritoryId>(file.territories.map((t, i) => [t.id, i]));
  const continentIndex = new Map<string, ContinentId>(file.continents.map((c, i) => [c.id, i]));
  const at = (id: string): TerritoryId => index.get(id) as TerritoryId;

  // Land borders UNION sea links, per territory (F45).
  const neighbours: Set<TerritoryId>[] = file.territories.map((t) => new Set(t.adjacent.map(at)));
  const sea: Set<TerritoryId>[] = file.territories.map(() => new Set<TerritoryId>());
  for (const link of file.seaLinks) {
    const a = at(link.from);
    const b = at(link.to);
    neighbours[a]?.add(b);
    neighbours[b]?.add(a);
    sea[a]?.add(b);
    sea[b]?.add(a);
  }

  const ascending = (a: number, b: number): number => a - b;
  const adjacency = neighbours.map((set) => [...set].sort(ascending));

  const territories = file.territories.map((t, i) => ({
    index: i as TerritoryId,
    id: t.id,
    name: t.name,
    continent: continentIndex.get(t.continent) as ContinentId,
    // S1 made `suit` a required member of `Territory` after this file was
    // written; the authored value carries straight through (F7).
    suit: t.suit,
    adjacent: adjacency[i] as readonly TerritoryId[],
    seaLinked: [...(sea[i] ?? [])].sort(ascending) as readonly TerritoryId[],
    d: t.d,
    token: [t.tokenX, t.tokenY] as readonly [number, number],
    label: [t.labelX, t.labelY] as readonly [number, number],
  }));

  const continents = file.continents.map((c, i) => {
    const members = c.territories.map(at).sort(ascending);
    const inside = new Set(members);
    // A border territory is one with an edge — land or sea — leaving the
    // continent. That is the set R14's "who can break this bonus" reads.
    const border = members.filter((m) => (adjacency[m] ?? []).some((n) => !inside.has(n)));
    return {
      index: i as ContinentId,
      id: c.id,
      name: c.name,
      bonus: c.bonus,
      color: c.color,
      territories: members as readonly TerritoryId[],
      border: border as readonly TerritoryId[],
    };
  });

  return {
    slug: file.slug,
    name: file.name,
    viewBox: parseViewBox(file.viewBox) as readonly [number, number, number, number],
    territories,
    continents,
    modifierSlots: file.modifierSlots,
    adjacency: adjacency as readonly (readonly TerritoryId[])[],
  };
}
