/**
 * A scripted engine for the route tests (SPEC §12, S5's "stubs" row).
 *
 * `apply`, `validate`, `hashState`, the resolvers, `createOdds`, `decideTurn`
 * and `loadMapFile` all throw "pending" while S1, S2 and S3 build them — and
 * **none of them need to work** for the transaction, the idempotency fence,
 * the `204` path, the lazy tick and the seat-takeover logic to be provable.
 * So this is the counter-state engine §12 asks for: a reducer that moves a
 * few numbers, a `hashState` that is a real function of the state, a
 * `rollAttack` with fixed dice and a `decideTurn` that returns a one-action
 * plan.
 *
 * It is deliberately a *plausible* reducer rather than a stub that returns
 * its input: `missedTurns`, the turn wrap and the seat-kind flip are the
 * things the tick's own logic reads back, so a reducer that did not move them
 * would let the tick pass its tests while doing nothing.
 */
import type {
  Action,
  ApplyResult,
  AttackIntent,
  BotPersona,
  BotTier,
  Card,
  Continent,
  DiceMode,
  GameConfig,
  GameState,
  MapDef,
  MapFile,
  OddsTables,
  OutcomeDist,
  Rng,
  Rules,
  RuleError,
  Seat,
  SeatState,
  Territory,
  TerritoryId,
  TerritoryState,
} from "@/engine/types";
import {
  DEFAULT_RULES,
  SEAT_NONE,
  SEAT_UNKNOWN,
  TROOPS_UNKNOWN,
} from "@/engine/types";
import type { GameView, TurnPlan } from "@/engine/bots";

import type { ServerEngine } from "../engine";

/* ------------------------------------------------------------------ maps -- */

/** A ring map: `count` territories, each adjacent to its two neighbours. */
export function fakeMapDef(count = 6): MapDef {
  const territories: Territory[] = [];
  for (let index = 0; index < count; index += 1) {
    territories.push({
      index,
      id: `t${index}`,
      name: `Territory ${index}`,
      continent: 0,
      suit: (["infantry", "cavalry", "artillery"] as const)[index % 3]!,
      adjacent: [(index + count - 1) % count, (index + 1) % count].sort((a, b) => a - b),
      seaLinked: [],
      d: "M0 0 L1 0 L1 1 Z",
      token: [index, 0],
      label: [index, 1],
    });
  }
  const continent: Continent = {
    index: 0,
    id: "c0",
    name: "Ring",
    bonus: 2,
    color: "var(--c-na)",
    territories: territories.map((territory) => territory.index),
    border: territories.map((territory) => territory.index),
  };
  return {
    slug: "tiny4",
    name: "Ring",
    viewBox: [0, 0, 100, 100],
    territories,
    continents: [continent],
    modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
    adjacency: territories.map((territory) => territory.adjacent),
  };
}

export function fakeMapFile(count = 6): MapFile {
  const map = fakeMapDef(count);
  return {
    slug: map.slug,
    name: map.name,
    viewBox: "0 0 100 100",
    continents: [
      {
        id: "c0",
        name: "Ring",
        bonus: 2,
        color: "var(--c-na)",
        territories: map.territories.map((territory) => territory.id),
      },
    ],
    territories: map.territories.map((territory, index) => ({
      id: territory.id,
      name: territory.name,
      continent: "c0",
      suit: (["infantry", "cavalry", "artillery"] as const)[index % 3]!,
      adjacent: territory.adjacent.map((at) => `t${at}`),
      d: territory.d,
      tokenX: index,
      tokenY: 0,
      labelX: index,
      labelY: 1,
    })),
    seaLinks: [],
    modifierSlots: map.modifierSlots,
  };
}

/* --------------------------------------------------------------- persona -- */

