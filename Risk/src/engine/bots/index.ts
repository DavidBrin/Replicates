/**
 * `@/engine/bots` — hour-one stub (SPEC §4.13). S2 replaces this file.
 */
import type { BotPersona, BotTier, GameState, MapDef, OddsTables, Rng, Seat } from "../types";
import type { GameView, TurnPlan } from "./types";

export type { GameView, TurnPlan } from "./types";

function pending(name: string): never {
  throw new Error(`S2 pending: ${name}`);
}

export const makeView: (
  state: GameState, map: MapDef, seat: Seat, persona: BotPersona, grudge?: Float32Array,
) => GameView = () => pending("makeView");

/** Pure; re-entered after each battle (D8). */
export const decideTurn: (view: GameView, odds: OddsTables, rng: Rng) => TurnPlan = () => pending("decideTurn");

/** One entry per seat, null for a human; persona ⊕ tier folded once at match start (D28). */
export const drawPersonas: (
  tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng,
) => readonly (BotPersona | null)[] = () => pending("drawPersonas");
