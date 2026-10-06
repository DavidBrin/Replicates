/**
 * The engine's contract — every type and constant in SPEC §4.4–§4.10, verbatim.
 *
 * Published first so S2 (odds + bots), S3 (maps), S4 (session + screens) and
 * S5 (online) compile against one file. S1 owns it from here on; where this
 * file and the SPEC differ, this file wins and the change is announced.
 *
 * Nothing in here may import React, Next, zustand, zod, a sibling layer or a
 * clock — `layering.test.ts` enforces it.
 */

/* -------------------------------------------------------------- §4.4 identifiers and constants -- */

export type Seat = number;                  // 0 .. seats.length - 1
export type TerritoryId = number;           // index into MapDef.territories
export type ContinentId = number;           // index into MapDef.continents

export const SEAT_NONE = -1;                 // unowned: a blizzard tile, or pre-claim
export const SEAT_NEUTRAL = -2;              // the 2-player variant's neutral holding
export const SEAT_UNKNOWN = -3;              // hidden by fog (only ever present in a view)
export const TROOPS_UNKNOWN = -1;            // ditto
export const MAX_SEATS = 6;
export const RULESET_VERSION = 1 as const;

export type Phase = "claim" | "draft" | "attack" | "fortify" | "over";
export type Suit = "infantry" | "cavalry" | "artillery" | "wild";
export type DiceMode = "balancedBlitz" | "trueRandom";
export type CardBonusScheme = "fixed" | "progressive";
export type WinCondition = "world" | "percentage" | "capitals";
export type PortalMode = "off" | "stable" | "unstable";
export type Standing = "active" | "eliminated" | "resigned" | "away";
/** Only the two things a SEAT can be. The neutral holding is the SEAT_NEUTRAL sentinel, never a
 *  SeatState and never a SeatKind (R7, F17). */
export type SeatKind = "human" | "bot";
export type BotTier = "beginner" | "easy" | "medium" | "hard" | "expert";
export type PlayerColour =
  | "red" | "green" | "blue" | "yellow" | "orange" | "pink" | "black" | "white" | "purple";

/** Turn-timer options (R79). Online only. */
export const TURN_SECONDS = [60, 90, 120, 180, 300] as const;
/** Starting armies by seat count (R2); 2 seats use the 40/40/40 variant. */
export const STARTING_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
/** Fixed card values for a three-of-a-kind, by suit (R22). There is no three-of-a-kind in Wilds —
 *  the deck holds two — so `wild` has no entry and any set containing a Wild is FIXED_MIXED_VALUE. */
export const FIXED_SET_VALUE: Record<Exclude<Suit, "wild">, number> =
  { infantry: 4, cavalry: 6, artillery: 8 };
export const FIXED_MIXED_VALUE = 10;   // one-of-each, or any set containing a Wild
/** Progressive ladder (R22): index n-1 for the n-th set, then 15 + 5*(n-6). */
export const PROGRESSIVE_SET_VALUES = [4, 6, 8, 10, 12, 15] as const;
export const TERRITORY_BONUS = 2;
export const TERRITORY_BONUS_CAP = 2;
export const UNSTABLE_PORTAL_PERIOD = 3;     // relocate when round % 3 === 0 (R76)

/* -------------------------------------------------------------- §4.5 rng -- */

export type RngPurpose =
  | "deal" | "turnOrder" | "cardDeck" | "battle"
  | "modifierPlace" | "portalMove"
  | "personaAssign" | "personaJitter"
  | `bot:${number}`;                         // template-literal, built as `bot:${seat}` (F18)

export interface Rng {
  nextU32(): number;
  nextFloat(): number;                       // [0,1), = nextU32() / 2**32
  readonly state: readonly [number, number];
}

/* -------------------------------------------------------------- §4.5 dice augment, outcome distribution, odds tables -- */

export interface DiceAugment {
  readonly defendDiceBonus: number;          // +1 per capital / wall (R36)
  readonly attackDicePenalty: number;        // reserved for the Zombie augment
  readonly favourDefenderOnDraw: boolean;    // true in every in-scope mode; false = ties to attacker
}

