/**
 * Every shared type of the game engine. This file is the FIRST published
 * contract (SPEC §4, §12): S2–S5 compile against it before the engine has a
 * single rule implemented. Changing a name or a field here is a cross-slice
 * change and must be announced.
 *
 * The engine is pure: nothing in `src/engine/**` may import React, Next, the
 * DOM, or any other layer, and nothing may call `Math.random`, `Date.now`
 * or `performance.now` (see `layering.test.ts`).
 */

/* ------------------------------------------------------------ the board -- */

export type Biome = "grass" | "desert" | "snow";

export type Terrain =
  | "grass"
  | "sand"
  | "snow"
  | "water"
  | "bridge"
  | "grassField"
  | "grave"
  | "forestPine"
  | "forestPalm"
  | "forestIcePine"
  | "mountain";

export type Building = "city" | "farm" | "mine" | "chest" | "woodwall" | "stoneTower";

export type Decoration = "rock" | "flowerWhite" | "flowerPurple" | "bush" | "tree";

export type UnitLevel = 1 | 2 | 3 | 4;

export type PlayerColour =
  | "blue"
  | "red"
  | "green"
  | "yellow"
  | "purple"
  | "pink"
  | "orange"
  | "grey";

/** Seat order is colour order: seat 0 is always blue (SPEC §8). */
export const PLAYER_COLOURS: readonly PlayerColour[] = [
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "pink",
  "orange",
  "grey",
];

export type Difficulty = "easy" | "normal" | "hard";

export interface TileCoord {
  x: number;
  y: number;
}

/* -------------------------------------------------------- map definition -- */

export interface TileDefinition {
  terrain: Terrain;
  /** Index into `players[]`, or `null` for neutral land / non-ownable terrain. */
  owner: number | null;
  building: Building | null;
  unit: { level: UnitLevel } | null;
  decoration: Decoration | null;
  /** Cosmetic road overlay, independent of terrain. */
  road: boolean;
  /** Present only when `terrain === "grave"`. */
  graveAge?: 0 | 1;
}

export interface PlayerSlotDefinition {
  /** 0..7 — also the seat and colour order. */
  index: number;
  colour: PlayerColour;
  /** `"empty"` is only valid before a game starts (random / hot-seat setup). */
  kind: "human" | "ai" | "empty";
  startGold: number;
}

/**
 * The exhaustive set of tutorial trigger ids the game runner (S2) emits.
 * Content (S3) may only reference these. See `src/game/tutorialTriggers.ts`
 * for the documentation of when each fires.
 */
export type TutorialTriggerId =
  | "levelIntro"
  | "turnStart:1"
  | "turnStart:2"
  | "turnStart:3"
  | "turnStart:5"
  | "unitSelected:first"
  | "unitMoved:first"
  | "captured:first"
  | "attackBlocked:defence"
  | "attackBlocked:wall"
  | "notEnoughGold"
  | "bought:first"
  | "bought:woodwall"
  | "bought:farm"
  | "merged:first"
  | "fieldCleared:first"
  | "enemyCityCaptured"
  | "victory"
  | "defeat";

export interface TutorialStep {
  triggerId: TutorialTriggerId;
  /** Upper-case speech-bubble copy, e.g. "LET'S DESTROY THE ENEMY CITY". */
  text: string;
  /** Tile the bubble's tail points at; omitted = anchored to the HUD. */
  highlightTile?: TileCoord;
}

export interface DifficultyTuning {
  /** Multiplies every AI seat's `startGold`; default table 0.5 / 1 / 1.5. */
  aiStartGoldMultiplier: number;
}

export interface MapDefinition {
  /** `null` for an unsaved editor draft; a nanoid once persisted. */
  id: string | null;
  name: string;
  /** Free-text display name, no accounts. */
  author: string;
  /** 6..40 */
  width: number;
  /** 6..40 */
  height: number;
  biome: Biome;
  /** length === width*height, row-major: index = y*width + x */
  tiles: TileDefinition[];
  /** 2..8 */
  players: PlayerSlotDefinition[];
  /** [] for non-tutorial maps */
  tutorial: TutorialStep[];
  /** null for non-campaign maps */
  difficulty: Record<Difficulty, DifficultyTuning> | null;
}

/** What `/api/maps` lists (SPEC §6). */
export interface MapSummary {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  biome: Biome;
  players: number;
  createdAt: string;
}

/* ----------------------------------------------------------- game state -- */

export interface RuntimeTile {
  x: number;
  y: number;
  terrain: Terrain;
  owner: number | null;
  building: Building | null;
  unit: { level: UnitLevel; readyToMove: boolean } | null;
  decoration: Decoration | null;
  road: boolean;
  graveAge: number;
  /** `null` for water/forest/mountain/unowned AND for lone (size-1) tiles. */
  provinceId: string | null;
}

export interface Province {
  id: string;
  owner: number;
  /** "x,y" keys, stable order = discovery order. */
  tileKeys: string[];
  city: TileCoord;
  gold: number;
}

export interface PlayerState {
  index: number;
  colour: PlayerColour;
  kind: "human" | "ai";
  aiDifficulty: Difficulty | null;
  eliminated: boolean;
}

