import {
  PLAYER_COLOURS,
  type Biome,
  type Building,
  type Decoration,
  type Difficulty,
  type DifficultyTuning,
  type MapDefinition,
  type PlayerSlotDefinition,
  type Terrain,
  type TileDefinition,
  type TutorialStep,
  type UnitLevel,
} from "@/engine/types";

/**
 * ASCII grid → `MapDefinition`, the way every seeded level is authored.
 *
 * This builder is deliberately self-contained (no engine test helpers, no
 * `src/engine/testing/*`): content must never depend on a test utility.
 *
 * A level is three (optionally four) grids of the same shape, one character
 * per tile, rows separated by newlines. Spaces inside a row are ignored so
 * rows can be written `. . T ~` for readability; blank leading/trailing lines
 * are dropped.
 *
 * ## Layer 1 — terrain
 * | char | terrain |
 * |---|---|
 * | `.` | the biome's base tile: grass / sand / snow |
 * | `~` | water |
 * | `=` | bridge (must sit between two land tiles) |
 * | `^` | mountain |
 * | `T` | forest — the biome's tree: pine / palm / ice-pine |
 * | `f` | grass field (ownable, earns 0 until a unit clears it) |
 * | `g` | grave (ownable, earns 0; `graveAge: 0`) |
 *
 * ## Layer 2 — owners
 * `0`–`7` = player index (seat 0 is always the blue human), `.` = neutral.
 * An owner on water / forest / mountain is an authoring error and throws.
 *
 * ## Layer 3 — objects
 * | char | object |
 * |---|---|
 * | `C` | city (needs an owner) |
 * | `F` | farm (needs an owner) |
 * | `M` | mine (owned or neutral) |
 * | `$` | chest (owned or neutral) |
 * | `W` | woodwall (needs an owner) |
 * | `S` | stone tower (needs an owner) |
 * | `1`–`4` | a knight of that level (needs an owner) |
 * | `.` | nothing |
 *
 * ## Layer 4 — overlay (optional, cosmetic)
 * | char | overlay |
 * |---|---|
 * | `r` | road |
 * | `o` | rock |
 * | `w` | white flower |
 * | `p` | purple flower |
 * | `b` | bush |
 * | `t` | lone tree (decoration, not a forest) |
 * | `.` | nothing |
 *
 * Decorations are only placed on ownable land (they are silently skipped on
 * water / forest / mountain so an overlay can be sketched freely).
 */

export const DEFAULT_DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: { aiStartGoldMultiplier: 0.5 },
  normal: { aiStartGoldMultiplier: 1 },
  hard: { aiStartGoldMultiplier: 1.5 },
};

export const LEVEL_AUTHOR = "Island Empire";

const BASE_TERRAIN: Record<Biome, Terrain> = { grass: "grass", desert: "sand", snow: "snow" };
const FOREST_TERRAIN: Record<Biome, Terrain> = {
  grass: "forestPine",
  desert: "forestPalm",
  snow: "forestIcePine",
};

const OWNABLE: ReadonlySet<Terrain> = new Set<Terrain>([
  "grass",
  "sand",
  "snow",
  "bridge",
  "grassField",
  "grave",
]);

/** Terrain a player may own and a unit may stand on (SPEC §3.1). */
export function isOwnableTerrain(terrain: Terrain): boolean {
  return OWNABLE.has(terrain);
}

export interface AsciiPlayer {
  kind: "human" | "ai";
  startGold: number;
}

export interface AsciiMapSpec {
  /** Level id such as `"03"`; the map id becomes `seed:03`. */
  levelId: string;
  name: string;
  biome: Biome;
  /** In seat order; index and colour are assigned from the position. */
  players: AsciiPlayer[];
  terrain: string;
  owners: string;
  objects: string;
  overlay?: string;
  tutorial?: TutorialStep[];
  /** Defaults to the campaign table; `null` makes a non-campaign map. */
  difficulty?: Record<Difficulty, DifficultyTuning> | null;
  author?: string;
}

/** Splits a grid literal into rows, dropping blank edge lines and inner spaces. */
export function parseGrid(grid: string): string[] {
  const rows = grid
    .split("\n")
    .map((row) => row.replace(/\s+/g, ""))
    .filter((row) => row.length > 0);
  if (rows.length === 0) throw new Error("ascii: empty grid");
  const width = rows[0]!.length;
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`ascii: row ${y} has ${row.length} columns, expected ${width}`);
    }
  });
  return rows;
}