/**
 * One terminal state of a battle the Attack Limiter stopped with **both sides alive** (R48).
 *
 * `unresolved` is the total of these; the breakdown is what lets the resolver name the actual
 * losses instead of guessing, so it is part of the published contract rather than S2's private
 * business (F46). Declared here, re-exported by `@/engine/odds`, so there is one shape.
 */
export interface StoppedOutcome {
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly p: number;
}

/** Terminal-state distribution of one whole battle (R40, R48). */
export interface OutcomeDist {
  readonly a: number;                        // A, excluding the garrison
  readonly d: number;
  /** attackLoss[i<A] = P(win having lost i); attackLoss[A] = P(lose the battle). */
  readonly attackLoss: Float64Array;
  /** defendLoss[j<D] = P(defender wins having lost j); defendLoss[D] = P(attacker wins). */
  readonly defendLoss: Float64Array;
  /** P(the Attack Limiter stopped the battle with both sides alive). 0 without `stopUntil`. */
  readonly unresolved: number;
  readonly winChance: number;
  /**
   * The per-pair breakdown of `unresolved`, sorted by `attackerLosses` then `defenderLosses`.
   *
   * **The stopped mass lives here and nowhere else**: `attackLoss` and `defendLoss` describe
   * resolved battles only, so without this tail the two arrays sum to `1 − unresolved` and a
   * sampling walk over them alone would silently drop the limiter's draws (F46). Optional
   * because a distribution with no limiter has nothing to break down.
   */
  readonly stopped?: readonly StoppedOutcome[];
}

/** The MINIMAL structural contract the resolver calls through. S2's `createOdds` returns something
 *  that satisfies it; S1 never constructs one and never looks inside. */
export interface OddsTables {
  readonly mode: DiceMode;
  winChance(a: number, d: number, aug?: DiceAugment): number;
  outcome(a: number, d: number, aug?: DiceAugment, stopUntil?: number): OutcomeDist;
  expectedAttackerLoss(a: number, d: number, aug?: DiceAugment): number;
  certainWin(a: number, d: number, aug?: DiceAugment): boolean;
}

/* -------------------------------------------------------------- §4.5 MapFile and MapDef -- */

// ---- on disk: src/content/maps/<slug>.json (S3 owns the files and the schema) ----
export interface MapFile {
  readonly slug: string;
  readonly name: string;
  readonly tagline?: string;
  readonly viewBox: string;                      // e.g. "0 8 1024 643"
  readonly continents: readonly {
    readonly id: string; readonly name: string; readonly bonus: number;
    readonly color: string;                      // the continent accent token value
    readonly territories: readonly string[];
  }[];
  readonly territories: readonly {
    readonly id: string; readonly name: string; readonly continent: string;
    /** The suit of this territory's card (R19). Authored, never derived at runtime, so a map's
     *  card deck is stable across builds. Validated by T7: the three counts differ by <= 1. */
    readonly suit: Exclude<Suit, "wild">;
    readonly adjacent: readonly string[];        // undirected LAND borders; symmetry is validated
    readonly d: string;                          // SVG path, 12-30 vertices (R-visual §8)
    readonly tokenX: number; readonly tokenY: number;   // pole of inaccessibility
    readonly labelX: number; readonly labelY: number;   // ~26px below the token
  }[];
  readonly seaLinks: readonly { readonly from: string; readonly to: string }[];
  readonly modifierSlots: {
    readonly blizzards: number;                  // 2..11
    readonly portals: number;                    // 3..7
    readonly capitals: number;                   // = MAX_SEATS on every shipped map [SPEC]
  };
}

// ---- loaded: the engine's view ----
export interface Territory {
  readonly index: TerritoryId;
  readonly id: string;
  readonly name: string;
  readonly continent: ContinentId;
  /**
   * The suit of this territory's card, carried through from `MapFile.suit`.
   *
   * [S1 CONTRACT CHANGE vs SPEC §4.5] `MapFile` authors a `suit` per territory
   * and R19 builds the deck from it, but the loaded `Territory` in §4.5 had no
   * field to carry it — so the engine had no way to build a map's deck at all.
   * Added as a required field: `loadMap` copies `MapFile.territories[].suit`
   * straight across. Nothing derives it at runtime.
   */
  readonly suit: Exclude<Suit, "wild">;
  /** EVERY neighbour: the file's land `adjacent` UNIONED with its `seaLinks` (F45). Sorted
   *  ascending (R91). This is the set attack adjacency and fortify reachability both read. */
  readonly adjacent: readonly TerritoryId[];
  readonly seaLinked: readonly TerritoryId[];    // the subset drawn as dashed routes; a subset of `adjacent`
  readonly d: string;
  readonly token: readonly [number, number];
  readonly label: readonly [number, number];
}

