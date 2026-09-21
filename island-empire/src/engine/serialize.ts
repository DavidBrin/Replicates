/**
 * JSON round-trips for `GameState` and `MapDefinition` (SPEC §4). Both use a
 * versioned envelope `{ v: 1, ... }` so a future shape change can be migrated
 * rather than silently misread. `deserialize*` throws on a foreign envelope.
 */
import type { GameState, MapDefinition } from "./types";

export const STATE_FORMAT_VERSION = 1;
export const MAP_FORMAT_VERSION = 1;

export function serializeState(state: GameState): string {
  return JSON.stringify({ v: STATE_FORMAT_VERSION, state });
}

export function deserializeState(json: string): GameState {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("deserializeState: not an object");
  const env = parsed as { v?: unknown; state?: unknown };
  if (env.v !== STATE_FORMAT_VERSION) throw new Error(`deserializeState: unsupported version ${String(env.v)}`);
  const state = env.state as GameState;
  if (typeof state !== "object" || state === null || !Array.isArray(state.tiles) || typeof state.provinces !== "object") {
    throw new Error("deserializeState: malformed state");
  }
  return state;
}

export function serializeMap(map: MapDefinition): string {
  return JSON.stringify({ v: MAP_FORMAT_VERSION, map });
}

export function deserializeMap(json: string): MapDefinition {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("deserializeMap: not an object");
  const env = parsed as { v?: unknown; map?: unknown };
  if (env.v !== MAP_FORMAT_VERSION) throw new Error(`deserializeMap: unsupported version ${String(env.v)}`);
  const map = env.map as MapDefinition;
  if (typeof map !== "object" || map === null || !Array.isArray(map.tiles) || !Array.isArray(map.players)) {
    throw new Error("deserializeMap: malformed map");
  }
  return map;
}
