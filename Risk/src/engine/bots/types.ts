/** `@/engine/bots` types — SPEC §4.13, verbatim. S2 owns this file. */
import type {
  BotPersona, Card, MapDef, Phase, PortalState, Rules, Seat, Standing, TerritoryId,
} from "../types";

export interface GameView {
  readonly map: MapDef;
  readonly rules: Rules;
  /** The acting seat. `decideTurn` reads it from here — it is never also a parameter (F20). */
  readonly me: Seat;
  /** `me`'s persona, already folded with its tier (F10, F20). */
  readonly persona: BotPersona;
  readonly turn: number;
  readonly round: number;
  readonly phase: Phase;
  readonly owner: Int16Array;              // by TerritoryId; SEAT_* sentinels preserved
  readonly troops: Int16Array;             // beliefs, already inflated by persona.fogPessimism
  readonly known: Uint8Array;              // 1 when the true value is known
  readonly blizzard: Uint8Array;
  readonly portals: readonly PortalState[];
  readonly capital: Int16Array;            // by seat; -1 for none
  readonly territoryCount: Int16Array;     // by seat
  readonly troopCount: Int32Array;
  readonly cardCount: Int16Array;
  readonly myCards: readonly Card[];
  readonly allies: Uint8Array;             // by seat
  readonly standing: readonly Standing[];
  readonly troopsToPlace: number;
  readonly setsTradedTotal: number;
  readonly conqueredThisTurn: boolean;
  readonly grudge: Float32Array;           // by seat, carried across turns by the bot runner
}

export interface TurnPlan {
  readonly cardTrade: readonly [string, string, string] | null;
  readonly placements: readonly { readonly territory: TerritoryId; readonly count: number }[];
  readonly attacks: readonly {
    readonly from: TerritoryId; readonly to: TerritoryId;
    readonly mode: "blitz" | "manual";
    readonly attackerDice?: 1 | 2 | 3;     // manual only
    readonly stopUntil?: number;
    readonly moveIn: "min" | "max" | number;
  }[];
  readonly fortify: { readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number } | null;
  /** True when the plan is complete; false asks the runner to re-enter after the next battle. */
  readonly done: boolean;
}
