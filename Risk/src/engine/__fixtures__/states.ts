/**
 * `GameState` builders for S1's tests.
 *
 * Every rule test needs one specific board, so the builders take a compact
 * description — owners and troops per territory index, plus whatever rule
 * overrides the rule under test needs — and fill the rest with a legal, boring
 * default. Nothing here is exported from `@/engine`; it is test scaffolding
 * that happens to live under `src/engine/`, so it obeys the same purity guard.
 */
import { reinforcementsFor } from "../rules";
import {
  DEFAULT_RULES,
  RULESET_VERSION,
  SEAT_NONE,
  TERRITORY_BONUS_CAP,
  type Action,
  type BotPersona,
  type Card,
  type GameConfig,
  type GameState,
  type MapDef,
  type Phase,
  type PlayerColour,
  type PortalState,
  type Rules,
  type Seat,
  type SeatConfig,
  type SeatState,
  type Suit,
  type TerritoryId,
  type TerritoryState,
} from "../types";

const COLOURS: readonly PlayerColour[] = ["red", "green", "blue", "yellow", "orange", "pink"];

/** A plain-data persona, so a bot seat can be built without importing S2 (F3). */
export function persona(name = "rusher"): BotPersona {
  return {
    name,
    tier: "medium",
    aggression: 0.5,
    minWinChance: 0.5,
    dynamicMinWinChance: false,
    reserveFactor: 1,
    tierReserveFactor: 1,
    antiBotBias: 0,
    reserveFloor: 1,
    continentFocus: 0.5,
    expansionism: 0.5,
    stackiness: 0.5,
    turtleAversion: 0.5,
    leaderBias: 0.5,
    grudgeWeight: 0,
    grudgeDecay: 0.9,
    allianceLoyalty: 1,
    lookahead: 0,
    seesKillForCards: false,
    seesCardTradeTiming: false,
    seesDominationThreshold: false,
    usesExactOdds: false,
    fogHonest: true,
    fogPessimism: 1,
    blunderRate: 0,
    placement: "spread",
  };
}

/** `seats` seat configs, seat 0 human and the rest bots. */
export function seatConfigs(seats: number): SeatConfig[] {
  return Array.from({ length: seats }, (_v, i) => ({
    kind: i === 0 ? ("human" as const) : ("bot" as const),
    name: `Seat ${String(i)}`,
    colour: COLOURS[i] as PlayerColour,
    tier: i === 0 ? null : ("medium" as const),
  }));
}

/** A `GameConfig` for a map, with rule overrides. */
export function config(map: MapDef, seats: number, rules: Partial<Rules> = {}, seed = "test-seed"): GameConfig {
  return { mapSlug: map.slug, rules: { ...DEFAULT_RULES, ...rules }, seats: seatConfigs(seats), seed };
}

/** The personas `dealTerritories` wants: `null` for a human seat (F3). */
export function personasFor(seats: number): (BotPersona | null)[] {
  return Array.from({ length: seats }, (_v, i) => (i === 0 ? null : persona()));
}

/** A card naming a territory, with that territory's authored suit (R19). */
export function territoryCard(map: MapDef, t: TerritoryId): Card {
  const territory = map.territories[t] as { id: string; suit: Exclude<Suit, "wild"> };
  return { id: territory.id, suit: territory.suit, territory: t };
}

/** A card of an explicit suit, for the set-value tests. */
export function card(id: string, suit: Suit, territory: TerritoryId | null = null): Card {
  return { id, suit, territory };
}

export interface StateSpec {
  readonly seats?: number;
  readonly rules?: Partial<Rules>;
  /** Owner per territory index; shorter arrays leave the rest unowned. */
  readonly owners?: readonly Seat[];
  /** Troops per territory index; defaults to 1 on every owned territory. */
  readonly troops?: readonly number[];
  readonly blizzards?: readonly TerritoryId[];
  readonly portals?: readonly PortalState[];
  readonly phase?: Phase;
  readonly turnOrder?: readonly Seat[];
  readonly currentIndex?: number;
  readonly round?: number;
  readonly turn?: number;
  readonly troopsToPlace?: number;
  readonly hands?: Readonly<Record<number, readonly Card[]>>;
  readonly capitals?: readonly (TerritoryId | null)[];
  readonly standings?: Readonly<Record<number, SeatState["standing"]>>;
  readonly discard?: readonly Card[];
  readonly setsTradedTotal?: number;
  readonly setsTradedThisTurn?: number;
  readonly conqueredThisTurn?: boolean;
  readonly fortifyUsed?: boolean;
  readonly territoryBonusLeft?: number;
  readonly armiesToClaim?: Readonly<Record<number, number>>;
  readonly kinds?: Readonly<Record<number, SeatState["kind"]>>;
}

