/**
 * `@/engine` — the public API (SPEC §4.10).
 *
 * **Every function that reasons about the board takes the `MapDef` as its
 * second parameter** (F1). `GameState` holds only `mapSlug` (§4.7), so there is
 * one shape across the whole API and no hidden global map. `hashState` is the
 * one deliberate exception: it takes the state alone and **never covers the
 * map** — two clients agreeing on a hash have agreed about the game, not about
 * the geometry.
 *
 * Nothing in here imports `@/engine/odds`, `@/engine/bots` or `@/engine/map`
 * (§4.2): the resolver takes an `OddsTables` as a parameter, so the dependency
 * direction stays one-way.
 */
export * from "./types";
export * from "./resolver";

/** The FUNCTIONS only. `Rng` and `RngPurpose` are types from `./types` (F13). */
export { pcg32, rngFor } from "./prng";

export { apply, createInitialState } from "./reducer";
export { validate } from "./validate";
export { legalActions, legalAttackTargets, legalDraftTargets, legalFortifyMoves } from "./legalActions";

// ---- selectors the UI and the bots share ----
export { continentsHeldBy } from "./continents";
export {
  isGameOver,
  reinforcementsFor,
  territoryCounts,
  territoryCountFor,
  troopCounts,
  troopCountFor,
} from "./rules";
export { cardSets, cardTradeValue, mustTradeNow } from "./cards";
export { diceAugmentFor, dicePlan } from "./modifiers";

// ---- fog, hashing, serialisation ----
export { viewFor } from "./fog";
export { canonicalize, hashState } from "./hash";
export { deserializeState, serializeState } from "./serialize";