export interface Continent {
  readonly index: ContinentId;
  readonly id: string;
  readonly name: string;
  readonly bonus: number;
  readonly color: string;
  readonly territories: readonly TerritoryId[];  // sorted ascending
  readonly border: readonly TerritoryId[];       // territories with an external edge
}

export interface MapDef {
  readonly slug: string;
  readonly name: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly territories: readonly Territory[];
  readonly continents: readonly Continent[];
  readonly modifierSlots: MapFile["modifierSlots"];
  /** Row i lists i's static neighbours — land edges UNION sea links, matching Territory.adjacent
   *  exactly (F45). Portal edges are added at query time by graph.ts. */
  readonly adjacency: readonly (readonly TerritoryId[])[];
}

/* -------------------------------------------------------------- §4.6 Rules and GameConfig -- */

export interface Rules {
  readonly winCondition: WinCondition;
  readonly dominationThreshold: number;   // 0.50 .. 0.90, default 0.70 (R71)
  readonly cardBonus: CardBonusScheme;
  readonly diceMode: DiceMode;
  readonly fogOfWar: boolean;
  readonly capitals: boolean;
  readonly capitalDraftBonus: boolean;    // default false (R15)
  readonly blizzards: boolean;
  readonly portals: PortalMode;
  readonly manualPlacement: boolean;      // default false (R9)
  readonly maxRounds: number | null;      // 5 => "5-Rounds Rumble" (R77)
  readonly roundDelayMs: number;          // presentation pacing only; 0 by default
  readonly turnSeconds: number | null;    // online only; null offline (R79)
  readonly alliances: boolean;
  readonly aiDifficulty: BotTier;         // the pool every bot seat is drawn from
}

export const DEFAULT_RULES: Rules = {
  winCondition: "world", dominationThreshold: 0.7, cardBonus: "fixed",
  diceMode: "balancedBlitz", fogOfWar: false, capitals: false, capitalDraftBonus: false,
  blizzards: false, portals: "off", manualPlacement: false, maxRounds: null,
  roundDelayMs: 0, turnSeconds: null, alliances: false, aiDifficulty: "medium",
};

/** Everything that shapes an initial state. `seed` never reaches a client online (D5). */
export interface GameConfig {
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly seats: readonly SeatConfig[];   // 2..6
  readonly seed: string;
}

export interface SeatConfig {
  readonly kind: SeatKind;                 // "human" | "bot" — there is no neutral seat (R7)
  readonly name: string;
  readonly colour: PlayerColour;
  readonly tier: BotTier | null;           // non-null iff kind === "bot"
  readonly playerId?: string;              // online only
}

/* -------------------------------------------------------------- §4.7 Card, SeatState, GameState -- */

export interface Card {
  /** Stable, canonical id: a territory slug, or "wild-1" / "wild-2". */
  readonly id: string;
  readonly suit: Suit;
  readonly territory: TerritoryId | null;  // null iff suit === "wild"
}

/**
 * A persona ALREADY FOLDED WITH ITS TIER (F10). `drawPersonas` computes `persona ⊕ TIERS[tier]` once
 * at match start and stores the result; nothing downstream ever consults the tier row again, so a
 * bot's behaviour is fully described by this one object and a replay cannot drift when a tier row is
 * retuned. `SeatState.tier` survives only as a label for the HUD.
 */
