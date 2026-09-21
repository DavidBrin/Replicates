import { describe, expect, it } from "vitest";

import type { MapDefinition } from "@/engine/types";

import {
  blankMap,
  clearMap,
  defaultDraft,
  fillMap,
  indexOf,
  paintTile,
  resizeMap,
  setBiome,
  setPlayerCount,
  setStartGold,
} from "../editorModel";

describe("defaultDraft", () => {
  it("is 12×12 grass with two seated players and a city each", () => {
    const map = defaultDraft();
    expect(map.width).toBe(12);
    expect(map.height).toBe(12);
    expect(map.tiles).toHaveLength(144);
    expect(map.players).toHaveLength(2);
    const cities = map.tiles.filter((t) => t.building === "city");
    expect(cities.map((t) => t.owner)).toEqual([0, 1]);
    expect(map.tiles.filter((t) => t.owner === 0)).toHaveLength(9);
    expect(map.id).toBeNull();
  });
});

describe("paintTile", () => {
  const map = blankMap(6, 6, "grass", 2);

  it("paints terrain and returns a new map without mutating the input", () => {
    const i = indexOf(map, 2, 3);
    const next = paintTile(map, i, { kind: "terrain", terrain: "water" }, 0);
    expect(next).not.toBe(map);
    expect(next.tiles[i]?.terrain).toBe("water");
    expect(map.tiles[i]?.terrain).toBe("grass");
    // Untouched tiles are shared, not copied.
    expect(next.tiles[0]).toBe(map.tiles[0]);
  });

  it("returns the same map when nothing changes", () => {
    expect(paintTile(map, 0, { kind: "terrain", terrain: "grass" }, 0)).toBe(map);
    expect(paintTile(map, 999, { kind: "terrain", terrain: "water" }, 0)).toBe(map);
  });

  it("clears owner, building and unit when terrain becomes non-ownable", () => {
    let m = paintTile(map, 0, { kind: "owner", owner: 1 }, 0);
    m = paintTile(m, 0, { kind: "building", building: "city" }, 0);
    expect(m.tiles[0]).toMatchObject({ owner: 1, building: "city" });
    m = paintTile(m, 0, { kind: "terrain", terrain: "mountain" }, 0);
    expect(m.tiles[0]).toMatchObject({ terrain: "mountain", owner: null, building: null, unit: null });
  });

  it("sets and removes graveAge with the grave terrain", () => {
    const grave = paintTile(map, 0, { kind: "terrain", terrain: "grave" }, 0);
    expect(grave.tiles[0]?.graveAge).toBe(0);
    const back = paintTile(grave, 0, { kind: "terrain", terrain: "sand" }, 0);
    expect("graveAge" in back.tiles[0]!).toBe(false);
  });

  it("owner brush only works on ownable terrain and known seats", () => {
    const water = paintTile(map, 0, { kind: "terrain", terrain: "water" }, 0);
    expect(paintTile(water, 0, { kind: "owner", owner: 0 }, 0)).toBe(water);
    expect(paintTile(map, 0, { kind: "owner", owner: 5 }, 0)).toBe(map);
    expect(paintTile(map, 0, { kind: "owner", owner: 1 }, 0).tiles[0]?.owner).toBe(1);
  });

  it("neutralising a tile removes its unit and owned buildings but keeps a chest", () => {
    let m = paintTile(map, 0, { kind: "owner", owner: 0 }, 0);
    m = paintTile(m, 0, { kind: "unit", level: 2 }, 0);
    expect(m.tiles[0]?.unit).toEqual({ level: 2 });
    m = paintTile(m, 0, { kind: "owner", owner: null }, 0);
    expect(m.tiles[0]).toMatchObject({ owner: null, unit: null });

    let c = paintTile(map, 1, { kind: "building", building: "chest" }, 0);
    expect(c.tiles[1]?.owner).toBeNull();
    c = paintTile(c, 1, { kind: "owner", owner: 1 }, 0);
    c = paintTile(c, 1, { kind: "owner", owner: null }, 0);
    expect(c.tiles[1]?.building).toBe("chest");
  });

  it("a city or unit dropped on neutral land takes the active owner", () => {
    const city = paintTile(map, 4, { kind: "building", building: "city" }, 1);
    expect(city.tiles[4]).toMatchObject({ building: "city", owner: 1 });
    const knight = paintTile(map, 5, { kind: "unit", level: 4 }, 7);
    // Active owner beyond the seat count is clamped to the last seat.
    expect(knight.tiles[5]).toMatchObject({ unit: { level: 4 }, owner: 1 });
  });

  it("a building replaces a unit and vice versa; the eraser clears both plus overlays", () => {
    let m = paintTile(map, 0, { kind: "unit", level: 1 }, 0);
    m = paintTile(m, 0, { kind: "building", building: "farm" }, 0);
    expect(m.tiles[0]).toMatchObject({ unit: null, building: "farm" });
    m = paintTile(m, 0, { kind: "unit", level: 3 }, 0);
    expect(m.tiles[0]).toMatchObject({ unit: { level: 3 }, building: null });
    m = paintTile(m, 0, { kind: "road" }, 0);
    m = paintTile(m, 0, { kind: "decoration", decoration: "rock" }, 0);
    expect(m.tiles[0]).toMatchObject({ road: true, decoration: "rock" });
    m = paintTile(m, 0, { kind: "eraser" }, 0);
    expect(m.tiles[0]).toMatchObject({ unit: null, building: null, road: false, decoration: null, owner: 0 });
  });

  it("road toggles and is refused on water; decoration is refused off plain ground", () => {
    const on = paintTile(map, 0, { kind: "road" }, 0);
    expect(on.tiles[0]?.road).toBe(true);
    expect(paintTile(on, 0, { kind: "road" }, 0).tiles[0]?.road).toBe(false);
    const water = paintTile(map, 0, { kind: "terrain", terrain: "water" }, 0);
    expect(paintTile(water, 0, { kind: "road" }, 0)).toBe(water);
    expect(paintTile(water, 0, { kind: "decoration", decoration: "bush" }, 0)).toBe(water);
  });
});