function terrainFor(ch: string, biome: Biome, x: number, y: number): Terrain {
  switch (ch) {
    case ".":
      return BASE_TERRAIN[biome];
    case "~":
      return "water";
    case "=":
      return "bridge";
    case "^":
      return "mountain";
    case "T":
      return FOREST_TERRAIN[biome];
    case "f":
      return "grassField";
    case "g":
      return "grave";
    default:
      throw new Error(`ascii: unknown terrain '${ch}' at (${x},${y})`);
  }
}

function buildingFor(ch: string): Building | null {
  switch (ch) {
    case "C":
      return "city";
    case "F":
      return "farm";
    case "M":
      return "mine";
    case "$":
      return "chest";
    case "W":
      return "woodwall";
    case "S":
      return "stoneTower";
    default:
      return null;
  }
}

const DECORATIONS: Record<string, Decoration> = {
  o: "rock",
  w: "flowerWhite",
  p: "flowerPurple",
  b: "bush",
  t: "tree",
};

export function buildAsciiMap(spec: AsciiMapSpec): MapDefinition {
  const terrainRows = parseGrid(spec.terrain);
  const ownerRows = parseGrid(spec.owners);
  const objectRows = parseGrid(spec.objects);
  const overlayRows = spec.overlay ? parseGrid(spec.overlay) : null;

  const height = terrainRows.length;
  const width = terrainRows[0]!.length;
  const sameShape = (rows: string[], label: string) => {
    if (rows.length !== height || rows[0]!.length !== width) {
      throw new Error(`ascii: ${label} grid is ${rows[0]!.length}x${rows.length}, terrain is ${width}x${height}`);
    }
  };
  sameShape(ownerRows, "owners");
  sameShape(objectRows, "objects");
  if (overlayRows) sameShape(overlayRows, "overlay");

  if (spec.players.length < 2 || spec.players.length > 8) {
    throw new Error(`ascii: ${spec.players.length} players, expected 2..8`);
  }
  const players: PlayerSlotDefinition[] = spec.players.map((p, index) => ({
    index,
    colour: PLAYER_COLOURS[index]!,
    kind: p.kind,
    startGold: p.startGold,
  }));

  const tiles: TileDefinition[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const terrain = terrainFor(terrainRows[y]!.charAt(x), spec.biome, x, y);
      const ownable = isOwnableTerrain(terrain);

      const ownerCh = ownerRows[y]!.charAt(x);
      let owner: number | null = null;
      if (ownerCh !== ".") {
        owner = Number(ownerCh);
        if (!Number.isInteger(owner) || owner < 0 || owner >= players.length) {
          throw new Error(`ascii: owner '${ownerCh}' at (${x},${y}) is not a player index`);
        }
        if (!ownable) throw new Error(`ascii: owner on ${terrain} at (${x},${y})`);
      }

      const objCh = objectRows[y]!.charAt(x);
      let building: Building | null = null;
      let unit: { level: UnitLevel } | null = null;
      if (objCh !== ".") {
        if (!ownable) throw new Error(`ascii: object '${objCh}' on ${terrain} at (${x},${y})`);
        if (/^[1-4]$/.test(objCh)) {
          unit = { level: Number(objCh) as UnitLevel };
        } else {
          building = buildingFor(objCh);
          if (building === null) throw new Error(`ascii: unknown object '${objCh}' at (${x},${y})`);
        }
        const needsOwner = unit !== null || (building !== "mine" && building !== "chest");
        if (needsOwner && owner === null) {
          throw new Error(`ascii: '${objCh}' at (${x},${y}) needs an owner`);
        }
      }

      let decoration: Decoration | null = null;
      let road = false;
      if (overlayRows) {
        const ov = overlayRows[y]!.charAt(x);
        if (ov === "r") road = ownable;
        else if (ov !== ".") {
          const deco = DECORATIONS[ov];
          if (!deco) throw new Error(`ascii: unknown overlay '${ov}' at (${x},${y})`);
          if (ownable && building === null && unit === null) decoration = deco;
        }
      }

      const tile: TileDefinition = { terrain, owner, building, unit, decoration, road };
      if (terrain === "grave") tile.graveAge = 0;
      tiles.push(tile);
    }
  }

  return {
    id: `seed:${spec.levelId}`,
    name: spec.name,
    author: spec.author ?? LEVEL_AUTHOR,
    width,
    height,
    biome: spec.biome,
    tiles,
    players,
    tutorial: spec.tutorial ?? [],
    difficulty: spec.difficulty === undefined ? DEFAULT_DIFFICULTY : spec.difficulty,
  };
}