export interface BotPersona {
  readonly name: string;                   // "rusher" | "turtle" | ... (display name in content/)
  readonly tier: BotTier;                  // the row it was folded with, for display and golden replays
  readonly aggression: number;             // 0..1
  readonly minWinChance: number;
  /** Expert's `minWinChance: "dynamic"` resolves to this flag; when true the floor is `score <= 0`
   *  and `minWinChance` is ignored. A number|string union inside GameState would not serialise
   *  canonically (R91/D16), so the tier's "dynamic" becomes a boolean here. [SPEC] */
  readonly dynamicMinWinChance: boolean;
  readonly reserveFactor: number;          // border troops kept = factor * largest adjacent enemy stack
  readonly tierReserveFactor: number;      // the tier's multiplier in `reserve(t)` (§4.13)
  readonly antiBotBias: number;            // 0 = none; > 0 biases target selection toward bot seats
  readonly reserveFloor: number;           // absolute minimum border garrison (Assassin: 20)
  readonly continentFocus: number;         // 0..1
  readonly expansionism: number;           // 0..1
  readonly stackiness: number;             // 0..1
  readonly turtleAversion: number;         // 0..1
  readonly leaderBias: number;             // 0..1
  readonly grudgeWeight: number;
  readonly grudgeDecay: number;            // 0.5 .. 0.95
  readonly allianceLoyalty: number;        // 0..1, 1 = never betrays
  readonly lookahead: 0 | 1 | 2;
  readonly seesKillForCards: boolean;
  readonly seesCardTradeTiming: boolean;
  readonly seesDominationThreshold: boolean;
  readonly usesExactOdds: boolean;
  readonly fogHonest: boolean;
  readonly fogPessimism: number;           // multiplier on unknown stacks when fogHonest
  readonly blunderRate: number;            // P(take the k-th best move)
  readonly placement: "spread" | "secure" | "frontLoad" | "stack";
}

export interface PortalState {
  readonly a: TerritoryId;
  readonly b: TerritoryId;
  readonly kind: Exclude<PortalMode, "off">;
  /** The first round in which this portal conducts. Stable portals are always 0. */
  readonly activeFrom: number;
}

export interface TerritoryState {
  readonly owner: Seat;                    // a seat, SEAT_NONE, SEAT_NEUTRAL, or SEAT_UNKNOWN in a view
  readonly troops: number;                 // TROOPS_UNKNOWN in a view
  readonly blizzard: boolean;
}

export interface SeatState {
  readonly seat: Seat;
  readonly kind: SeatKind;                 // "human" | "bot"; the neutral holding is not a seat (R7)
  readonly name: string;
  readonly colour: PlayerColour;
  readonly standing: Standing;
  /** The hand. In a VIEW this is `[]` for every seat but the viewer (F12); `cardCount` is what
   *  survives masking, so the roster can show "3 cards" without showing which three. */
  readonly cards: readonly Card[];
  /** Always the true hand size, in authoritative state and in every view. */
  readonly cardCount: number;
  readonly capital: TerritoryId | null;
  readonly tier: BotTier | null;           // display label only; the behaviour is folded into `persona`
  readonly persona: BotPersona | null;     // persona (+) tier, drawn once at match start (D28, F10)
  readonly allies: readonly Seat[];        // sorted ascending; symmetric
  readonly missedTurns: number;
  readonly armiesToClaim: number;          // claim phase only (R9)
}

export interface Outcome {
  readonly winner: Seat;
  readonly reason: "world" | "percentage" | "capitals" | "lastStanding" | "maxRounds";
  readonly tiebreak: boolean;              // true only when R78 decided it
  readonly round: number;
}

export interface GameState {
  /** The ruleset version this state was produced under (R92). A plain `number`, not
   *  `typeof RULESET_VERSION`: a state deserialised from an older replay legitimately carries an
   *  older number, and a literal type makes that unrepresentable. [SPEC] */
  readonly version: number;
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly seats: readonly SeatState[];
  readonly turnOrder: readonly Seat[];     // excludes the neutral holding (R7)
  readonly territories: readonly TerritoryState[];   // index === TerritoryId
  readonly currentIndex: number;           // index into turnOrder
  readonly phase: Phase;
  readonly round: number;                  // 1-based; increments on wrap
  readonly turn: number;                   // monotonic; the rngFor sub-stream index
  readonly troopsToPlace: number;
  readonly territoryBonusLeft: number;     // 0..2, reset each turn (R23)
  readonly setsTradedThisTurn: number;
  readonly setsTradedTotal: number;        // drives the Progressive ladder (R22)
  readonly conqueredThisTurn: boolean;     // drives the card award (R20)
  readonly fortifyUsed: boolean;
  readonly pendingMoveIn: {
    readonly from: TerritoryId; readonly to: TerritoryId;
    readonly min: number; readonly max: number;        // R63
  } | null;
  /** Set when a forced mid-Attack trade-down bounced the phase back to draft (R27). */
  readonly resumePhase: Phase | null;
  readonly portals: readonly PortalState[];
  readonly discard: readonly Card[];       // traded-in cards; the deck order is never stored (R19)
  readonly outcome: Outcome | null;
  /** True only on the result of `viewFor`. The authoritative state always has `false`. */
  readonly fogged: boolean;
}

