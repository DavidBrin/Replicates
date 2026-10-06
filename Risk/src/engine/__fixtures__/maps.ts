/**
 * `MapDef` fixtures for the engine's own tests (SPEC §12, T2/T5).
 *
 * S3 ships the real boards under `src/content/maps/`; these three are S1's own
 * copies, inside S1's tree, so the reducer's tests never wait on the map
 * pipeline. The graphs are the published ones — `tiny4` and `mini` from
 * Preeminence (MIT), `classic-world` from `research/map-data/canonical`, whose
 * 42 / 6 / 83 is the figure seven independent adjacency lists agree on — and
 * the geometry is a placeholder square per territory, because nothing in
 * `src/engine/**` reads a path.
 *
 * Card suits are assigned `index % 3`, which keeps the three counts within one
 * of each other (F7) without inventing an authored deck for a fixture.
 */
import type { Continent, MapDef, Suit, Territory, TerritoryId } from "../types";

/** A placeholder outline. The engine never reads geometry; the renderer does. */
const PLACEHOLDER_PATH = "M0 0h8v8h-8z";

/** One territory, with placeholder geometry derived from its index. */
function t(
  index: number,
  id: string,
  name: string,
  continent: number,
  suit: Exclude<Suit, "wild">,
  adjacent: readonly TerritoryId[],
  seaLinked: readonly TerritoryId[],
): Territory {
  return {
    index,
    id,
    name,
    continent,
    suit,
    adjacent,
    seaLinked,
    d: PLACEHOLDER_PATH,
    token: [16 + (index % 8) * 120, 40 + Math.floor(index / 8) * 90],
    label: [16 + (index % 8) * 120, 66 + Math.floor(index / 8) * 90],
  };
}

/** One continent. */
function c(
  index: number,
  id: string,
  name: string,
  bonus: number,
  color: string,
  territories: readonly TerritoryId[],
  border: readonly TerritoryId[],
): Continent {
  return { index, id, name, bonus, color, territories, border };
}

/** `MapDef.adjacency` mirrors `Territory.adjacent` exactly (F45), so derive it. */
function withAdjacency(seed: Omit<MapDef, "adjacency">): MapDef {
  return { ...seed, adjacency: seed.territories.map((x) => x.adjacent) };
}

/** `tiny4` — 4 territories, 1 continents, 6 undirected edges. */
export const tiny4: MapDef = withAdjacency({
  slug: "tiny4",
  name: "Tiny 4",
  viewBox: [0, 0, 1024, 640],
  modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
  territories: [
    t(0, "a", "A", 0, "infantry", [1, 2, 3], []),
    t(1, "b", "B", 0, "cavalry", [0, 2, 3], []),
    t(2, "c", "C", 0, "artillery", [0, 1, 3], []),
    t(3, "d", "D", 0, "infantry", [0, 1, 2], []),
  ],
  continents: [
    c(0, "all", "All", 2, "var(--cont-0)", [0, 1, 2, 3], []),
  ],
});

/** `mini` — 6 territories, 2 continents, 7 undirected edges. */
export const mini: MapDef = withAdjacency({
  slug: "mini",
  name: "Mini",
  viewBox: [0, 0, 1024, 640],
  modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
  territories: [
    t(0, "l1", "L1", 0, "infantry", [1, 2], []),
    t(1, "l2", "L2", 0, "cavalry", [0, 2], []),
    t(2, "l3", "L3", 0, "artillery", [0, 1, 3], []),
    t(3, "r1", "R1", 1, "infantry", [2, 4, 5], []),
    t(4, "r2", "R2", 1, "cavalry", [3, 5], []),
    t(5, "r3", "R3", 1, "artillery", [3, 4], []),
  ],
  continents: [
    c(0, "left", "Left", 3, "var(--cont-0)", [0, 1, 2], [2]),
    c(1, "right", "Right", 2, "var(--cont-1)", [3, 4, 5], [3]),
  ],
});