describe("resizeMap", () => {
  it("preserves overlapping content and fills new tiles with the biome's ground", () => {
    let m = blankMap(6, 6, "desert", 2);
    m = paintTile(m, indexOf(m, 1, 2), { kind: "building", building: "city" }, 0);

    let bigger = resizeMap(m, 8, 7);
    bigger = paintTile(bigger, indexOf(bigger, 7, 6), { kind: "terrain", terrain: "water" }, 0);
    expect(bigger.tiles).toHaveLength(56);
    expect(bigger.tiles[indexOf(bigger, 7, 6)]?.terrain).toBe("water");
    expect(bigger.tiles[indexOf(bigger, 1, 2)]?.building).toBe("city");
    expect(bigger.tiles[indexOf(bigger, 6, 6)]?.terrain).toBe("sand");

    const smaller = resizeMap(bigger, 6, 6);
    expect(smaller.tiles).toHaveLength(36);
    // (7,6) was water in the 8×7 map and falls off; (5,5) was never water here.
    expect(bigger.tiles.some((t) => t.terrain === "water")).toBe(true);
    expect(smaller.tiles[indexOf(smaller, 1, 2)]?.building).toBe("city");
    expect(smaller.tiles.some((t) => t.terrain === "water")).toBe(false);
  });

  it("clamps to 6..40 and is a no-op at the same size", () => {
    const m = blankMap(6, 6, "grass", 2);
    expect(resizeMap(m, 6, 6)).toBe(m);
    expect(resizeMap(m, 2, 99)).toMatchObject({ width: 6, height: 40 });
  });

  it("drops tutorial highlights that fall off the map", () => {
    const m: MapDefinition = {
      ...blankMap(8, 8, "grass", 2),
      tutorial: [
        { triggerId: "levelIntro", text: "HI", highlightTile: { x: 7, y: 7 } },
        { triggerId: "victory", text: "YAY" },
      ],
    };
    const shrunk = resizeMap(m, 6, 6);
    expect(shrunk.tutorial).toHaveLength(1);
  });
});

describe("players / biome / fill", () => {
  it("setPlayerCount adds seats in colour order and neutralises removed seats' tiles", () => {
    let m = blankMap(6, 6, "grass", 2);
    m = setPlayerCount(m, 4);
    expect(m.players.map((p) => p.colour)).toEqual(["blue", "red", "green", "yellow"]);
    m = paintTile(m, 0, { kind: "owner", owner: 3 }, 0);
    m = paintTile(m, 0, { kind: "building", building: "city" }, 0);
    m = setPlayerCount(m, 2);
    expect(m.players).toHaveLength(2);
    expect(m.tiles[0]).toMatchObject({ owner: null, building: null });
    expect(setPlayerCount(m, 1).players).toHaveLength(2);
    expect(setPlayerCount(m, 9).players).toHaveLength(8);
  });

  it("setStartGold floors and bounds", () => {
    const m = setStartGold(blankMap(6, 6, "grass", 2), 1, 42.9);
    expect(m.players[1]?.startGold).toBe(42);
    expect(setStartGold(m, 0, -5).players[0]?.startGold).toBe(0);
  });

  it("setBiome swaps the ground terrain only", () => {
    let m = blankMap(6, 6, "grass", 2);
    m = paintTile(m, 0, { kind: "terrain", terrain: "water" }, 0);
    const snow = setBiome(m, "snow");
    expect(snow.tiles[0]?.terrain).toBe("water");
    expect(snow.tiles[1]?.terrain).toBe("snow");
    expect(setBiome(snow, "snow")).toBe(snow);
  });

  it("fillMap and clearMap reset every tile", () => {
    const m = paintTile(defaultDraft(), 0, { kind: "terrain", terrain: "water" }, 0);
    const water = fillMap(m, "water");
    expect(water.tiles.every((t) => t.terrain === "water" && t.owner === null)).toBe(true);
    const cleared = clearMap(m);
    expect(cleared.tiles.every((t) => t.terrain === "grass" && t.building === null)).toBe(true);
  });
});
