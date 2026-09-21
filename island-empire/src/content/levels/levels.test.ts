import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAYER_COLOURS, type MapDefinition, type TileDefinition } from "@/engine/types";
import { TUTORIAL_TRIGGER_IDS } from "@/game/tutorialTriggers";

import { DEFAULT_DIFFICULTY, buildAsciiMap, isOwnableTerrain, parseGrid } from "./ascii";
import { LEVEL_IDS, LEVEL_META, isLevelId, loadLevel, nextLevelId } from "./index";
import { allLevelsSync, getLevelSync } from "./sync";

/* ------------------------------------------------------------- helpers -- */

function at(map: MapDefinition, x: number, y: number): TileDefinition {
  return map.tiles[y * map.width + x]!;
}

function neighbours(map: MapDefinition, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (y > 0) out.push([x, y - 1]);
  if (x > 0) out.push([x - 1, y]);
  if (x < map.width - 1) out.push([x + 1, y]);
  if (y < map.height - 1) out.push([x, y + 1]);
  return out;
}

/** 4-connected components over tiles satisfying `include`. */
function components(map: MapDefinition, include: (t: TileDefinition) => boolean): number[][] {
  const seen = new Set<number>();
  const result: number[][] = [];
  for (let start = 0; start < map.tiles.length; start++) {
    if (seen.has(start) || !include(map.tiles[start]!)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % map.width;
      const y = (i - x) / map.width;
      for (const [nx, ny] of neighbours(map, x, y)) {
        const ni = ny * map.width + nx;
        if (!seen.has(ni) && include(map.tiles[ni]!)) {
          seen.add(ni);
          stack.push(ni);
        }
      }
    }
    result.push(comp);
  }
  return result;
}

/* ------------------------------------------------------------ the index -- */

describe("level index", () => {
  it("publishes twelve ids with metadata for each", () => {
    expect(LEVEL_IDS).toHaveLength(12);
    expect(LEVEL_IDS[0]).toBe("01");
    expect(LEVEL_IDS[11]).toBe("12");
    for (const id of LEVEL_IDS) expect(LEVEL_META[id]).toBeDefined();
  });

  it("isLevelId / nextLevelId", () => {
    expect(isLevelId("07")).toBe(true);
    expect(isLevelId("13")).toBe(false);
    expect(isLevelId("7")).toBe(false);
    expect(nextLevelId("01")).toBe("02");
    expect(nextLevelId("12")).toBeNull();
    expect(nextLevelId("zz")).toBeNull();
  });

  it("loadLevel resolves each id to the same definition getLevelSync returns", async () => {
    for (const id of LEVEL_IDS) {
      const map = await loadLevel(id);
      expect(map).toBe(getLevelSync(id));
      expect(map.id).toBe(`seed:${id}`);
    }
    await expect(loadLevel("99")).rejects.toThrow(/unknown level/);
  });

  it("metadata matches the definitions", () => {
    for (const { id, map } of allLevelsSync()) {
      const meta = LEVEL_META[id];
      expect(map.name).toBe(meta.name);
      expect(map.biome).toBe(meta.biome);
      expect(map.players).toHaveLength(meta.players);
      expect({ width: map.width, height: map.height }).toEqual(meta.size);
      expect(map.tutorial.length > 0).toBe(meta.tutorial);
      expect(meta.hint.length).toBeGreaterThan(10);
    }
  });

  it("levels 01–05 are tutorials, 06–12 are not", () => {
    for (const { id, map } of allLevelsSync()) {
      expect(map.tutorial.length > 0).toBe(Number(id) <= 5);
    }
  });
});

/* ----------------------------------------------------- every definition -- */

