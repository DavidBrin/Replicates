/**
 * The narrow interface over `@/engine` the session runner calls through, so
 * tests can inject a scripted engine (SPEC §4.15, F33). S4 owns this file.
 */
import type {
  Action, ActionKind, ApplyResult, AttackIntent, BotPersona, Card, CardBonusScheme, ContinentId,
  DiceAugment, DiceMode, GameConfig, GameState, MapDef, OddsTables, Rng, RngPurpose, RuleError, Seat,
  TerritoryId,
} from "@/engine/types";
import * as engine from "@/engine";

export interface EngineApi {
  // ---- the rules ----
  createInitialState(map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>): GameState;
  apply(state: GameState, map: MapDef, action: Action): ApplyResult;
  validate(state: GameState, map: MapDef, action: Action): RuleError | null;
  legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[];

  // ---- the selectors the HUD and the runner actually read ----
  reinforcementsFor(state: GameState, map: MapDef, seat: Seat): {
    base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number;
  };
  legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
  legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
  legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[];
  /**
   * R6/R9 — which `CLAIM` the claim phase is waiting for. Added after S1 published: the runner
   * must not guess the 2-seat variant's own/neutral alternation, because `validate` enforces it.
   */
  claimOwed(state: GameState, seat: Seat): "own" | "neutral" | "none";
  legalNeutralClaimTargets(state: GameState): readonly TerritoryId[];
  legalOwnClaimTargets(state: GameState, seat: Seat): readonly TerritoryId[];
  cardSets(cards: readonly Card[]): readonly (readonly [string, string, string])[];
  cardTradeValue(cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme): number;
  mustTradeNow(state: GameState, seat: Seat): boolean;
  diceAugmentFor(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): DiceAugment;
  dicePlan(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): {
    maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4;
  };
  territoryCounts(state: GameState): readonly (number | null)[];
  troopCounts(state: GameState): readonly (number | null)[];
  /**
   * The exact counts for ONE seat. On a fogged view the array selectors above
   * return `null` for every seat, because no viewer can total a board it
   * cannot see; these two still answer for the **viewer's own** seat, which
   * is what its roster capsule shows (R73, F52). Added to `EngineApi` after
   * S1 published them — a widening, never a change.
   */
  territoryCountFor(state: GameState, seat: Seat): number;
  troopCountFor(state: GameState, seat: Seat): number;
  continentsHeldBy(state: GameState, map: MapDef, seat: Seat): readonly ContinentId[];
  isGameOver(state: GameState): boolean;

  // ---- fog, hashing, serialisation ----
  viewFor(state: GameState, map: MapDef, seat: Seat): GameState;
  hashState(state: GameState): string;
  serializeState(state: GameState): string;
  deserializeState(json: string): GameState;

  // ---- the resolver, plus the one PRNG entry point ----
  dealTerritories(
    map: MapDef, config: GameConfig, personas: readonly (BotPersona | null)[],
    rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
  ): Extract<Action, { type: "GAME_STARTED" }>;
  rollAttack(
    state: GameState, map: MapDef, intent: AttackIntent, rng: Rng,
    odds: OddsTables, diceMode: DiceMode,
  ): Extract<Action, { type: "ATTACK" }>;
  drawCard(
    state: GameState, map: MapDef, seat: Seat, rng: Rng,
  ): Extract<Action, { type: "CARD_DRAWN" }>;
  movePortals(
    state: GameState, map: MapDef, rng: Rng,
  ): Extract<Action, { type: "PORTALS_MOVED" }> | null;
  /**
   * The purpose-tagged sub-stream (D4). `index` is the **seq of the action being produced** — the
   * session's `nextSeq` — never `state.turn`, which changes once a turn and so handed every attack
   * in a turn the same dice. Personas and the opening deal use index 0.
   */
  rngFor(seed: string, purpose: RngPurpose, index: number): Rng;
}

/** The real one: every member bound straight from `@/engine`. */
export const engineApi: EngineApi = engine;