/* -------------------------------------------------------------- §4.8 Action union -- */

export interface SeatInit {
  readonly seat: Seat; readonly kind: SeatKind; readonly name: string;
  readonly colour: PlayerColour; readonly tier: BotTier | null; readonly persona: BotPersona | null;
}

export type Action =
  // ---- seq 1, server/runner-resolved: the whole opening (R3, R4, R8, R10, R11; D3) ----
  | { readonly type: "GAME_STARTED"; readonly seat: Seat /* = turnOrder[0] */;
      readonly mapSlug: string; readonly rules: Rules;
      readonly seats: readonly SeatInit[];
      readonly turnOrder: readonly Seat[];
      readonly neutral: boolean;                      // true in the 2-seat variant
      readonly startingArmies: number;
      readonly deal: readonly { readonly territory: TerritoryId; readonly owner: Seat; readonly troops: number }[];
      readonly blizzards: readonly TerritoryId[];
      readonly portals: readonly PortalState[];
      readonly capitals: readonly (TerritoryId | null)[] }  // by seat index

  // ---- claim phase (R9) ----
  /** `forNeutral: true` is the 2-player variant's "then 1 neutral army" step (R6): the acting seat
   *  is still `seat`, but the army lands on a SEAT_NEUTRAL territory. Absent or false everywhere
   *  else, so a 3-6 seat claim log is unchanged. (F50) */
  | { readonly type: "CLAIM"; readonly seat: Seat; readonly territory: TerritoryId;
      readonly forNeutral?: boolean }

  // ---- draft ----
  | { readonly type: "TRADE_CARDS"; readonly seat: Seat;
      readonly cards: readonly [string, string, string];   // Card.id triple
      readonly bonusTerritory: TerritoryId | null }        // which match takes the +2 (R23)
  | { readonly type: "DRAFT"; readonly seat: Seat; readonly territory: TerritoryId; readonly count: number }

  // ---- attack: two payload shapes, one action type (R46, R48, R58, R61) ----
  | { readonly type: "ATTACK"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId;
      readonly mode: "manual";
      readonly attackerDice: readonly number[];            // 1..3 values in 1..6, as rolled
      readonly defenderDice: readonly number[] }           // 1..4 values; the reducer derives losses
  | { readonly type: "ATTACK"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId;
      readonly mode: "blitz";
      readonly attackerLosses: number;
      readonly defenderLosses: number;
      readonly stopUntil?: number }                        // the Attack Limiter floor, if one was set

  | { readonly type: "MOVE_IN"; readonly seat: Seat; readonly count: number }   // R62, R63

  // ---- fortify ----
  | { readonly type: "FORTIFY"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number }

  // ---- phase/turn ----
  | { readonly type: "END_PHASE"; readonly seat: Seat }    // illegal out of fortify (R67)
  | { readonly type: "END_TURN"; readonly seat: Seat }

  // ---- server/runner-resolved ----
  | { readonly type: "CARD_DRAWN"; readonly seat: Seat; readonly card: Card }   // R20
  | { readonly type: "AUTO_DEPLOY"; readonly seat: Seat;
      readonly placements: readonly { readonly territory: TerritoryId; readonly count: number }[] }
  | { readonly type: "SEAT_TO_BOT"; readonly seat: Seat;
      readonly reason: "away" | "timeout" | "resigned";
      readonly tier: BotTier; readonly persona: BotPersona }
  | { readonly type: "SEAT_TO_HUMAN"; readonly seat: Seat }
  | { readonly type: "PORTALS_MOVED"; readonly seat: Seat; readonly portals: readonly PortalState[] }

  // ---- alliances (R80) ----
  | { readonly type: "ALLIANCE_PROPOSE"; readonly seat: Seat; readonly to: Seat }
  | { readonly type: "ALLIANCE_ACCEPT"; readonly seat: Seat; readonly from: Seat }
  | { readonly type: "ALLIANCE_BREAK"; readonly seat: Seat; readonly with: Seat };

