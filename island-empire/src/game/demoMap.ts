import type { MapDefinition, Terrain, TileDefinition } from "@/engine/types";

/**
 * A small built-in map for development and as the fallback when the content
 * loader (`src/content/levels/index.ts`, S3) is absent. Two seats on a
 * grass island split by a river with two bridges; exercises every terrain
 * the renderer draws.
 */

const ROWS = [
  "~~~~~~~~~~~~",
  "~FF...~..FF~",
  "~F....~...F~",
  "~.....~..MM~",
  "~..f..=....~",
  "~.....~....~",
  "~MM...~..f.~",
  "~.....=....~",
  "~FF...~..FF~",
  "~~~~~~~~~~~~",
];

const LEGEND: Record<string, Terrain> = {
  "~": "water",
  F: "forestPine",
  M: "mountain",
  ".": "grass",
  f: "grassField",
  "=": "bridge",
};

function blank(terrain: Terrain): TileDefinition {
  return { terrain, owner: null, building: null, unit: null, decoration: null, road: false };
}

export function buildDemoMap(): MapDefinition {
  const height = ROWS.length;
  const width = ROWS[0]?.length ?? 0;
  const tiles: TileDefinition[] = [];
  for (const row of ROWS) {
    for (const ch of row) tiles.push(blank(LEGEND[ch] ?? "grass"));
  }
  const at = (x: number, y: number) => tiles[y * width + x]!;
  const own = (x0: number, y0: number, x1: number, y1: number, owner: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = at(x, y);
        if (t.terrain === "grass" || t.terrain === "grassField" || t.terrain === "bridge") t.owner = owner;
      }
    }
  };
  own(1, 3, 4, 6, 0);
  own(8, 3, 10, 6, 1);
  at(2, 4).building = "city";
  at(2, 5).building = "farm";
  at(3, 4).unit = { level: 1 };
  at(4, 5).unit = { level: 2 };
  at(9, 4).building = "city";
  at(8, 4).unit = { level: 1 };
  at(9, 5).building = "woodwall";
  at(4, 1).building = "chest";
  at(8, 2).building = "mine";
  at(3, 6).building = "stoneTower";
  for (const [x, y] of [
    [3, 4],
    [4, 4],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 4],
  ] as const) {
    at(x, y).road = true;
  }
  at(3, 2).decoration = "flowerWhite";
  at(5, 3).decoration = "rock";
  at(8, 7).decoration = "bush";
  at(4, 8).decoration = "flowerPurple";
  at(10, 2).decoration = "tree";

  return {
    id: null,
    name: "Demo island",
    author: "Island Empire",
    width,
    height,
    biome: "grass",
    tiles,
    players: [
      { index: 0, colour: "blue", kind: "human", startGold: 10 },
      { index: 1, colour: "red", kind: "ai", startGold: 10 },
    ],
    tutorial: [
      { triggerId: "levelIntro", text: "LET'S DESTROY THE ENEMY CITY", highlightTile: { x: 9, y: 4 } },
      { triggerId: "unitSelected:first", text: "TAP A LIT TILE TO MOVE", highlightTile: { x: 3, y: 4 } },
      { triggerId: "captured:first", text: "WE SHOULD COLLECT MORE GOLD AND THEN ATTACK HIM" },
    ],
    difficulty: null,
  };
}

export const DEMO_MAP: MapDefinition = buildDemoMap();
