/**
 * The engine's public API (SPEC §4). This is the FIRST published contract;
 * every function is typed here and implemented under `src/engine/**` by the
 * engine slice. Until then, the bodies throw so a caller can never mistake a
 * stub for a rule.
 */
export * from "./types";

import type {
  Action,
  ApplyResult,
  BuyItem,
  GameState,
  GeneratorOptions,
  MapDefinition,
  Province,
  TileCoord,
} from "./types";

function notImplemented(name: string): never {
  throw new Error(`engine: ${name} is not implemented yet`);
}

/** Builds turn-0 state from a map; the first turn starts on the first apply. */
export function createInitialState(map: MapDefinition, seed: number): GameState {
  void map;
  void seed;
  return notImplemented("createInitialState");
}

/** The one door into the rules: validates and applies one action. */
export function apply(state: GameState, action: Action): ApplyResult {
  void state;
  void action;
  return notImplemented("apply");
}

/** Tiles a unit at `from` may be sent to this action (SPEC §3.4). */
export function legalMoveZone(state: GameState, from: TileCoord): TileCoord[] {
  void state;
  void from;
  return notImplemented("legalMoveZone");
}

/** Tiles where `item` may be placed by the active player right now. */
export function legalBuildZone(state: GameState, item: BuyItem): TileCoord[] {
  void state;
  void item;
  return notImplemented("legalBuildZone");
}

export function defenceNumber(state: GameState, at: TileCoord): number {
  void state;
  void at;
  return notImplemented("defenceNumber");
}

export function provinceAt(state: GameState, at: TileCoord): Province | null {
  void state;
  void at;
  return notImplemented("provinceAt");
}

export function isGameOver(state: GameState): boolean {
  void state;
  return notImplemented("isGameOver");
}

/** Whole AI turn as an ordered action list ending in END_TURN. Pure. */
export function aiTakeTurn(
  state: GameState,
  playerIndex: number,
  seed: number,
): { actions: Action[]; nextSeed: number } {
  void state;
  void playerIndex;
  void seed;
  return notImplemented("aiTakeTurn");
}

export function generateRandomMap(options: GeneratorOptions, seed: number): MapDefinition {
  void options;
  void seed;
  return notImplemented("generateRandomMap");
}

export function validateMap(map: MapDefinition): { valid: boolean; errors: string[] } {
  void map;
  return notImplemented("validateMap");
}

export function serializeState(state: GameState): string {
  void state;
  return notImplemented("serializeState");
}

export function deserializeState(json: string): GameState {
  void json;
  return notImplemented("deserializeState");
}

export function serializeMap(map: MapDefinition): string {
  void map;
  return notImplemented("serializeMap");
}

export function deserializeMap(json: string): MapDefinition {
  void json;
  return notImplemented("deserializeMap");
}
