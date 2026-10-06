import type {
  Action, AttackIntent, BotPersona, DiceMode, GameConfig, GameState, MapDef, OddsTables, PortalState,
  Rng, Rules, Seat, TerritoryId,
} from "../types";

/** SPEC §4.11. The resolver is the only place randomness enters; it returns ACTIONS. S1 implements. */

function pending(name: string): never {
  throw new Error(`S1 pending: ${name}`);
}

/** The whole opening in R3's fixed order: seat order → blizzards + portals → deal → capitals. */
export const dealTerritories: (
  map: MapDef,
  config: GameConfig,
  personas: readonly (BotPersona | null)[],
  rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
) => Extract<Action, { type: "GAME_STARTED" }> = () => pending("dealTerritories");

/** Blizzards and portals only, before the deal (R10). */
export const placeModifiers: (
  map: MapDef, rules: Rules, rng: Rng,
) => { blizzards: readonly TerritoryId[]; portals: readonly PortalState[] } = () => pending("placeModifiers");

/** One `nextFloat()` for a Blitz, `attackerDice + defendDice` `nextU32()`s for a manual roll. */
export const rollAttack: (
  state: GameState, map: MapDef, intent: AttackIntent, rng: Rng, odds: OddsTables, diceMode: DiceMode,
) => Extract<Action, { type: "ATTACK" }> = () => pending("rollAttack");

export const drawCard: (
  state: GameState, map: MapDef, seat: Seat, rng: Rng,
) => Extract<Action, { type: "CARD_DRAWN" }> = () => pending("drawCard");

/** Null when no relocation is due this round (R76). */
export const movePortals: (
  state: GameState, map: MapDef, rng: Rng,
) => Extract<Action, { type: "PORTALS_MOVED" }> | null = () => pending("movePortals");