/** A legal `GameState` over `map`, described compactly. */
export function buildState(map: MapDef, spec: StateSpec = {}): GameState {
  const seatCount = spec.seats ?? 3;
  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  const blizzards = new Set(spec.blizzards ?? []);
  const territories: TerritoryState[] = map.territories.map((t, i) => {
    const owner = spec.owners?.[i] ?? SEAT_NONE;
    const blizzard = blizzards.has(i);
    const troops = blizzard || owner === SEAT_NONE ? 0 : (spec.troops?.[i] ?? 1);
    return { owner: blizzard ? SEAT_NONE : owner, troops, blizzard };
  });
  const seats: SeatState[] = Array.from({ length: seatCount }, (_v, i) => ({
    seat: i,
    kind: spec.kinds?.[i] ?? (i === 0 ? "human" : "bot"),
    name: `Seat ${String(i)}`,
    colour: COLOURS[i] as PlayerColour,
    standing: spec.standings?.[i] ?? "active",
    cards: spec.hands?.[i] ?? [],
    cardCount: (spec.hands?.[i] ?? []).length,
    capital: spec.capitals?.[i] ?? null,
    tier: i === 0 ? null : "medium",
    persona: i === 0 ? null : persona(),
    allies: [],
    missedTurns: 0,
    armiesToClaim: spec.armiesToClaim?.[i] ?? 0,
  }));
  return {
    version: RULESET_VERSION,
    mapSlug: map.slug,
    rules,
    seats,
    turnOrder: spec.turnOrder ?? Array.from({ length: seatCount }, (_v, i) => i),
    territories,
    currentIndex: spec.currentIndex ?? 0,
    phase: spec.phase ?? "attack",
    round: spec.round ?? 1,
    turn: spec.turn ?? 1,
    troopsToPlace: spec.troopsToPlace ?? 0,
    territoryBonusLeft: spec.territoryBonusLeft ?? TERRITORY_BONUS_CAP,
    setsTradedThisTurn: spec.setsTradedThisTurn ?? 0,
    setsTradedTotal: spec.setsTradedTotal ?? 0,
    conqueredThisTurn: spec.conqueredThisTurn ?? false,
    fortifyUsed: spec.fortifyUsed ?? false,
    pendingMoveIn: null,
    resumePhase: null,
    portals: spec.portals ?? [],
    discard: spec.discard ?? [],
    outcome: null,
    fogged: false,
  };
}

/** Owners split round-robin over every territory — a quick "mid-game" board. */
export function splitOwners(map: MapDef, seats: number): Seat[] {
  return map.territories.map((_t, i) => i % seats);
}

/** A `GAME_STARTED` built by hand, for the branches that need an exact opening. */
export function startedAction(
  map: MapDef,
  spec: {
    readonly seats?: number;
    readonly rules?: Partial<Rules>;
    readonly turnOrder?: readonly Seat[];
    readonly owners?: readonly Seat[];
    readonly troops?: readonly number[];
    readonly blizzards?: readonly TerritoryId[];
    readonly portals?: readonly PortalState[];
    readonly capitals?: readonly (TerritoryId | null)[];
    readonly startingArmies?: number;
  } = {},
): Extract<Action, { type: "GAME_STARTED" }> {
  const seatCount = spec.seats ?? 3;
  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  const turnOrder = spec.turnOrder ?? Array.from({ length: seatCount }, (_v, i) => i);
  const blizzards = spec.blizzards ?? [];
  const frozen = new Set(blizzards);
  const owners = spec.owners ?? splitOwners(map, seatCount);
  const deal = map.territories
    .filter((t) => !frozen.has(t.index))
    .map((t) => ({
      territory: t.index,
      owner: owners[t.index] as Seat,
      troops: spec.troops?.[t.index] ?? 1,
    }));
  return {
    type: "GAME_STARTED",
    seat: turnOrder[0] as Seat,
    mapSlug: map.slug,
    rules,
    seats: Array.from({ length: seatCount }, (_v, i) => ({
      seat: i,
      kind: i === 0 ? ("human" as const) : ("bot" as const),
      name: `Seat ${String(i)}`,
      colour: COLOURS[i] as PlayerColour,
      tier: i === 0 ? null : ("medium" as const),
      persona: i === 0 ? null : persona(),
    })),
    turnOrder,
    neutral: seatCount === 2,
    startingArmies: spec.startingArmies ?? 30,
    deal,
    blizzards,
    portals: spec.portals ?? [],
    capitals: spec.capitals ?? Array.from({ length: seatCount }, () => null),
  };
}

/** The reinforcement total a seat would be paid right now — handy in assertions. */
export function awardFor(state: GameState, map: MapDef, seat: Seat): number {
  return reinforcementsFor(state, map, seat).total;
}
