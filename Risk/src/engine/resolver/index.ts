/**
 * The resolver barrel (SPEC §4.11).
 *
 * The resolver is the **only** place randomness enters, and it never mutates
 * state: each function takes an explicit `Rng` and returns the **action whose
 * payload carries the outcome** (D2, D3, D4). `rollAttack` takes an
 * `OddsTables` as a *parameter*, so nothing here imports `@/engine/odds` and
 * the one-way dependency of §4.2 holds.
 *
 * `drawPersonas` is **not** a resolver (F3): it reads the persona literals and
 * the tier rows, both of which live in `src/engine/bots/`, so it is S2's. The
 * caller draws the personas and hands them to `dealTerritories`.
 */
export { dealTerritories } from "./dealTerritories";
export { placeModifiers } from "./placeModifiers";
export {
  rollAttack, combinedOutcomes, sampledOutcomes, stoppedOutcomes, walkCdf, quantise, QUANTISATION,
} from "./rollAttack";
export { drawCard } from "./drawCard";
export { movePortals, relocationDue } from "./movePortals";