export type ActionKind = Action["type"];

/** What a client submits. The authority turns an intent into the action above. */
export type AttackIntent = {
  readonly from: TerritoryId; readonly to: TerritoryId;
} & ({ readonly mode: "manual"; readonly attackerDice: 1 | 2 | 3 }
   | { readonly mode: "blitz"; readonly stopUntil?: number });

/* -------------------------------------------------------------- §4.9 Event union -- */

export type Event =
  | { readonly type: "turnStarted"; readonly seat: Seat; readonly round: number }
  | { readonly type: "phaseChanged"; readonly from: Phase; readonly to: Phase }
  | { readonly type: "troopsAwarded"; readonly seat: Seat; readonly base: number;
      readonly continents: readonly ContinentId[]; readonly bonus: number;
      readonly capitals: number;                     // R15's +2 per held capital; 0 unless
                                                     //   rules.capitalDraftBonus (F14)
      readonly total: number }                       // base + bonus + capitals
  | { readonly type: "cardsTraded"; readonly seat: Seat; readonly cards: readonly string[];
      readonly value: number; readonly territoryBonus: TerritoryId | null }
  | { readonly type: "troopsPlaced"; readonly territory: TerritoryId; readonly count: number }
  | { readonly type: "diceRolled"; readonly from: TerritoryId; readonly to: TerritoryId;
      readonly attackerDice: readonly number[]; readonly defenderDice: readonly number[] }
  | { readonly type: "battleResolved"; readonly from: TerritoryId; readonly to: TerritoryId;
      readonly attackerLosses: number; readonly defenderLosses: number;
      readonly conquered: boolean; readonly unresolved: boolean }
  | { readonly type: "territoryCaptured"; readonly territory: TerritoryId;
      readonly from: Seat; readonly to: Seat }
  | { readonly type: "troopsMoved"; readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number }
  | { readonly type: "cardAwarded"; readonly seat: Seat; readonly card: Card }
  | { readonly type: "cardsSeized"; readonly seat: Seat; readonly from: Seat; readonly count: number }
  | { readonly type: "continentHeld"; readonly seat: Seat; readonly continent: ContinentId; readonly bonus: number }
  | { readonly type: "continentBroken"; readonly seat: Seat; readonly continent: ContinentId }
  | { readonly type: "playerEliminated"; readonly seat: Seat; readonly by: Seat }
  | { readonly type: "seatToBot"; readonly seat: Seat; readonly reason: "away" | "timeout" | "resigned" }
  | { readonly type: "seatToHuman"; readonly seat: Seat }
  | { readonly type: "portalsMoved"; readonly portals: readonly PortalState[] }
  | { readonly type: "allianceChanged"; readonly a: Seat; readonly b: Seat;
      readonly state: "proposed" | "accepted" | "broken" }
  | { readonly type: "gameOver"; readonly outcome: Outcome };

/* -------------------------------------------------------------- §4.10 ApplyResult and RuleError -- */

export interface ApplyResult {
  readonly state: GameState;      // === the input state when `error` is set (R86)
  readonly events: readonly Event[];
  readonly error?: RuleError;
}

export interface RuleError { readonly code: RuleErrorCode; readonly message: string }
export type RuleErrorCode =
  | "notYourTurn" | "wrongPhase" | "gameOver" | "unknownTerritory" | "notOwned" | "notAdjacent"
  | "tooFewTroops" | "tooManyTroops" | "blizzard" | "mustPlaceAllTroops" | "mustTradeCards"
  | "invalidSet" | "notHeld" | "noPath" | "fortifyUsed" | "moveInPending" | "moveInRange"
  | "diceCount" | "notAlliable" | "illegalAction";