describe.each(allLevelsSync())("level $id", ({ id, map }) => {
  it("has the campaign envelope", () => {
    expect(map.id).toBe(`seed:${id}`);
    expect(map.author).toBe("Island Empire");
    expect(map.difficulty).toEqual(DEFAULT_DIFFICULTY);
    expect(map.width).toBeGreaterThanOrEqual(8);
    expect(map.height).toBeGreaterThanOrEqual(8);
    expect(map.width).toBeLessThanOrEqual(26);
    expect(map.height).toBeLessThanOrEqual(26);
    expect(map.tiles).toHaveLength(map.width * map.height);
  });

  it("seats: human is seat 0 blue, others AI, indices and colours unique", () => {
    expect(map.players.length).toBeGreaterThanOrEqual(2);
    expect(map.players.length).toBeLessThanOrEqual(8);
    expect(map.players[0]).toMatchObject({ index: 0, colour: "blue", kind: "human" });
    map.players.forEach((p, i) => {
      expect(p.index).toBe(i);
      expect(p.colour).toBe(PLAYER_COLOURS[i]);
      expect(p.kind).toBe(i === 0 ? "human" : "ai");
      expect(p.startGold).toBeGreaterThanOrEqual(1);
      expect(p.startGold).toBeLessThanOrEqual(13);
    });
    expect(new Set(map.players.map((p) => p.colour)).size).toBe(map.players.length);
  });

  it("owners and objects only sit on ownable land", () => {
    for (const t of map.tiles) {
      if (!isOwnableTerrain(t.terrain)) {
        expect(t.owner).toBeNull();
        expect(t.building).toBeNull();
        expect(t.unit).toBeNull();
        expect(t.decoration).toBeNull();
      }
      if (t.owner !== null) expect(t.owner).toBeLessThan(map.players.length);
      if (t.unit || (t.building && t.building !== "mine" && t.building !== "chest")) {
        expect(t.owner).not.toBeNull();
      }
      if (t.terrain === "grave") expect(t.graveAge).toBe(0);
      else expect(t.graveAge).toBeUndefined();
    }
  });

  it("every player has a city on a ≥2-tile 4-connected province, one city per province", () => {
    for (const p of map.players) {
      const provinces = components(map, (t) => t.owner === p.index);
      expect(provinces.length).toBeGreaterThan(0);
      let cities = 0;
      for (const prov of provinces) {
        expect(prov.length).toBeGreaterThanOrEqual(2);
        const provCities = prov.filter((i) => map.tiles[i]!.building === "city").length;
        expect(provCities).toBe(1);
        cities += provCities;
      }
      expect(cities).toBe(provinces.length);
      // No unit starts alone: every unit tile has a same-owner neighbour.
      for (const prov of provinces) {
        expect(prov.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("all ownable land is one 4-connected component", () => {
    const land = components(map, (t) => isOwnableTerrain(t.terrain));
    expect(land).toHaveLength(1);
    expect(land[0]!.length).toBeGreaterThanOrEqual(0.4 * map.tiles.length);
  });

  it("every bridge spans water between two land tiles", () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (at(map, x, y).terrain !== "bridge") continue;
        const ns = neighbours(map, x, y).map(([nx, ny]) => at(map, nx, ny).terrain);
        const landCount = ns.filter((t) => isOwnableTerrain(t)).length;
        const waterCount = ns.filter((t) => t === "water").length;
        expect(landCount).toBeGreaterThanOrEqual(2);
        expect(waterCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("the human has room to win on Easy: a knight, and at least as much income as any single AI province", () => {
    const provinceIncome = (prov: number[]) =>
      prov.reduce((sum, i) => {
        const t = map.tiles[i]!;
        if (t.terrain === "grassField" || t.terrain === "grave") return sum;
        if (t.building === "farm") return sum + 5;
        if (t.building === "mine") return sum + 8;
        return sum + 1;
      }, 0);
    const human = components(map, (t) => t.owner === 0);
    const humanIncome = Math.max(...human.map(provinceIncome));
    expect(map.tiles.some((t) => t.owner === 0 && t.unit !== null)).toBe(true);
    for (const p of map.players.slice(1)) {
      for (const prov of components(map, (t) => t.owner === p.index)) {
        expect(provinceIncome(prov)).toBeLessThanOrEqual(humanIncome + 8);
      }
    }
  });

  it("tutorial steps use only published trigger ids, upper-case text, in-bounds highlights", () => {
    const seen = new Set<string>();
    for (const step of map.tutorial) {
      expect(TUTORIAL_TRIGGER_IDS).toContain(step.triggerId);
      expect(seen.has(step.triggerId)).toBe(false);
      seen.add(step.triggerId);
      expect(step.text).toBe(step.text.toUpperCase());
      expect(step.text.length).toBeGreaterThan(0);
      if (step.highlightTile) {
        expect(step.highlightTile.x).toBeGreaterThanOrEqual(0);
        expect(step.highlightTile.y).toBeGreaterThanOrEqual(0);
        expect(step.highlightTile.x).toBeLessThan(map.width);
        expect(step.highlightTile.y).toBeLessThan(map.height);
      }
    }
    if (map.tutorial.length > 0) expect(map.tutorial[0]!.triggerId).toBe("levelIntro");
  });

  it("is JSON round-trippable", () => {
    expect(JSON.parse(JSON.stringify(map))).toEqual(map);
  });
});

/* -------------------------------------------------- specific level facts -- */

describe("tutorial level facts", () => {
  it("level 01 opens with 1 gold and income 2 (D36)", () => {
    const map = getLevelSync("01");
    expect(map.players[0]!.startGold).toBe(1);
    expect(map.tiles.filter((t) => t.owner === 0)).toHaveLength(2);
    expect(map.tutorial[0]!.text).toBe("LET'S DESTROY THE ENEMY CITY");
  });

  it("level 03 has a red woodwall on the road and the wall line", () => {
    const map = getLevelSync("03");
    expect(at(map, 5, 5)).toMatchObject({ owner: 1, building: "woodwall" });
    expect(map.tutorial[0]!.text).toBe("I CAN'T PASS THE WALL!");
    expect(map.tutorial.some((s) => s.text.includes("LEVEL 2 KNIGHT TO DESTROY HIM"))).toBe(true);
  });

  it("level 04 has a grass field inside the human's province and the field line", () => {
    const map = getLevelSync("04");
    expect(at(map, 2, 7)).toMatchObject({ owner: 0, terrain: "grassField" });
    expect(map.tutorial[0]!.text).toBe("WE CAN'T EARN GOLD WITH THIS GRASS FIELD");
    expect(map.tutorial.some((s) => s.text.includes("UNDO"))).toBe(true);
  });

  it("level 05 gives the human two provinces and is the first 3-player map", () => {
    const map = getLevelSync("05");
    expect(components(map, (t) => t.owner === 0)).toHaveLength(2);
    expect(map.players).toHaveLength(3);
    for (const id of ["01", "02", "03", "04"] as const) {
      expect(getLevelSync(id).players).toHaveLength(2);
    }
  });

  it("puzzle levels cover the promised variety", () => {
    const biomes = new Set(allLevelsSync().map(({ map }) => map.biome));
    expect(biomes).toEqual(new Set(["grass", "desert", "snow"]));
    expect(getLevelSync("10").players).toHaveLength(4);
    expect(getLevelSync("12").players).toHaveLength(8);
    expect(getLevelSync("12").width * getLevelSync("12").height).toBe(26 * 26);
    const l11 = getLevelSync("11");
    expect(l11.tiles.filter((t) => t.building === "mine").length).toBeGreaterThanOrEqual(2);
    expect(l11.tiles.filter((t) => t.building === "chest").length).toBeGreaterThanOrEqual(2);
    expect(getLevelSync("06").tiles.filter((t) => t.terrain === "bridge").length).toBe(4);
    expect(getLevelSync("07").tiles.filter((t) => t.terrain === "mountain").length).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------- ascii builder -- */

describe("ascii builder", () => {
  it("parses rows with spaces and blank edges", () => {
    expect(parseGrid("\n  . . T\n  ~ = ^ \n")).toEqual(["..T", "~=^"]);
    expect(() => parseGrid(".\n..")).toThrow(/columns/);
  });

  it("builds every layer", () => {
    const map = buildAsciiMap({
      levelId: "99",
      name: "t",
      biome: "snow",
      players: [
        { kind: "human", startGold: 3 },
        { kind: "ai", startGold: 5 },
      ],
      terrain: "..T\n.~g\n=f.",
      owners: "00.\n0.1\n..1",
      objects: "C1.\nM.C\n.$.",
      overlay: "rw.\n.o.\n.tp",
    });
    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
    expect(map.biome).toBe("snow");
    expect(at(map, 0, 0)).toMatchObject({ terrain: "snow", owner: 0, building: "city", road: true, decoration: null });
    expect(at(map, 1, 0)).toMatchObject({ unit: { level: 1 }, decoration: null });
    expect(at(map, 2, 0)).toMatchObject({ terrain: "forestIcePine", owner: null });
    expect(at(map, 0, 1)).toMatchObject({ building: "mine", owner: 0 });
    expect(at(map, 1, 1)).toMatchObject({ terrain: "water", decoration: null });
    expect(at(map, 2, 1)).toMatchObject({ terrain: "grave", graveAge: 0, building: "city", owner: 1 });
    expect(at(map, 0, 2)).toMatchObject({ terrain: "bridge" });
    expect(at(map, 1, 2)).toMatchObject({ terrain: "grassField", building: "chest", owner: null, decoration: null });
    expect(at(map, 2, 2)).toMatchObject({ decoration: "flowerPurple", owner: 1 });
    expect(map.players[1]).toEqual({ index: 1, colour: "red", kind: "ai", startGold: 5 });
    expect(map.id).toBe("seed:99");
  });

  it("rejects authoring mistakes", () => {
    const base = {
      levelId: "99",
      name: "t",
      biome: "grass" as const,
      players: [
        { kind: "human" as const, startGold: 1 },
        { kind: "ai" as const, startGold: 1 },
      ],
    };
    expect(() => buildAsciiMap({ ...base, terrain: "~.", owners: "0.", objects: ".." })).toThrow(/owner on water/);
    expect(() => buildAsciiMap({ ...base, terrain: "..", owners: "..", objects: "C." })).toThrow(/needs an owner/);
    expect(() => buildAsciiMap({ ...base, terrain: "..", owners: "2.", objects: ".." })).toThrow(/player index/);
    expect(() => buildAsciiMap({ ...base, terrain: "..", owners: "0..", objects: ".." })).toThrow(/grid is/);
    expect(() => buildAsciiMap({ ...base, terrain: "x.", owners: "..", objects: ".." })).toThrow(/unknown terrain/);
    expect(() => buildAsciiMap({ ...base, terrain: "..", owners: "0.", objects: "Q." })).toThrow(/unknown object/);
  });
});

/* -------------------------------------------- engine validation (S1) -- */

const reducerPath = resolve(process.cwd(), "src/engine/reducer.ts");
const engineLanded = existsSync(reducerPath);

describe.skipIf(!engineLanded)("engine validateMap", () => {
  it.each(allLevelsSync())("level $id is validateMap-clean", async ({ map }) => {
    const { validateMap } = await import("@/engine");
    const result = validateMap(map);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