export function fakePersona(tier: BotTier = "medium"): BotPersona {
  return {
    name: "turtle",
    tier,
    aggression: 0.15,
    minWinChance: 0.8,
    dynamicMinWinChance: false,
    reserveFactor: 2,
    tierReserveFactor: 0.8,
    antiBotBias: 0,
    reserveFloor: 4,
    continentFocus: 0.5,
    expansionism: 0.2,
    stackiness: 0.6,
    turtleAversion: 0.5,
    leaderBias: 0.2,
    grudgeWeight: 0.25,
    grudgeDecay: 0.9,
    allianceLoyalty: 1,
    lookahead: 0,
    seesKillForCards: false,
    seesCardTradeTiming: false,
    seesDominationThreshold: false,
    usesExactOdds: true,
    fogHonest: true,
    fogPessimism: 1.2,
    blunderRate: 0,
    placement: "secure",
  };
}

/* ------------------------------------------------------------------ rng -- */

/** A counter "RNG": deterministic, and enough for a fixed-dice resolver. */
export function fakeRng(start = 1): Rng {
  let value = start;
  return {
    nextU32: () => (value = (value * 1_103_515_245 + 12_345) >>> 0),
    nextFloat: () => ((value = (value * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32),
    state: [start, 0] as const,
  };
}

/* ----------------------------------------------------------------- hash -- */

/** FNV-1a over a canonical serialisation. A real function of the state. */
export function fakeHash(state: GameState): string {
  if (state.fogged) throw new Error("hashState: state is fogged");
  const canonical = JSON.stringify(state, (_key, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/* ---------------------------------------------------------------- states -- */

export interface FakeStateOptions {
  readonly seats?: readonly { kind: "human" | "bot"; name: string }[];
  readonly rules?: Partial<Rules>;
  readonly territories?: number;
}

const CARD: Card = { id: "t0", suit: "infantry", territory: 0 };

export function fakeState(options: FakeStateOptions = {}): GameState {
  const seatSpecs = options.seats ?? [
    { kind: "human" as const, name: "Alpha" },
    { kind: "human" as const, name: "Bravo" },
  ];
  const count = options.territories ?? 6;
  const rules: Rules = { ...DEFAULT_RULES, turnSeconds: 90, ...options.rules };

  const colours = ["red", "blue", "green", "yellow", "orange", "pink"] as const;
  const seats: SeatState[] = seatSpecs.map((spec, index) => ({
    seat: index,
    kind: spec.kind,
    name: spec.name,
    colour: colours[index % colours.length]!,
    standing: "active",
    cards: index === 0 ? [CARD] : [],
    cardCount: index === 0 ? 1 : 0,
    capital: null,
    tier: spec.kind === "bot" ? "medium" : null,
    persona: spec.kind === "bot" ? fakePersona() : null,
    allies: [],
    missedTurns: 0,
    armiesToClaim: 0,
  }));

  const territories: TerritoryState[] = [];
  for (let index = 0; index < count; index += 1) {
    territories.push({ owner: index % seats.length, troops: 3, blizzard: false });
  }

  return {
    version: 1,
    mapSlug: "tiny4",
    rules,
    seats,
    turnOrder: seats.map((seat) => seat.seat),
    territories,
    currentIndex: 0,
    phase: "draft",
    round: 1,
    turn: 1,
    troopsToPlace: 3,
    territoryBonusLeft: 2,
    setsTradedThisTurn: 0,
    setsTradedTotal: 0,
    conqueredThisTurn: false,
    fortifyUsed: false,
    pendingMoveIn: null,
    resumePhase: null,
    portals: [],
    discard: [],
    outcome: null,
    fogged: false,
  };
}

/* ---------------------------------------------------------------- reducer -- */

const NEXT_PHASE: Record<string, GameState["phase"]> = {
  claim: "draft",
  draft: "attack",
  attack: "fortify",
  fortify: "fortify",
};

function err(code: RuleError["code"], message = code): RuleError {
  return { code, message };
}

/** The seat whose turn it is, by the same rule the server uses. */
function current(state: GameState): Seat {
  return state.turnOrder[state.currentIndex] ?? 0;
}

/** Server-resolved actions may name any seat; a player action may not. */
const SERVER_TYPES = new Set([
  "GAME_STARTED",
  "AUTO_DEPLOY",
  "CARD_DRAWN",
  "SEAT_TO_BOT",
  "SEAT_TO_HUMAN",
  "PORTALS_MOVED",
]);

export function fakeValidate(state: GameState, _map: MapDef, action: Action): RuleError | null {
  if (state.outcome !== null) return err("gameOver");
  if (!SERVER_TYPES.has(action.type) && action.seat !== current(state)) {
    return err("notYourTurn");
  }
  switch (action.type) {
    case "DRAFT":
      if (state.phase !== "draft") return err("wrongPhase");
      if (action.count > state.troopsToPlace) return err("tooManyTroops");
      if (state.territories[action.territory]?.owner !== action.seat) return err("notOwned");
      return null;
    case "CLAIM":
      if (state.phase !== "claim") return err("wrongPhase");
      return null;
    case "AUTO_DEPLOY":
      if (state.phase !== "draft") return err("wrongPhase");
      return null;
    case "END_PHASE":
      // R67: illegal out of fortify.
      if (state.phase === "fortify" || state.phase === "over") return err("wrongPhase");
      if (state.phase === "draft" && state.troopsToPlace > 0) return err("mustPlaceAllTroops");
      return null;
    case "END_TURN":
      if (state.phase === "draft" && state.troopsToPlace > 0) return err("mustPlaceAllTroops");
      return null;
    case "ATTACK":
      if (state.phase !== "attack") return err("wrongPhase");
      if (state.territories[action.from]?.owner !== action.seat) return err("notOwned");
      return null;
    case "MOVE_IN":
      if (state.pendingMoveIn === null) return err("illegalAction");
      return null;
    case "FORTIFY":
      if (state.phase !== "fortify") return err("wrongPhase");
      if (state.fortifyUsed) return err("fortifyUsed");
      return null;
    case "TRADE_CARDS":
      if (state.phase !== "draft") return err("wrongPhase");
      return null;
    case "SEAT_TO_BOT":
      if (state.seats[action.seat]?.kind === "bot") return err("illegalAction");
      return null;
    case "SEAT_TO_HUMAN":
      if (state.seats[action.seat]?.kind === "human") return err("illegalAction");
      return null;
    default:
      return null;
  }
}

function withSeat(
  state: GameState,
  seat: Seat,
  patch: Partial<SeatState>,
): readonly SeatState[] {
  return state.seats.map((row) => (row.seat === seat ? { ...row, ...patch } : row));
}

function withTerritory(
  state: GameState,
  at: TerritoryId,
  patch: Partial<TerritoryState>,
): readonly TerritoryState[] {
  return state.territories.map((row, index) => (index === at ? { ...row, ...patch } : row));
}

export function fakeApply(state: GameState, map: MapDef, action: Action): ApplyResult {
  const error = fakeValidate(state, map, action);
  if (error) return { state, events: [], error };

  switch (action.type) {
    case "DRAFT": {
      const troops = (state.territories[action.territory]?.troops ?? 0) + action.count;
      return {
        state: {
          ...state,
          troopsToPlace: state.troopsToPlace - action.count,
          territories: withTerritory(state, action.territory, { troops }),
        },
        events: [{ type: "troopsPlaced", territory: action.territory, count: action.count }],
      };
    }
    case "AUTO_DEPLOY": {
      let territories = state.territories;
      let placed = 0;
      for (const placement of action.placements) {
        placed += placement.count;
        territories = territories.map((row, index) =>
          index === placement.territory ? { ...row, troops: row.troops + placement.count } : row,
        );
      }
      return {
        state: {
          ...state,
          territories,
          troopsToPlace: Math.max(0, state.troopsToPlace - placed),
        },
        events: [],
      };
    }
    case "CLAIM":
      return {
        state: {
          ...state,
          territories: withTerritory(state, action.territory, {
            owner: action.seat,
            troops: (state.territories[action.territory]?.troops ?? 0) + 1,
          }),
          troopsToPlace: Math.max(0, state.troopsToPlace - 1),
        },
        events: [],
      };
    case "TRADE_CARDS":
      return {
        state: {
          ...state,
          troopsToPlace: state.troopsToPlace + 10,
          setsTradedTotal: state.setsTradedTotal + 1,
          setsTradedThisTurn: state.setsTradedThisTurn + 1,
          seats: withSeat(state, action.seat, { cards: [], cardCount: 0 }),
        },
        events: [],
      };
    case "ATTACK": {
      const losses = action.mode === "blitz" ? action.defenderLosses : 1;
      const defender = state.territories[action.to];
      const remaining = Math.max(0, (defender?.troops ?? 0) - losses);
      const conquered = remaining === 0;
      return {
        state: {
          ...state,
          conqueredThisTurn: state.conqueredThisTurn || conquered,
          territories: withTerritory(state, action.to, {
            troops: conquered ? 1 : remaining,
            ...(conquered ? { owner: action.seat } : {}),
          }),
        },
        events: [],
      };
    }
    case "MOVE_IN":
      return { state: { ...state, pendingMoveIn: null }, events: [] };
    case "FORTIFY":
      return { state: { ...state, fortifyUsed: true }, events: [] };
    case "END_PHASE":
      return {
        state: { ...state, phase: NEXT_PHASE[state.phase] ?? state.phase },
        events: [{ type: "phaseChanged", from: state.phase, to: NEXT_PHASE[state.phase] ?? state.phase }],
      };
    case "END_TURN": {
      const nextIndex = (state.currentIndex + 1) % state.turnOrder.length;
      return {
        state: {
          ...state,
          currentIndex: nextIndex,
          round: nextIndex === 0 ? state.round + 1 : state.round,
          turn: state.turn + 1,
          phase: "draft",
          troopsToPlace: 3,
          fortifyUsed: false,
          conqueredThisTurn: false,
          setsTradedThisTurn: 0,
        },
        events: [{ type: "turnStarted", seat: state.turnOrder[nextIndex] ?? 0, round: state.round }],
      };
    }
    case "SEAT_TO_BOT":
      return {
        state: {
          ...state,
          seats: withSeat(state, action.seat, {
            kind: "bot",
            tier: action.tier,
            persona: action.persona,
            standing: action.reason === "resigned" ? "resigned" : "away",
            missedTurns: 0,
          }),
        },
        events: [{ type: "seatToBot", seat: action.seat, reason: action.reason }],
      };
    case "SEAT_TO_HUMAN":
      return {
        state: {
          ...state,
          seats: withSeat(state, action.seat, {
            kind: "human",
            tier: null,
            persona: null,
            standing: "active",
            missedTurns: 0,
          }),
        },
        events: [{ type: "seatToHuman", seat: action.seat }],
      };
    case "CARD_DRAWN":
      return {
        state: {
          ...state,
          seats: withSeat(state, action.seat, {
            cards: [...(state.seats[action.seat]?.cards ?? []), action.card],
            cardCount: (state.seats[action.seat]?.cardCount ?? 0) + 1,
          }),
        },
        events: [],
      };
    default:
      return { state, events: [] };
  }
}

/* ------------------------------------------------------------------- fog -- */

export function fakeViewFor(state: GameState, map: MapDef, seat: Seat): GameState {
  // Always: every other seat's hand is emptied, `cardCount` survives (F12).
  const seats = state.seats.map((row) =>
    row.seat === seat ? row : { ...row, cards: [] as readonly Card[] },
  );

  if (!state.rules.fogOfWar) {
    return { ...state, seats, fogged: true };
  }

  const visible = new Set<TerritoryId>();
  state.territories.forEach((row, index) => {
    if (row.owner !== seat) return;
    visible.add(index);
    for (const neighbour of map.territories[index]?.adjacent ?? []) visible.add(neighbour);
  });

  return {
    ...state,
    seats,
    territories: state.territories.map((row, index) =>
      visible.has(index) ? row : { ...row, owner: SEAT_UNKNOWN, troops: TROOPS_UNKNOWN },
    ),
    fogged: true,
  };
}

/* --------------------------------------------------------------- resolver -- */

export function fakeDeal(
  map: MapDef,
  config: GameConfig,
  personas: readonly (BotPersona | null)[],
): Extract<Action, { type: "GAME_STARTED" }> {
  const seats = config.seats.map((seat, index) => ({
    seat: index,
    kind: seat.kind,
    name: seat.name,
    colour: seat.colour,
    tier: seat.tier,
    persona: personas[index] ?? null,
  }));
  return {
    type: "GAME_STARTED",
    seat: 0,
    mapSlug: config.mapSlug,
    rules: config.rules,
    seats,
    turnOrder: seats.map((seat) => seat.seat),
    neutral: false,
    startingArmies: 10,
    // Contiguous blocks, not alternating seats: on a ring, alternating
    // ownership makes every territory adjacent to one of yours, so a fog view
    // would mask nothing and the fog tests would pass vacuously.
    deal: map.territories.map((territory, index) => ({
      territory: territory.index,
      owner: Math.min(seats.length - 1, Math.floor((index * seats.length) / map.territories.length)),
      troops: 3,
    })),
    blizzards: [],
    portals: [],
    capitals: seats.map(() => null),
  };
}

export function fakeInitialState(
  map: MapDef,
  started: Extract<Action, { type: "GAME_STARTED" }>,
): GameState {
  const base = fakeState({
    seats: started.seats.map((seat) => ({ kind: seat.kind, name: seat.name })),
    rules: started.rules,
    territories: map.territories.length,
  });
  return {
    ...base,
    mapSlug: started.mapSlug,
    turnOrder: [...started.turnOrder],
    seats: base.seats.map((seat, index) => ({
      ...seat,
      colour: started.seats[index]?.colour ?? seat.colour,
      kind: started.seats[index]?.kind ?? seat.kind,
      tier: started.seats[index]?.tier ?? null,
      persona: started.seats[index]?.persona ?? null,
      cards: [],
      cardCount: 0,
    })),
    territories: map.territories.map((territory) => {
      const dealt = started.deal.find((row) => row.territory === territory.index);
      return {
        owner: dealt?.owner ?? SEAT_NONE,
        troops: dealt?.troops ?? 0,
        blizzard: false,
      };
    }),
  };
}

/** Fixed dice: a Blitz always costs one each way; a manual roll is 6/5/4 v 2/1. */
export function fakeRollAttack(
  _state: GameState,
  _map: MapDef,
  intent: AttackIntent,
): Extract<Action, { type: "ATTACK" }> {
  if (intent.mode === "manual") {
    return {
      type: "ATTACK",
      seat: 0,
      from: intent.from,
      to: intent.to,
      mode: "manual",
      attackerDice: [6, 5, 4].slice(0, intent.attackerDice),
      defenderDice: [2, 1],
    };
  }
  return {
    type: "ATTACK",
    seat: 0,
    from: intent.from,
    to: intent.to,
    mode: "blitz",
    attackerLosses: 1,
    defenderLosses: 1,
    ...(intent.stopUntil === undefined ? {} : { stopUntil: intent.stopUntil }),
  };
}

/* ------------------------------------------------------------------ odds -- */

export function fakeOdds(mode: DiceMode = "balancedBlitz"): OddsTables {
  const dist: OutcomeDist = {
    a: 1,
    d: 1,
    attackLoss: new Float64Array([0.5, 0.5]),
    defendLoss: new Float64Array([0.5, 0.5]),
    unresolved: 0,
    winChance: 0.5,
  };
  return {
    mode,
    winChance: () => 0.5,
    outcome: () => dist,
    expectedAttackerLoss: () => 1,
    certainWin: () => false,
  };
}

/* ------------------------------------------------------------------ bots -- */

export function fakeMakeView(
  state: GameState,
  map: MapDef,
  seat: Seat,
  persona: BotPersona,
  grudge?: Float32Array,
): GameView {
  const owner = new Int16Array(state.territories.map((row) => row.owner));
  const troops = new Int16Array(state.territories.map((row) => row.troops));
  return {
    map,
    rules: state.rules,
    me: seat,
    persona,
    turn: state.turn,
    round: state.round,
    phase: state.phase,
    owner,
    troops,
    known: new Uint8Array(state.territories.length).fill(1),
    blizzard: new Uint8Array(state.territories.length),
    portals: state.portals,
    capital: new Int16Array(state.seats.length).fill(-1),
    territoryCount: new Int16Array(state.seats.length),
    troopCount: new Int32Array(state.seats.length),
    cardCount: new Int16Array(state.seats.map((row) => row.cardCount)),
    myCards: state.seats[seat]?.cards ?? [],
    allies: new Uint8Array(state.seats.length),
    standing: state.seats.map((row) => row.standing),
    troopsToPlace: state.troopsToPlace,
    setsTradedTotal: state.setsTradedTotal,
    conqueredThisTurn: state.conqueredThisTurn,
    grudge: grudge ?? new Float32Array(state.seats.length),
  };
}

/**
 * A one-action plan: deploy everything onto the first territory this seat
 * owns, never attack, never fortify.
 *
 * One action per `decideTurn` is what makes the chaining test meaningful — a
 * bot turn becomes DRAFT, END_PHASE, END_PHASE, END_TURN, so three
 * consecutive bot seats comfortably exceed `MAX_TICK_ACTIONS`.
 */
export function fakeDecideTurn(view: GameView): TurnPlan {
  const mine: TerritoryId[] = [];
  view.owner.forEach((owner, index) => {
    if (owner === view.me) mine.push(index);
  });
  const target = mine[0];
  return {
    cardTrade: null,
    placements:
      target === undefined || view.troopsToPlace <= 0
        ? []
        : [{ territory: target, count: view.troopsToPlace }],
    attacks: [],
    fortify: null,
    done: true,
  };
}

/* ----------------------------------------------------------------- engine -- */

export interface FakeEngineOptions {
  readonly map?: MapDef;
  readonly mapFile?: MapFile;
  readonly decideTurn?: (view: GameView, odds: OddsTables, rng: Rng) => TurnPlan;
}

/** The whole {@link ServerEngine}, scripted. */
export function fakeEngine(options: FakeEngineOptions = {}): ServerEngine {
  const map = options.map ?? fakeMapDef();
  const file = options.mapFile ?? fakeMapFile(map.territories.length);
  return {
    createInitialState: fakeInitialState,
    apply: fakeApply,
    validate: fakeValidate,
    legalActions: (state) => (state.phase === "draft" ? ["DRAFT", "END_PHASE"] : ["END_PHASE"]),
    legalDraftTargets: (state, seat) =>
      state.territories.flatMap((row, index) => (row.owner === seat ? [index] : [])),
    viewFor: fakeViewFor,
    hashState: fakeHash,
    isGameOver: (state) => state.outcome !== null,

    rngFor: (seed, purpose, turn) => fakeRng(seed.length + purpose.length + turn),
    dealTerritories: fakeDeal,
    rollAttack: fakeRollAttack,
    drawCard: (_state, _map, seat) => ({ type: "CARD_DRAWN", seat, card: CARD }),
    movePortals: () => null,

    createOdds: fakeOdds,
    makeView: fakeMakeView,
    decideTurn: options.decideTurn ?? fakeDecideTurn,
    drawPersonas: (tiers) => tiers.map((tier) => (tier === null ? null : fakePersona(tier))),

    loadMapFile: async () => file,
    loadMap: () => map,
  };
}
