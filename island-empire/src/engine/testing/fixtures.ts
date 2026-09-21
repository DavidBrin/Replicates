/**
 * Test-only conveniences over `asciiMap`: build a state, apply a chain of
 * actions that must succeed, and read tiles / provinces by coordinate.
 */
import { createInitialState } from "../state";
import type { Action, GameState, Province, RuntimeTile, TileCoord } from "../types";
import { apply } from "../reducer";
import { asciiMap, type AsciiMapSpec } from "./asciiMap";

/** Pads a fixture with water rows / columns so it meets the 6×6 minimum of `validateMap`. */
export function padSpec(spec: AsciiMapSpec): AsciiMapSpec {
  const width = Math.max(6, spec.terrain[0]?.length ?? 0);
  const height = Math.max(6, spec.terrain.length);
  const pad = (rows: string[] | undefined, fill: string, blank: string): string[] => {
    const src = rows ?? spec.terrain.map(() => blank.repeat(spec.terrain[0]?.length ?? 0));
    const padded = src.map((r) => r + fill.repeat(width - r.length));
    while (padded.length < height) padded.push(fill.repeat(width));
    return padded;
  };
  return { ...spec, terrain: pad(spec.terrain, "~", "~"), owners: pad(spec.owners, ".", "."), objects: pad(spec.objects, ".", ".") };
}

export function stateFrom(spec: AsciiMapSpec, seed = 1): GameState {
  return createInitialState(asciiMap(padSpec(spec)), seed);
}

export function at(x: number, y: number): TileCoord {
  return { x, y };
}

export function tile(state: GameState, x: number, y: number): RuntimeTile {
  return state.tiles[y * state.width + x] as RuntimeTile;
}

export function provinceOf(state: GameState, x: number, y: number): Province {
  const id = tile(state, x, y).provinceId;
  if (id === null) throw new Error(`no province at (${x},${y})`);
  return state.provinces[id] as Province;
}

/** Applies each action, throwing on the first rule violation. */
export function run(state: GameState, ...actions: Action[]): GameState {
  let s = state;
  for (const a of actions) {
    const r = apply(s, a);
    if (r.error !== undefined) throw new Error(`${JSON.stringify(a)} rejected: ${r.error}`);
    s = r.state;
  }
  return s;
}

export const move = (from: TileCoord, to: TileCoord): Action => ({ type: "MOVE", unitAt: from, to });
export const buy = (item: Extract<Action, { type: "BUY" }>["item"], target: TileCoord): Action => ({ type: "BUY", item, at: target });
export const END: Action = { type: "END_TURN" };
export const UNDO: Action = { type: "UNDO" };

/** Ends seat 0's turn and every other seat's, returning to seat 0's next turn start. */
export function fullRound(state: GameState): GameState {
  let s = run(state, END);
  while (s.activePlayerIndex !== 0 && s.outcome === null) s = run(s, END);
  return s;
}
