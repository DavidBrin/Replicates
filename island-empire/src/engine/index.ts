/**
 * The engine's public API (SPEC §4). This is the FIRST published contract;
 * every function is typed here and implemented under `src/engine/**`. The
 * engine is pure and deterministic: no wall clock, no `Math.random`, no DOM,
 * and `apply` never mutates its input (see `layering.test.ts`).
 */
export * from "./types";

import type { Action, ApplyResult, BuyItem, GameState, GeneratorOptions, MapDefinition, Province, TileCoord } from "./types";
import { aiTakeTurn as aiTakeTurnImpl } from "./ai";
import { generateRandomMap as generateRandomMapImpl } from "./generator";
import { legalMoveZone as legalMoveZoneImpl } from "./moveZone";
import { apply as applyImpl } from "./reducer";
import {
  defenceNumber as defenceNumberImpl,
  legalBuildZone as legalBuildZoneImpl,
  provinceAt as provinceAtImpl,
} from "./rules";
import {
  deserializeMap as deserializeMapImpl,
  deserializeState as deserializeStateImpl,
  serializeMap as serializeMapImpl,
  serializeState as serializeStateImpl,
} from "./serialize";
import { createInitialState as createInitialStateImpl, type InitialStateOptions } from "./state";
import { validateMap as validateMapImpl } from "./validate";

export type { InitialStateOptions } from "./state";
export type { MoveZone } from "./moveZone";
export { computeMoveZone } from "./moveZone";
export {
  buyCost,
  canAttack,
  canMerge,
  farmPrice,
  provinceIncome,
  provinceUpkeep,
  provincesOf,
  strengthOn,
} from "./rules";
export { next as nextRandom } from "./prng";
export { BASE_TERRAIN, FOREST_TERRAIN, isOwnable, isBaseTerrain, isFieldOrGrave, neighbourIndices, tileIndex } from "./grid";
export { TUTORIAL_TRIGGER_IDS } from "./validate";

/**
 * Builds turn-0 state from a map; the first turn starts on the first apply.
 * The optional third parameter lets the runner override each seat's kind /
 * AI difficulty (the session's seats) and the campaign difficulty.
 */
export function createInitialState(map: MapDefinition, seed: number, options?: InitialStateOptions): GameState {
  return createInitialStateImpl(map, seed, options);
}

/** The one door into the rules: validates and applies one action. */
export function apply(state: GameState, action: Action): ApplyResult {
  return applyImpl(state, action);
}

/** Tiles a unit at `from` may be sent to this action (SPEC §3.4). */
export function legalMoveZone(state: GameState, from: TileCoord): TileCoord[] {
  return legalMoveZoneImpl(state, from);
}

/** Tiles where `item` may be placed by the active player right now. */
export function legalBuildZone(state: GameState, item: BuyItem): TileCoord[] {
  return legalBuildZoneImpl(state, item);
}

export function defenceNumber(state: GameState, at: TileCoord): number {
  return defenceNumberImpl(state, at);
}

export function provinceAt(state: GameState, at: TileCoord): Province | null {
  return provinceAtImpl(state, at);
}

export function isGameOver(state: GameState): boolean {
  return state.outcome !== null;
}

/** Whole AI turn as an ordered action list ending in END_TURN. Pure. */
export function aiTakeTurn(
  state: GameState,
  playerIndex: number,
  seed: number,
): { actions: Action[]; nextSeed: number } {
  return aiTakeTurnImpl(state, playerIndex, seed);
}

export function generateRandomMap(options: GeneratorOptions, seed: number): MapDefinition {
  return generateRandomMapImpl(options, seed);
}

export function validateMap(map: MapDefinition): { valid: boolean; errors: string[] } {
  return validateMapImpl(map);
}

export function serializeState(state: GameState): string {
  return serializeStateImpl(state);
}

export function deserializeState(json: string): GameState {
  return deserializeStateImpl(json);
}

export function serializeMap(map: MapDefinition): string {
  return serializeMapImpl(map);
}

export function deserializeMap(json: string): MapDefinition {
  return deserializeMapImpl(json);
}
