/**
 * `@/engine/bots` — S2's own types (SPEC §4.13).
 *
 * `BotPersona` and `BotTier` are **declared in S1's `types.ts`**, because a folded persona is stored
 * inside `GameState` (F10, §4.2). `GameView`, `TurnPlan` and `BotWeights` are S2's and live here.
 */

import type {
  BotPersona, BotTier, Card, MapDef, Phase, PortalState, Rules, Seat, Standing, TerritoryId,
} from "@/engine";

/**
 * Flat read-model. Built from an authoritative state, or from `viewFor`'s output for honest bots.
 *
 * Typed arrays rather than objects because every heuristic in `score.ts` is a linear scan over
 * territories and seats, and a 42-territory `decideTurn` has a sub-millisecond budget (T13).
 */
export interface GameView {
  readonly map: MapDef;
  readonly rules: Rules;
  /** The acting seat. `decideTurn` reads it from here — it is never also a parameter (F20). */
  readonly me: Seat;
  /** `me`'s persona, already folded with its tier (F10, F20). Same rule: never also a parameter. */
  readonly persona: BotPersona;
  readonly turn: number;
  readonly round: number;
  readonly phase: Phase;
  readonly owner: Int16Array;              // by TerritoryId; SEAT_* sentinels preserved
  readonly troops: Int16Array;             // beliefs, already inflated by persona.fogPessimism
  readonly known: Uint8Array;              // 1 when the true value is known
  readonly blizzard: Uint8Array;
  /**
   * The live portal set, so the bot sees portal edges as attack adjacency and fortify reachability
   * exactly as the engine does (R68, R75, R76) — including `activeFrom`, so it does not plan an
   * attack through a portal that is inactive this round (F9).
   */
  readonly portals: readonly PortalState[];
  /**
   * By seat: that seat's capital, or -1 for none. Needed for the +1 defender die on the way in and
   * for Capitals' win condition on the way out (R72) (F9).
   */
  readonly capital: Int16Array;
  readonly territoryCount: Int16Array;     // by seat
  readonly troopCount: Int32Array;
  readonly cardCount: Int16Array;
  readonly myCards: readonly Card[];
  readonly allies: Uint8Array;             // by seat
  readonly standing: readonly Standing[];
  readonly troopsToPlace: number;
  /**
   * Sets traded in the whole game so far — the Progressive ladder's position (R22). Without it the
   * bot cannot price its own hand or a seizure, which is what `killValue` is (F9).
   */
  readonly setsTradedTotal: number;
  /**
   * Already conquered something this turn, so the end-of-turn card is already earned (R20) — the
   * difference between "attack for the card" and "attack for the territory" (F9).
   */
  readonly conqueredThisTurn: boolean;
  readonly grudge: Float32Array;           // by seat, carried across turns by the bot runner
}

export interface PlannedAttack {
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  readonly mode: "blitz" | "manual";
  readonly attackerDice?: 1 | 2 | 3;       // manual only
  readonly stopUntil?: number;
  readonly moveIn: "min" | "max" | number;
}

export interface TurnPlan {
  readonly cardTrade: readonly [string, string, string] | null;
  /**
   * Which of the traded set's matching territories takes R23's `+2`, or null for none.
   *
   * **[SPEC] — an addition to §4.13's `TurnPlan`, and an optional one.** `TRADE_CARDS` carries a
   * `bonusTerritory`, and the bot is the only thing in the system that knows which of its held
   * matches is the most threatened — so without this field the runner would have to re-derive a
   * decision the planner already made, with none of the planner's weights. Optional, so every
   * existing reader of §4.13's shape still compiles; `TurnPlan` is S2's own type (§4.2), so this is
   * not a change to S1's `types.ts`.
   */
  readonly cardTradeBonus?: TerritoryId | null;
  readonly placements: readonly { readonly territory: TerritoryId; readonly count: number }[];
  readonly attacks: readonly PlannedAttack[];
  readonly fortify: { readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number } | null;
  /** True when the plan is complete; false asks the runner to re-enter after the next battle. */
  readonly done: boolean;
}

/**
 * The brief gives the *formulae* and `wHold ≈ 2.0`; every other value here is **[SPEC]** — a tuning
 * default, not a sourced number, and the golden-replay hashes (§11, D55) are what pin them.
 */
export interface BotWeights {
  readonly wTerr: number;
  readonly wContComplete: number;
  readonly wKill: number;
  readonly wCard: number;
  readonly wAcquire: number;
  readonly wHold: number;
  readonly bsrTarget: number;
  readonly bsrFloor: number;
  readonly panicThreshold: number;
  readonly hostility: {
    readonly lead: number;
    readonly weak: number;
    readonly grudge: number;
    readonly cards: number;
    readonly prox: number;
    readonly turtle: number;
    readonly ally: number;
  };
}

export const DEFAULT_WEIGHTS: BotWeights = {
  wTerr: 1.0,
  wContComplete: 6.0,
  wKill: 1.0,
  wCard: 0.6,
  wAcquire: 0.35,
  wHold: 2.0, // the only sourced value
  bsrTarget: 0.67,
  bsrFloor: 0.35,
  panicThreshold: 0.25,
  hostility: { lead: 1.0, weak: 0.4, grudge: 0.25, cards: 0.3, prox: 0.5, turtle: 0.6, ally: 3.0 },
};

/** One row of the tier table. Each tier *adds*; nothing is removed. */
export interface TierRow {
  readonly pool: readonly string[];        // persona names this tier draws from
  readonly minWinChance: number | "dynamic";
  readonly blunderRate: number;
  readonly tierReserveFactor: number;
  readonly placement: BotPersona["placement"];
  readonly lookahead: 0 | 1 | 2;
  readonly usesExactOdds: boolean;
  readonly fogHonest: boolean;
  readonly fogPessimism: number;
  readonly allianceLoyalty: number;
  readonly seesKillForCards: boolean;
  readonly seesCardTradeTiming: boolean;
  readonly seesDominationThreshold: boolean;
  readonly antiBotBias: boolean;
}

/** The magnitude `antiBotBias: true` folds to. [SPEC] — the sources say only "yes"/"no". */
export const ANTI_BOT_BIAS = 0.5;

/** Every tier label, in difficulty order. */
export const BOT_TIERS: readonly BotTier[] = ["beginner", "easy", "medium", "hard", "expert"];

/**
 * Always a total comparator (§4.13, §7.2 rule 3).
 *
 * `Array.prototype.sort` is not stable across engines for a non-total order, and ties would reorder
 * — which is the most common source of "works on my machine" replay divergence. Every decision scan
 * in this directory sorts with this, score descending then id ascending, and **ties are broken by id
 * rather than by a PRNG draw**, which is what keeps `decideTurn`'s draw count at 0 in the common
 * path (F57).
 */
export interface Scored {
  readonly score: number;
  readonly id: number;
}

export function byScoreThenId(a: Scored, b: Scored): number {
  return b.score - a.score || a.id - b.id;
}