/** `classic-world` — 42 territories, 6 continents, 83 undirected edges. */
export const classicWorld: MapDef = withAdjacency({
  slug: "classic-world",
  name: "Classic World",
  viewBox: [0, 0, 1024, 640],
  modifierSlots: { blizzards: 4, portals: 5, capitals: 6 },
  territories: [
    t(0, "afghanistan", "Afghanistan", 4, "infantry", [6, 15, 21, 35, 36], []),
    t(1, "alaska", "Alaska", 0, "cavalry", [2, 19, 26], [19]),
    t(2, "alberta", "Alberta", 0, "artillery", [1, 26, 27, 40], []),
    t(3, "argentina", "Argentina", 1, "infantry", [4, 28], []),
    t(4, "brazil", "Brazil", 1, "cavalry", [3, 24, 28, 37], [24]),
    t(5, "central_america", "Central America", 0, "artillery", [10, 37, 40], [37]),
    t(6, "china", "China", 4, "infantry", [0, 15, 22, 31, 32, 36], []),
    t(7, "congo", "Congo", 3, "cavalry", [8, 24, 33], []),
    t(8, "east_africa", "East Africa", 3, "artillery", [7, 11, 20, 21, 24, 33], [21]),
    t(9, "eastern_australia", "Eastern Australia", 5, "infantry", [23, 38], []),
    t(10, "eastern_us", "Eastern United States", 0, "cavalry", [5, 27, 29, 40], []),
    t(11, "egypt", "Egypt", 3, "artillery", [8, 21, 24, 34], [34]),
    t(12, "great_britain", "Great Britain", 2, "infantry", [14, 25, 30, 39], []),
    t(13, "greenland", "Greenland", 0, "cavalry", [14, 26, 27, 29], [14]),
    t(14, "iceland", "Iceland", 2, "artillery", [12, 13, 30], [13]),
    t(15, "india", "India", 4, "infantry", [0, 6, 21, 31], []),
    t(16, "indonesia", "Indonesia", 5, "cavalry", [23, 31, 38], [31]),
    t(17, "irkutsk", "Irkutsk", 4, "artillery", [19, 22, 32, 41], []),
    t(18, "japan", "Japan", 4, "infantry", [19, 22], []),
    t(19, "kamchatka", "Kamchatka", 4, "cavalry", [1, 17, 18, 22, 41], [1]),
    t(20, "madagascar", "Madagascar", 3, "artillery", [8, 33], []),
    t(21, "middle_east", "Middle East", 4, "infantry", [0, 8, 11, 15, 34, 35], [8]),
    t(22, "mongolia", "Mongolia", 4, "cavalry", [6, 17, 18, 19, 32], []),
    t(23, "new_guinea", "New Guinea", 5, "artillery", [9, 16, 38], []),
    t(24, "north_africa", "North Africa", 3, "infantry", [4, 7, 8, 11, 34, 39], [4, 34, 39]),
    t(25, "northern_europe", "Northern Europe", 2, "cavalry", [12, 30, 34, 35, 39], []),
    t(26, "northwest_territory", "Northwest Territory", 0, "artillery", [1, 2, 13, 27], []),
    t(27, "ontario", "Ontario", 0, "infantry", [2, 10, 13, 26, 29, 40], []),
    t(28, "peru", "Peru", 1, "cavalry", [3, 4, 37], []),
    t(29, "quebec", "Quebec", 0, "artillery", [10, 13, 27], []),
    t(30, "scandinavia", "Scandinavia", 2, "infantry", [12, 14, 25, 35], []),
    t(31, "siam", "Siam", 4, "cavalry", [6, 15, 16], [16]),
    t(32, "siberia", "Siberia", 4, "artillery", [6, 17, 22, 36, 41], []),
    t(33, "south_africa", "South Africa", 3, "infantry", [7, 8, 20], []),
    t(34, "southern_europe", "Southern Europe", 2, "cavalry", [11, 21, 24, 25, 35, 39], [11, 24]),
    t(35, "ukraine", "Ukraine", 2, "artillery", [0, 21, 25, 30, 34, 36], []),
    t(36, "ural", "Ural", 4, "infantry", [0, 6, 32, 35], []),
    t(37, "venezuela", "Venezuela", 1, "cavalry", [4, 5, 28], [5]),
    t(38, "western_australia", "Western Australia", 5, "artillery", [9, 16, 23], []),
    t(39, "western_europe", "Western Europe", 2, "infantry", [12, 24, 25, 34], [24]),
    t(40, "western_us", "Western United States", 0, "cavalry", [2, 5, 10, 27], []),
    t(41, "yakutsk", "Yakutsk", 4, "artillery", [17, 19, 32], []),
  ],
  continents: [
    c(0, "north_america", "North America", 5, "var(--cont-0)", [1, 2, 5, 10, 13, 26, 27, 29, 40], [1, 5, 13]),
    c(1, "south_america", "South America", 2, "var(--cont-1)", [3, 4, 28, 37], [4, 37]),
    c(2, "europe", "Europe", 5, "var(--cont-2)", [12, 14, 25, 30, 34, 35, 39], [14, 34, 35, 39]),
    c(3, "africa", "Africa", 3, "var(--cont-3)", [7, 8, 11, 20, 24, 33], [8, 11, 24]),
    c(4, "asia", "Asia", 7, "var(--cont-4)", [0, 6, 15, 17, 18, 19, 21, 22, 31, 32, 36, 41], [0, 19, 21, 31, 36]),
    c(5, "australia", "Australia", 2, "var(--cont-5)", [9, 16, 23, 38], [16]),
  ],
});


/** Every fixture, for the suites that sweep all of them. */
export const ALL_FIXTURE_MAPS: readonly MapDef[] = [tiny4, mini, classicWorld];
