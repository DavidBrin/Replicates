/**
 * `@/engine` — the public API (SPEC §4.10).
 *
 * Hour-one stub: every function throws "S1 pending" until the engine slice
 * lands; the TYPES are real. Stubs are typed consts so the signatures below
 * are the contract S2–S5 compile against.
 */

import type {
  Action, ActionKind, ApplyResult, Card, CardBonusScheme, ContinentId, DiceAugment, GameState, MapDef,
  RuleError, Seat, TerritoryId,
} from "./types";

export * from "./types";
export * from "./resolver";
export { pcg32, rngFor } from "./prng";

function pending(name: string): never {
  throw new Error(`S1 pending: ${name}`);
}

/** Folds `GAME_STARTED` into an empty board. The map must already be loaded. */
export const createInitialState: (
  map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>,
) => GameState = () => pending("createInitialState");

/** The one door into the rules. Pure, total, non-mutating (R86–R88). */
export const apply: (state: GameState, map: MapDef, action: Action) => ApplyResult = () => pending("apply");

/** Why `action` would be refused, or null. Never mutates and never throws. */
export const validate: (state: GameState, map: MapDef, action: Action) => RuleError | null = () =>
  pending("validate");

/** The action kinds `seat` may submit right now, in a stable order. */
export const legalActions: (state: GameState, map: MapDef, seat: Seat) => readonly ActionKind[] = () =>
  pending("legalActions");

// ---- selectors the UI and the bots share ----
export const reinforcementsFor: (
  state: GameState, map: MapDef, seat: Seat,
) => { base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number } =
  () => pending("reinforcementsFor");
export const legalAttackTargets: (state: GameState, map: MapDef, from: TerritoryId) => readonly TerritoryId[] =
  () => pending("legalAttackTargets");
export const legalFortifyMoves: (state: GameState, map: MapDef, from: TerritoryId) => readonly TerritoryId[] =
  () => pending("legalFortifyMoves");
export const legalDraftTargets: (state: GameState, seat: Seat) => readonly TerritoryId[] = () =>
  pending("legalDraftTargets");
export const cardSets: (cards: readonly Card[]) => readonly (readonly [string, string, string])[] = () =>
  pending("cardSets");
/** The value of ONE set (R22); see SPEC §4.10 for why it takes cards, not a state. */
export const cardTradeValue: (cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme) => number =
  () => pending("cardTradeValue");
export const mustTradeNow: (state: GameState, seat: Seat) => boolean = () => pending("mustTradeNow");
export const diceAugmentFor: (state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId) => DiceAugment =
  () => pending("diceAugmentFor");
export const dicePlan: (
  state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId,
) => { maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4 } = () => pending("dicePlan");
/** By seat; `null` where fog hides the total from the viewer (R73). */
export const territoryCounts: (state: GameState) => readonly (number | null)[] = () => pending("territoryCounts");
export const troopCounts: (state: GameState) => readonly (number | null)[] = () => pending("troopCounts");
export const continentsHeldBy: (state: GameState, map: MapDef, seat: Seat) => readonly ContinentId[] = () =>
  pending("continentsHeldBy");
export const isGameOver: (state: GameState) => boolean = () => pending("isGameOver");

// ---- fog, hashing, serialisation ----
/** Masks other hands always and fogged territories when `rules.fogOfWar`; sets `fogged: true`. */
export const viewFor: (state: GameState, map: MapDef, seat: Seat) => GameState = () => pending("viewFor");
/** Canonical hash; asserts `state.fogged === false` (D16, F36). */
export const hashState: (state: GameState) => string = () => pending("hashState");
export const canonicalize: (state: GameState) => string = () => pending("canonicalize");
export const serializeState: (state: GameState) => string = () => pending("serializeState");
export const deserializeState: (json: string) => GameState = () => pending("deserializeState");