/**
 * The engine's live, serialisable state. `turnStart` is the snapshot taken
 * after the acting player's turn-start pipeline ran; UNDO replays
 * `history.slice(0, -1)` from it (SPEC §3.7). It is `null` only before the
 * first turn begins.
 */
export interface GameState {
  width: number;
  height: number;
  biome: Biome;
  tiles: RuntimeTile[];
  provinces: Record<string, Province>;
  players: PlayerState[];
  activePlayerIndex: number;
  /** Increments when the active seat wraps back to seat 0. */
  turnNumber: number;
  rng: { seed: number };
  /** This turn's actions only; cleared on END_TURN. Never contains UNDO. */
  history: Action[];
  turnStart: GameStateCore | null;
  outcome: { winner: number } | null;
}

/** `GameState` without the undo bookkeeping — what a snapshot stores. */
export type GameStateCore = Omit<GameState, "history" | "turnStart">;

/* -------------------------------------------------------------- actions -- */

export type BuyItem =
  | "knight1"
  | "knight2"
  | "knight3"
  | "knight4"
  | "woodwall"
  | "stoneTower"
  | "farm";

export type Action =
  /**
   * The reducer classifies `to` by contents: empty own tile → reposition
   * (stays ready); own grass field / grave → clear (ends turn); own unit →
   * merge; enemy / neutral tile → attack if strength > defence (ends turn).
   */
  | { type: "MOVE"; unitAt: TileCoord; to: TileCoord }
  /**
   * knight1 on an empty own tile = peaceful build; knightN on an adjacent
   * capturable tile = attack-buy; knightN on a tile holding the buyer's own
   * unit = merge-buy; woodwall / stoneTower / farm only on an empty own tile.
   */
  | { type: "BUY"; item: BuyItem; at: TileCoord }
  | { type: "UNDO" }
  | { type: "END_TURN" };

/* --------------------------------------------------------------- events -- */

export type EngineEvent =
  | { type: "turnStarted"; player: number; turnNumber: number }
  | { type: "income"; provinceId: string; amount: number; city: TileCoord }
  | { type: "upkeepPaid"; provinceId: string; amount: number; city: TileCoord }
  | { type: "bankrupt"; provinceId: string; city: TileCoord }
  | { type: "starved"; at: TileCoord }
  | { type: "graveAged"; at: TileCoord; nowField: boolean }
  | { type: "moved"; from: TileCoord; to: TileCoord; player: number }
  | { type: "captured"; at: TileCoord; from: number | null; to: number; attackerFrom: TileCoord | null }
  | { type: "fieldCleared"; at: TileCoord }
  | { type: "cityDestroyed"; provinceId: string; owner: number; at: TileCoord }
  | { type: "buildingDestroyed"; at: TileCoord; building: Building; owner: number | null }
  | { type: "provinceSplit"; parentId: string; fragmentIds: string[] }
  | { type: "provinceMerged"; survivingId: string; absorbedIds: string[] }
  | { type: "merged"; at: TileCoord; newLevel: UnitLevel }
  | { type: "bought"; item: BuyItem; at: TileCoord; cost: number; provinceId: string }
  | { type: "chestCollected"; at: TileCoord; amount: number }
  | { type: "undone" }
  | { type: "turnEnded"; player: number }
  | { type: "eliminated"; player: number }
  | { type: "gameOver"; winner: number };

export interface ApplyResult {
  state: GameState;
  events: EngineEvent[];
  /** Set when the action was rejected; `state` is then the input state. */
  error?: string;
}

/* --------------------------------------------------- generator options -- */

export type MapSize = "small" | "medium" | "large";

/** Board dimensions per size (SPEC §3.9 / D16). */
export const MAP_SIZE_DIMENSIONS: Record<MapSize, { width: number; height: number }> = {
  small: { width: 12, height: 12 },
  medium: { width: 18, height: 18 },
  large: { width: 26, height: 26 },
};

export interface GeneratorOptions {
  size: MapSize;
  biome: Biome;
  /** One entry per seat, 2..8; seat order = colour order. */
  seats: Array<{ kind: "human" | "ai"; aiDifficulty?: Difficulty }>;
}

/* ------------------------------------------------------------- numbers -- */

/** Every gameplay number in one place (SPEC §3.2). */
export const RULES = {
  tileIncome: 1,
  farm: { baseCost: 12, costStep: 2, income: 5 },
  mine: { income: 8 },
  chest: { bonus: 10 },
  knight: {
    cost: { 1: 10, 2: 20, 3: 30, 4: 40 } as Record<UnitLevel, number>,
    upkeep: { 1: 2, 2: 5, 3: 12, 4: 30 } as Record<UnitLevel, number>,
  },
  woodwall: { cost: 5, upkeep: 0, strength: 2 },
  stoneTower: { cost: 15, upkeep: 1, strength: 3 },
  city: { strength: 1 },
  moveBudget: 4,
  graveTurnsToField: 2,
  defaultProvinceGold: 10,
  aiStartGoldMultiplier: { easy: 0.5, normal: 1, hard: 1.5 } as Record<Difficulty, number>,
  maxUnitLevel: 4 as UnitLevel,
} as const;
