import * as realEngine from "@/engine";
import type { InitialStateOptions } from "@/engine";
import type {
  Action,
  ApplyResult,
  BuyItem,
  GameState,
  MapDefinition,
  Province,
  TileCoord,
} from "@/engine/types";

/**
 * The slice of the engine the session runner calls, as an interface so a
 * test can inject a scripted `apply` and a fixture state.
 */
export interface EngineApi {
  createInitialState(map: MapDefinition, seed: number, options?: InitialStateOptions): GameState;
  apply(state: GameState, action: Action): ApplyResult;
  legalMoveZone(state: GameState, from: TileCoord): TileCoord[];
  legalBuildZone(state: GameState, item: BuyItem): TileCoord[];
  defenceNumber(state: GameState, at: TileCoord): number;
  provinceAt(state: GameState, at: TileCoord): Province | null;
  aiTakeTurn(state: GameState, playerIndex: number, seed: number): { actions: Action[]; nextSeed: number };
}

export const engine: EngineApi = realEngine;
