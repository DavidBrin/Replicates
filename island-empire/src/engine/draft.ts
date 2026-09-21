/**
 * Copy-on-write working copy of a `GameState` (SPEC §4 contract rule 4: apply
 * never mutates its input). `openDraft` shallow-copies the containers once;
 * `setTile` / `setProvince` / `setPlayer` replace the individual object they
 * touch with a patched copy, so untouched tiles, provinces and players are
 * shared structurally with the input state. `closeDraft` seals the result.
 */
import type {
  Action,
  EngineEvent,
  GameState,
  GameStateCore,
  Biome,
  PlayerState,
  Province,
  RuntimeTile,
} from "./types";

export interface Draft {
  width: number;
  height: number;
  biome: Biome;
  tiles: RuntimeTile[];
  provinces: Record<string, Province>;
  players: PlayerState[];
  activePlayerIndex: number;
  turnNumber: number;
  seed: number;
  outcome: { winner: number } | null;
  events: EngineEvent[];
}

export function openDraft(state: GameStateCore): Draft {
  return {
    width: state.width,
    height: state.height,
    biome: state.biome,
    tiles: state.tiles.slice(),
    provinces: { ...state.provinces },
    players: state.players.slice(),
    activePlayerIndex: state.activePlayerIndex,
    turnNumber: state.turnNumber,
    seed: state.rng.seed,
    outcome: state.outcome,
    events: [],
  };
}

export function coreOf(d: Draft): GameStateCore {
  return {
    width: d.width,
    height: d.height,
    biome: d.biome,
    tiles: d.tiles,
    provinces: d.provinces,
    players: d.players,
    activePlayerIndex: d.activePlayerIndex,
    turnNumber: d.turnNumber,
    rng: { seed: d.seed },
    outcome: d.outcome,
  };
}

export function closeDraft(
  d: Draft,
  history: Action[],
  turnStart: GameStateCore | null,
): GameState {
  return { ...coreOf(d), history, turnStart };
}

export function setTile(d: Draft, index: number, patch: Partial<RuntimeTile>): RuntimeTile {
  const updated = { ...(d.tiles[index] as RuntimeTile), ...patch };
  d.tiles[index] = updated;
  return updated;
}

export function setProvince(d: Draft, id: string, patch: Partial<Province>): Province {
  const updated = { ...(d.provinces[id] as Province), ...patch };
  d.provinces[id] = updated;
  return updated;
}

export function setPlayer(d: Draft, index: number, patch: Partial<PlayerState>): void {
  d.players[index] = { ...(d.players[index] as PlayerState), ...patch };
}

export function tileAt(d: Draft, index: number): RuntimeTile {
  return d.tiles[index] as RuntimeTile;
}
