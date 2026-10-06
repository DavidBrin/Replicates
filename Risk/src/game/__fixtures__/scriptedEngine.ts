/**
 * A scripted `EngineApi` (SPEC §4.15, F33) — the test double S4 injects, and
 * the stand-in that lets the HUD and the session runner be exercised end to
 * end before S1's reducer lands.
 *
 * It is **not** the engine. It implements the handful of branches the session
 * runner drives (the three phases, conquest, cards, elimination, the win
 * checks) faithfully enough that a turn plays, and nothing else. Every rule
 * question in production goes to `@/engine`; `engineApi` is swapped in by
 * `realEngineApi()` the moment S1's barrel stops throwing.
 */
import type {
  Action, ActionKind, ApplyResult, AttackIntent, Card, CardBonusScheme, ContinentId, DiceAugment,
  Event, GameConfig, GameState, MapDef, OddsTables, Outcome, PortalState, Rng, RuleError, Seat, SeatState,
  TerritoryId, TerritoryState,
} from "@/engine/types";
import {
  FIXED_MIXED_VALUE, FIXED_SET_VALUE, PROGRESSIVE_SET_VALUES, RULESET_VERSION, SEAT_NEUTRAL,
  SEAT_NONE, SEAT_UNKNOWN, STARTING_ARMIES, TROOPS_UNKNOWN,
} from "@/engine/types";

import type { EngineApi } from "../engineApi";

import { nextInt, rngFor, shuffle } from "./scriptedRng";

const PHASES = ["draft", "attack", "fortify"] as const;

function fail(code: RuleError["code"], message: string): ApplyResult {
  return { state: null as unknown as GameState, events: [], error: { code, message } };
}

function refuse(state: GameState, code: RuleError["code"], message: string): ApplyResult {
  return { state, events: [], error: { code, message } };
}

/* ----------------------------------------------------------- selectors -- */

export function territoriesOf(state: GameState, seat: Seat): TerritoryId[] {
  const out: TerritoryId[] = [];
  state.territories.forEach((t, i) => {
    if (t.owner === seat) out.push(i);
  });
  return out;
}

function countsBySeat(state: GameState, pick: (t: TerritoryState) => number): (number | null)[] {
  const out = state.seats.map(() => 0);
  let hidden = false;
  for (const t of state.territories) {
    if (t.owner === SEAT_UNKNOWN || t.troops === TROOPS_UNKNOWN) {
      hidden = true;
      continue;
    }
    if (t.owner >= 0) out[t.owner] = (out[t.owner] ?? 0) + pick(t);
  }
  if (!hidden) return out;
  // Under fog only the viewer's own totals are knowable (R73, F52).
  return out.map(() => null);
}

export function continentsHeldBy(state: GameState, map: MapDef, seat: Seat): ContinentId[] {
  return map.continents
    .filter((c) => c.territories.every((t) => {
      const ts = state.territories[t];
      return !!ts && (ts.blizzard || ts.owner === seat);
    }))
    .filter((c) => c.territories.some((t) => state.territories[t]?.owner === seat))
    .map((c) => c.index);
}

export function reinforcementsFor(state: GameState, map: MapDef, seat: Seat) {
  const owned = territoriesOf(state, seat).length;
  const base = Math.max(3, Math.floor(owned / 3));
  const continents = continentsHeldBy(state, map, seat);
  const bonus = continents.reduce((n, c) => n + (map.continents[c]?.bonus ?? 0), 0);
  const capital = state.seats[seat]?.capital ?? null;
  const capitals = state.rules.capitalDraftBonus && capital !== null
    && state.territories[capital]?.owner === seat ? 2 : 0;
  return { base, continents: continents as readonly ContinentId[], bonus, capitals, total: base + bonus + capitals };
}

/** Portal edges are added at query time; the static set lives on the map (§4.5). */
function neighbours(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[] {
  const base = map.adjacency[from] ?? [];
  const extra: TerritoryId[] = [];
  for (const p of state.portals) {
    if (p.activeFrom > state.round) continue;
    if (p.a === from) extra.push(p.b);
    if (p.b === from) extra.push(p.a);
  }
  return extra.length ? [...new Set([...base, ...extra])].sort((a, b) => a - b) : base;
}

export function legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): TerritoryId[] {
  const src = state.territories[from];
  if (!src || src.troops < 2) return [];
  return neighbours(state, map, from).filter((to) => {
    const t = state.territories[to];
    return !!t && !t.blizzard && t.owner !== src.owner;
  });
}

export function legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): TerritoryId[] {
  const src = state.territories[from];
  if (!src || src.troops < 2) return [];
  const seen = new Set<TerritoryId>([from]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift() as TerritoryId;
    for (const n of neighbours(state, map, at)) {
      const t = state.territories[n];
      if (!t || t.blizzard || t.owner !== src.owner || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  seen.delete(from);
  return [...seen].sort((a, b) => a - b);
}

export function legalDraftTargets(state: GameState, seat: Seat): TerritoryId[] {
  return territoriesOf(state, seat).filter((t) => !state.territories[t]?.blizzard);
}

/* --------------------------------------------------------------- claim -- */

/**
 * R6's alternation, scripted: one neutral army is owed per completed pair of the acting seat's own
 * armies. The real engine derives this from `neutralArmiesOwed`; this stand-in only has to agree on
 * the shape of the answer.
 */
export function claimOwed(state: GameState, seat: Seat): "own" | "neutral" | "none" {
  if (state.phase !== "claim") return "none";
  if (state.turnOrder[state.currentIndex] !== seat) return "none";
  if (state.rules.manualPlacement && state.seats.length === 2) {
    let own = 0;
    let neutral = 0;
    for (const t of state.territories) {
      if (t.owner === SEAT_NEUTRAL) neutral += t.troops;
      else if (t.owner >= 0) own += t.troops;
    }
    if (Math.floor(own / 2) > neutral) return "neutral";
  }
  return (state.seats[seat]?.armiesToClaim ?? 0) > 0 ? "own" : "none";
}

export function legalNeutralClaimTargets(state: GameState): TerritoryId[] {
  const out: TerritoryId[] = [];
  state.territories.forEach((t, i) => {
    if (!t.blizzard && (t.owner === SEAT_NEUTRAL || t.owner === SEAT_NONE)) out.push(i);
  });
  return out;
}

export function legalOwnClaimTargets(state: GameState, seat: Seat): TerritoryId[] {
  const unclaimed: TerritoryId[] = [];
  state.territories.forEach((t, i) => {
    if (!t.blizzard && t.owner === SEAT_NONE) unclaimed.push(i);
  });
  return unclaimed.length > 0 ? unclaimed : legalDraftTargets(state, seat);
}

/* --------------------------------------------------------------- cards -- */

export function cardSets(cards: readonly Card[]): (readonly [string, string, string])[] {
  const out: (readonly [string, string, string])[] = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      for (let k = j + 1; k < cards.length; k += 1) {
        const trio = [cards[i], cards[j], cards[k]] as Card[];
        if (trio.some((c) => !c)) continue;
        if (isSet(trio)) out.push([trio[0]!.id, trio[1]!.id, trio[2]!.id] as const);
      }
    }
  }
  return out;
}

function isSet(trio: readonly Card[]): boolean {
  const wilds = trio.filter((c) => c.suit === "wild").length;
  if (wilds >= 1) return true;
  const suits = new Set(trio.map((c) => c.suit));
  return suits.size === 1 || suits.size === 3;
}

export function cardTradeValue(
  cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme,
): number {
  if (scheme === "progressive") {
    const n = setsTradedTotal + 1;
    return n <= PROGRESSIVE_SET_VALUES.length
      ? (PROGRESSIVE_SET_VALUES[n - 1] as number)
      : 15 + 5 * (n - PROGRESSIVE_SET_VALUES.length);
  }
  if (cards.some((c) => c.suit === "wild")) return FIXED_MIXED_VALUE;
  const suits = new Set(cards.map((c) => c.suit));
  if (suits.size === 3) return FIXED_MIXED_VALUE;
  const only = [...suits][0];
  return only && only !== "wild" ? FIXED_SET_VALUE[only] : FIXED_MIXED_VALUE;
}

export function mustTradeNow(state: GameState, seat: Seat): boolean {
  const s = state.seats[seat];
  if (!s) return false;
  if (s.cards.length >= 6) return true;
  return s.cards.length >= 5 && state.setsTradedThisTurn === 0 && state.phase === "draft";
}

/* ----------------------------------------------------------- the board -- */

function withTerritory(
  state: GameState, at: TerritoryId, patch: Partial<TerritoryState>,
): readonly TerritoryState[] {
  return state.territories.map((t, i) => (i === at ? { ...t, ...patch } : t));
}

function withSeat(state: GameState, seat: Seat, patch: Partial<SeatState>): readonly SeatState[] {
  return state.seats.map((s) => (s.seat === seat ? { ...s, ...patch } : s));
}

function livePlaySeats(state: GameState): Seat[] {
  return state.turnOrder.filter((s) => state.seats[s]?.standing === "active" || state.seats[s]?.standing === "away");
}

function outcomeFor(state: GameState, map: MapDef): Outcome | null {
  const playable = state.territories.filter((t) => !t.blizzard).length;
  for (const seat of state.turnOrder) {
    const owned = territoriesOf(state, seat).length;
    if (state.rules.winCondition === "world" && owned === playable && owned > 0) {
      return { winner: seat, reason: "world", tiebreak: false, round: state.round };
    }
    if (state.rules.winCondition === "percentage"
      && owned >= Math.ceil(state.rules.dominationThreshold * playable) && owned > 0) {
      return { winner: seat, reason: "percentage", tiebreak: false, round: state.round };
    }
    if (state.rules.winCondition === "capitals"
      && state.seats.every((s) => s.capital === null || state.territories[s.capital]?.owner === seat)
      && owned > 0) {
      return { winner: seat, reason: "capitals", tiebreak: false, round: state.round };
    }
  }
  const alive = livePlaySeats(state).filter((s) => territoriesOf(state, s).length > 0);
  if (alive.length === 1 && alive[0] !== undefined) {
    return { winner: alive[0], reason: "lastStanding", tiebreak: false, round: state.round };
  }
  void map;
  return null;
}

function maxRoundsOutcome(state: GameState): Outcome | null {
  if (state.rules.maxRounds === null || state.round <= state.rules.maxRounds) return null;
  const ranked = [...livePlaySeats(state)].sort((a, b) => {
    const ta = territoriesOf(state, a).length;
    const tb = territoriesOf(state, b).length;
    if (ta !== tb) return tb - ta;
    const troopsOf = (s: Seat) => territoriesOf(state, s).reduce((n, t) => n + (state.territories[t]?.troops ?? 0), 0);
    const ua = troopsOf(a);
    const ub = troopsOf(b);
    if (ua !== ub) return ub - ua;
    return a - b;
  });
  const winner = ranked[0];
  return winner === undefined
    ? null
    : { winner, reason: "maxRounds", tiebreak: true, round: state.round - 1 };
}

/* -------------------------------------------------------------- deal ----- */

function deckFor(map: MapDef): Card[] {
  const cards: Card[] = map.territories.map((t, i) => ({
    id: t.id,
    suit: (["infantry", "cavalry", "artillery"] as const)[i % 3] as Card["suit"],
    territory: i,
  }));
  cards.push({ id: "wild-1", suit: "wild", territory: null });
  cards.push({ id: "wild-2", suit: "wild", territory: null });
  return cards;
}

function dealTerritories(
  map: MapDef, config: GameConfig, personas: readonly (unknown | null)[],
  rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
): Extract<Action, { type: "GAME_STARTED" }> {
  const seatCount = config.seats.length;
  const turnOrder = shuffle(rngs.turnOrder, config.seats.map((_, i) => i));

  // ② modifiers before the deal (R10/R11)
  const blizzards: TerritoryId[] = [];
  if (config.rules.blizzards) {
    const pool = shuffle(rngs.modifierPlace, map.territories.map((t) => t.index));
    const want = Math.min(map.modifierSlots.blizzards, Math.max(0, map.territories.length - seatCount * 2));
    blizzards.push(...pool.slice(0, want).sort((a, b) => a - b));
  }
  const portals: PortalState[] = [];
  if (config.rules.portals !== "off") {
    const pool = shuffle(rngs.modifierPlace, map.territories.map((t) => t.index))
      .filter((t) => !blizzards.includes(t));
    const used = new Set<TerritoryId>();
    for (let i = 0; i + 1 < pool.length && portals.length < map.modifierSlots.portals; i += 2) {
      const a = pool[i] as TerritoryId;
      const b = pool[i + 1] as TerritoryId;
      if (used.has(a) || used.has(b) || (map.adjacency[a] ?? []).includes(b)) continue;
      used.add(a);
      used.add(b);
      portals.push({ a, b, kind: config.rules.portals === "unstable" ? "unstable" : "stable", activeFrom: 0 });
    }
  }

  // ③ the deal over the non-blizzard territories
  const dealable = shuffle(rngs.deal, map.territories.map((t) => t.index).filter((t) => !blizzards.includes(t)));
  const neutral = seatCount === 2;
  const piles: Seat[] = neutral ? [0, 1, SEAT_NEUTRAL] : turnOrder;
  const owners = new Map<TerritoryId, Seat>();
  dealable.forEach((t, i) => owners.set(t, piles[i % piles.length] as Seat));

  const startingArmies = STARTING_ARMIES[seatCount] ?? 20;
  const deal: { territory: TerritoryId; owner: Seat; troops: number }[] = [];
  const byOwner = new Map<Seat, TerritoryId[]>();
  for (const [t, owner] of owners) {
    const list = byOwner.get(owner) ?? [];
    list.push(t);
    byOwner.set(owner, list);
  }
  for (const [owner, list] of byOwner) {
    list.sort((a, b) => a - b);
    const remainder = Math.max(0, startingArmies - list.length);
    const each = Math.floor(remainder / list.length);
    let left = remainder - each * list.length;
    for (const t of list) {
      const extra = left > 0 ? 1 : 0;
      left -= extra;
      deal.push({ territory: t, owner, troops: 1 + each + extra });
    }
  }
  deal.sort((a, b) => a.territory - b.territory);

  // ④ capitals, each from the seat's own dealt territories
  const capitals: (TerritoryId | null)[] = config.seats.map((_, seat) => {
    if (!config.rules.capitals) return null;
    const own = byOwner.get(seat) ?? [];
    return own.length ? (own[nextInt(rngs.deal, own.length)] as TerritoryId) : null;
  });

  return {
    type: "GAME_STARTED",
    seat: turnOrder[0] ?? 0,
    mapSlug: map.slug,
    rules: config.rules,
    seats: config.seats.map((s, seat) => ({
      seat, kind: s.kind, name: s.name, colour: s.colour, tier: s.tier,
      persona: (personas[seat] ?? null) as never,
    })),
    turnOrder,
    neutral,
    startingArmies,
    deal,
    blizzards,
    portals,
    capitals,
  };
}

function createInitialState(map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>): GameState {
  const territories: TerritoryState[] = map.territories.map((t) => ({
    owner: SEAT_NONE,
    troops: 0,
    blizzard: started.blizzards.includes(t.index),
  }));
  for (const d of started.deal) {
    const slot = territories[d.territory];
    if (slot) territories[d.territory] = { ...slot, owner: d.owner, troops: d.troops };
  }
  const seats: SeatState[] = started.seats.map((s, i) => ({
    seat: s.seat,
    kind: s.kind,
    name: s.name,
    colour: s.colour,
    standing: "active",
    cards: [],
    cardCount: 0,
    capital: started.capitals[i] ?? null,
    tier: s.tier,
    persona: s.persona,
    allies: [],
    missedTurns: 0,
    armiesToClaim: started.rules.manualPlacement ? started.startingArmies : 0,
  }));
  const first = started.turnOrder[0] ?? 0;
  const base: GameState = {
    version: RULESET_VERSION,
    mapSlug: started.mapSlug,
    rules: started.rules,
    seats,
    turnOrder: started.turnOrder,
    territories,
    currentIndex: 0,
    phase: started.rules.manualPlacement ? "claim" : "draft",
    round: 1,
    turn: 1,
    troopsToPlace: 0,
    territoryBonusLeft: 2,
    setsTradedThisTurn: 0,
    setsTradedTotal: 0,
    conqueredThisTurn: false,
    fortifyUsed: false,
    pendingMoveIn: null,
    resumePhase: null,
    portals: started.portals,
    discard: [],
    outcome: null,
    fogged: false,
  };
  if (base.phase === "claim") return base;
  return { ...base, troopsToPlace: reinforcementsFor(base, map, first).total };
}

/* ------------------------------------------------------------- reducer -- */

function startTurn(state: GameState, map: MapDef, events: Event[]): GameState {
  let next = state;
  const live = livePlaySeats(next);
  if (live.length <= 1) return next;
  let guard = next.turnOrder.length + 1;
  do {
    const wrapped = next.currentIndex + 1 >= next.turnOrder.length;
    next = {
      ...next,
      currentIndex: wrapped ? 0 : next.currentIndex + 1,
      round: wrapped ? next.round + 1 : next.round,
    };
    guard -= 1;
  } while (guard > 0 && !live.includes(next.turnOrder[next.currentIndex] as Seat));

  const expiry = maxRoundsOutcome(next);
  if (expiry) {
    events.push({ type: "gameOver", outcome: expiry });
    return { ...next, phase: "over", outcome: expiry };
  }

  const seat = next.turnOrder[next.currentIndex] as Seat;
  const award = reinforcementsFor(next, map, seat);
  next = {
    ...next,
    phase: "draft",
    turn: next.turn + 1,
    troopsToPlace: award.total,
    territoryBonusLeft: 2,
    setsTradedThisTurn: 0,
    conqueredThisTurn: false,
    fortifyUsed: false,
    pendingMoveIn: null,
    resumePhase: null,
  };
  events.push({ type: "turnStarted", seat, round: next.round });
  events.push({
    type: "troopsAwarded", seat, base: award.base, continents: award.continents,
    bonus: award.bonus, capitals: award.capitals, total: award.total,
  });
  return next;
}

function eliminationSweep(state: GameState, by: Seat, events: Event[]): GameState {
  let next = state;
  for (const s of next.seats) {
    if (s.standing !== "active" && s.standing !== "away") continue;
    if (territoriesOf(next, s.seat).length > 0) continue;
    events.push({ type: "playerEliminated", seat: s.seat, by });
    if (s.cards.length) {
      events.push({ type: "cardsSeized", seat: by, from: s.seat, count: s.cards.length });
    }
    const victor = next.seats[by];
    next = {
      ...next,
      seats: next.seats.map((row) => {
        if (row.seat === s.seat) return { ...row, standing: "eliminated" as const, cards: [], cardCount: 0 };
        if (row.seat === by && victor) {
          const merged = [...row.cards, ...s.cards];
          return { ...row, cards: merged, cardCount: merged.length };
        }
        return row;
      }),
    };
  }
  return next;
}

function finish(state: GameState, map: MapDef, events: Event[]): GameState {
  const outcome = outcomeFor(state, map);
  if (!outcome) return state;
  events.push({ type: "gameOver", outcome });
  return { ...state, phase: "over", outcome };
}

function apply(state: GameState, map: MapDef, action: Action): ApplyResult {
  if (!state) return fail("illegalAction", "no state");
  if (state.outcome && action.type !== "GAME_STARTED") return refuse(state, "gameOver", "the game is over");
  const events: Event[] = [];
  const acting = state.turnOrder[state.currentIndex];

  switch (action.type) {
    case "GAME_STARTED":
      return { state: createInitialState(map, action), events: [{ type: "turnStarted", seat: action.seat, round: 1 }] };

    case "DRAFT": {
      if (state.phase !== "draft") return refuse(state, "wrongPhase", "not the draft phase");
      if (action.seat !== acting) return refuse(state, "notYourTurn", "not your turn");
      const t = state.territories[action.territory];
      if (!t) return refuse(state, "unknownTerritory", "no such territory");
      if (t.owner !== action.seat) return refuse(state, "notOwned", "you do not own that territory");
      if (action.count < 1) return refuse(state, "tooFewTroops", "place at least one");
      if (action.count > state.troopsToPlace) return refuse(state, "tooManyTroops", "you have fewer troops than that");
      events.push({ type: "troopsPlaced", territory: action.territory, count: action.count });
      return {
        state: {
          ...state,
          territories: withTerritory(state, action.territory, { troops: t.troops + action.count }),
          troopsToPlace: state.troopsToPlace - action.count,
        },
        events,
      };
    }

    case "TRADE_CARDS": {
      if (state.phase !== "draft") return refuse(state, "wrongPhase", "cards trade in the draft phase");
      const seat = state.seats[action.seat];
      if (!seat) return refuse(state, "illegalAction", "no such seat");
      const held = action.cards.map((id) => seat.cards.find((c) => c.id === id));
      if (held.some((c) => !c)) return refuse(state, "notHeld", "you do not hold those cards");
      const trio = held as Card[];
      if (!isSet(trio)) return refuse(state, "invalidSet", "those three are not a set");
      const value = cardTradeValue(trio, state.setsTradedTotal, state.rules.cardBonus);
      let territories = state.territories;
      let bonusLeft = state.territoryBonusLeft;
      if (action.bonusTerritory !== null && bonusLeft > 0) {
        const bt = state.territories[action.bonusTerritory];
        if (bt && bt.owner === action.seat) {
          territories = state.territories.map((row, i) =>
            i === action.bonusTerritory ? { ...row, troops: row.troops + 2 } : row);
          bonusLeft -= 2;
        }
      }
      events.push({
        type: "cardsTraded", seat: action.seat, cards: [...action.cards], value,
        territoryBonus: bonusLeft !== state.territoryBonusLeft ? action.bonusTerritory : null,
      });
      const rest = seat.cards.filter((c) => !action.cards.includes(c.id));
      return {
        state: {
          ...state,
          territories,
          seats: withSeat(state, action.seat, { cards: rest, cardCount: rest.length }),
          discard: [...state.discard, ...trio],
          troopsToPlace: state.troopsToPlace + value,
          territoryBonusLeft: bonusLeft,
          setsTradedThisTurn: state.setsTradedThisTurn + 1,
          setsTradedTotal: state.setsTradedTotal + 1,
        },
        events,
      };
    }

    case "ATTACK": {
      if (state.phase !== "attack") return refuse(state, "wrongPhase", "not the attack phase");
      if (action.seat !== acting) return refuse(state, "notYourTurn", "not your turn");
      if (state.pendingMoveIn) return refuse(state, "moveInPending", "move your troops in first");
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (!from || !to) return refuse(state, "unknownTerritory", "no such territory");
      if (from.owner !== action.seat) return refuse(state, "notOwned", "you do not own the source");
      if (to.blizzard) return refuse(state, "blizzard", "that territory is frozen");
      if (!legalAttackTargets(state, map, action.from).includes(action.to)) {
        return refuse(state, "notAdjacent", "those territories are not adjacent");
      }
      let attackerLosses: number;
      let defenderLosses: number;
      let diceUsed = 1;
      if (action.mode === "manual") {
        const a = [...action.attackerDice].sort((x, y) => y - x);
        const d = [...action.defenderDice].sort((x, y) => y - x);
        diceUsed = a.length;
        attackerLosses = 0;
        defenderLosses = 0;
        for (let i = 0; i < Math.min(a.length, d.length); i += 1) {
          if ((a[i] as number) > (d[i] as number)) defenderLosses += 1;
          else attackerLosses += 1;
        }
        events.push({
          type: "diceRolled", from: action.from, to: action.to,
          attackerDice: action.attackerDice, defenderDice: action.defenderDice,
        });
      } else {
        attackerLosses = action.attackerLosses;
        defenderLosses = action.defenderLosses;
        diceUsed = Math.min(3, Math.max(1, from.troops - 1));
      }
      attackerLosses = Math.min(attackerLosses, from.troops - 1);
      defenderLosses = Math.min(defenderLosses, to.troops);
      const conquered = defenderLosses >= to.troops;
      const srcTroops = from.troops - attackerLosses;
      let next: GameState = {
        ...state,
        territories: state.territories.map((row, i) => {
          if (i === action.from) return { ...row, troops: srcTroops };
          if (i === action.to) {
            return conquered
              ? { ...row, owner: action.seat, troops: 0 }
              : { ...row, troops: row.troops - defenderLosses };
          }
          return row;
        }),
      };
      events.push({
        type: "battleResolved", from: action.from, to: action.to,
        attackerLosses, defenderLosses, conquered,
        unresolved: !conquered && action.mode === "blitz" && srcTroops > 1,
      });
      if (conquered) {
        events.push({ type: "territoryCaptured", territory: action.to, from: to.owner, to: action.seat });
        const min = Math.min(diceUsed, Math.max(1, srcTroops - 1));
        next = {
          ...next,
          conqueredThisTurn: true,
          pendingMoveIn: { from: action.from, to: action.to, min, max: Math.max(min, srcTroops - 1) },
        };
        next = eliminationSweep(next, action.seat, events);
        next = finish(next, map, events);
      }
      return { state: next, events };
    }

    case "MOVE_IN": {
      const pending = state.pendingMoveIn;
      if (!pending) return refuse(state, "illegalAction", "nothing to move in");
      if (action.count < pending.min || action.count > pending.max) {
        return refuse(state, "moveInRange", `move between ${pending.min} and ${pending.max}`);
      }
      const src = state.territories[pending.from];
      const dst = state.territories[pending.to];
      if (!src || !dst) return refuse(state, "unknownTerritory", "no such territory");
      events.push({ type: "troopsMoved", from: pending.from, to: pending.to, count: action.count });
      let next: GameState = {
        ...state,
        territories: state.territories.map((row, i) => {
          if (i === pending.from) return { ...row, troops: row.troops - action.count };
          if (i === pending.to) return { ...row, troops: row.troops + action.count };
          return row;
        }),
        pendingMoveIn: null,
      };
      // R27: a forced mid-Attack trade-down bounces the phase back to draft.
      if (next.resumePhase === null && mustTradeNow(next, action.seat) && next.phase === "attack") {
        next = { ...next, phase: "draft", resumePhase: "attack" };
      }
      return { state: next, events };
    }

    case "FORTIFY": {
      if (state.phase !== "fortify") return refuse(state, "wrongPhase", "not the fortify phase");
      if (state.fortifyUsed) return refuse(state, "fortifyUsed", "you have already fortified");
      const src = state.territories[action.from];
      const dst = state.territories[action.to];
      if (!src || !dst) return refuse(state, "unknownTerritory", "no such territory");
      if (src.owner !== action.seat || dst.owner !== action.seat) {
        return refuse(state, "notOwned", "both ends must be yours");
      }
      if (!legalFortifyMoves(state, map, action.from).includes(action.to)) {
        return refuse(state, "noPath", "no path through your own territories");
      }
      if (action.count < 1 || action.count > src.troops - 1) {
        return refuse(state, "tooManyTroops", "leave at least one army behind");
      }
      events.push({ type: "troopsMoved", from: action.from, to: action.to, count: action.count });
      return {
        state: {
          ...state,
          territories: state.territories.map((row, i) => {
            if (i === action.from) return { ...row, troops: row.troops - action.count };
            if (i === action.to) return { ...row, troops: row.troops + action.count };
            return row;
          }),
          fortifyUsed: true,
        },
        events,
      };
    }

    case "END_PHASE": {
      if (state.phase === "fortify") return refuse(state, "illegalAction", "fortify ends with END_TURN");
      if (state.phase === "draft" && state.troopsToPlace > 0) {
        return refuse(state, "mustPlaceAllTroops",
          "You must draft all of your available troops during your draft phase");
      }
      if (state.pendingMoveIn) return refuse(state, "moveInPending", "move your troops in first");
      if (state.phase === "draft" && state.resumePhase) {
        events.push({ type: "phaseChanged", from: "draft", to: state.resumePhase });
        return { state: { ...state, phase: state.resumePhase, resumePhase: null }, events };
      }
      const i = PHASES.indexOf(state.phase as (typeof PHASES)[number]);
      const to = PHASES[i + 1];
      if (!to) return refuse(state, "wrongPhase", "no phase after this one");
      events.push({ type: "phaseChanged", from: state.phase, to });
      return { state: { ...state, phase: to }, events };
    }

    case "END_TURN": {
      if (state.pendingMoveIn) return refuse(state, "moveInPending", "move your troops in first");
      if (state.phase === "draft" && state.troopsToPlace > 0) {
        return refuse(state, "mustPlaceAllTroops",
          "You must draft all of your available troops during your draft phase");
      }
      let next = finish(state, map, events);
      if (next.outcome) return { state: next, events };
      next = startTurn(next, map, events);
      return { state: next, events };
    }

    case "CARD_DRAWN": {
      const seat = state.seats[action.seat];
      if (!seat) return refuse(state, "illegalAction", "no such seat");
      const cards = [...seat.cards, action.card];
      events.push({ type: "cardAwarded", seat: action.seat, card: action.card });
      return {
        state: { ...state, seats: withSeat(state, action.seat, { cards, cardCount: cards.length }) },
        events,
      };
    }

    case "AUTO_DEPLOY": {
      let territories = state.territories;
      let left = state.troopsToPlace;
      for (const p of action.placements) {
        const t = territories[p.territory];
        if (!t || t.owner !== action.seat) continue;
        const count = Math.min(p.count, left);
        left -= count;
        territories = territories.map((row, i) => (i === p.territory ? { ...row, troops: row.troops + count } : row));
        events.push({ type: "troopsPlaced", territory: p.territory, count });
      }
      return { state: { ...state, territories, troopsToPlace: left }, events };
    }

    case "SEAT_TO_BOT":
      events.push({ type: "seatToBot", seat: action.seat, reason: action.reason });
      return {
        state: {
          ...state,
          seats: withSeat(state, action.seat, {
            kind: "bot", tier: action.tier, persona: action.persona,
            standing: action.reason === "resigned" ? "resigned" : "away",
          }),
        },
        events,
      };

    case "SEAT_TO_HUMAN":
      events.push({ type: "seatToHuman", seat: action.seat });
      return {
        state: { ...state, seats: withSeat(state, action.seat, { kind: "human", standing: "active", missedTurns: 0 }) },
        events,
      };

    case "PORTALS_MOVED":
      events.push({ type: "portalsMoved", portals: action.portals });
      return { state: { ...state, portals: action.portals }, events };

    case "CLAIM": {
      const t = state.territories[action.territory];
      if (!t) return refuse(state, "unknownTerritory", "no such territory");
      if (t.blizzard) return refuse(state, "blizzard", "that territory is frozen");
      const owner = action.forNeutral ? SEAT_NEUTRAL : action.seat;
      if (t.owner !== SEAT_NONE && t.owner !== owner) return refuse(state, "notOwned", "already claimed");
      const seat = state.seats[action.seat];
      let next: GameState = {
        ...state,
        territories: withTerritory(state, action.territory, { owner, troops: t.troops + 1 }),
        seats: action.forNeutral || !seat
          ? state.seats
          : withSeat(state, action.seat, { armiesToClaim: Math.max(0, seat.armiesToClaim - 1) }),
      };
      if (next.seats.every((s) => s.armiesToClaim === 0)) {
        next = { ...next, phase: "draft", currentIndex: 0 };
        const first = next.turnOrder[0] as Seat;
        next = { ...next, troopsToPlace: reinforcementsFor(next, map, first).total };
        events.push({ type: "phaseChanged", from: "claim", to: "draft" });
      } else {
        next = { ...next, currentIndex: (next.currentIndex + 1) % next.turnOrder.length };
      }
      return { state: next, events };
    }

    case "ALLIANCE_PROPOSE":
      events.push({ type: "allianceChanged", a: action.seat, b: action.to, state: "proposed" });
      return { state, events };
    case "ALLIANCE_ACCEPT": {
      events.push({ type: "allianceChanged", a: action.from, b: action.seat, state: "accepted" });
      const link = (s: SeatState, other: Seat) =>
        ({ ...s, allies: [...new Set([...s.allies, other])].sort((x, y) => x - y) });
      return {
        state: {
          ...state,
          seats: state.seats.map((s) =>
            s.seat === action.seat ? link(s, action.from) : s.seat === action.from ? link(s, action.seat) : s),
        },
        events,
      };
    }
    case "ALLIANCE_BREAK": {
      events.push({ type: "allianceChanged", a: action.seat, b: action.with, state: "broken" });
      const cut = (s: SeatState, other: Seat) => ({ ...s, allies: s.allies.filter((x) => x !== other) });
      return {
        state: {
          ...state,
          seats: state.seats.map((s) =>
            s.seat === action.seat ? cut(s, action.with) : s.seat === action.with ? cut(s, action.seat) : s),
        },
        events,
      };
    }

    default:
      return refuse(state, "illegalAction", "unknown action");
  }
}

/* ------------------------------------------------------------ the port -- */

function viewFor(state: GameState, map: MapDef, seat: Seat): GameState {
  const visible = new Set<TerritoryId>();
  if (state.rules.fogOfWar) {
    state.territories.forEach((t, i) => {
      if (t.owner !== seat) return;
      visible.add(i);
      for (const n of neighbours(state, map, i)) visible.add(n);
    });
  }
  return {
    ...state,
    fogged: true,
    seats: state.seats.map((s) => (s.seat === seat ? s : { ...s, cards: [] })),
    territories: state.rules.fogOfWar
      ? state.territories.map((t, i) =>
        (visible.has(i) ? t : { ...t, owner: SEAT_UNKNOWN, troops: TROOPS_UNKNOWN }))
      : state.territories,
  };
}

function hashState(state: GameState): string {
  if (state.fogged) throw new Error("hashState: refusing to hash a masked view");
  const text = canonicalize(state);
  let h1 = 0x12345678;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    h1 = (Math.imul(h1 ^ text.charCodeAt(i), 0x85ebca6b) >>> 0);
    h2 = (Math.imul(h2 + text.charCodeAt(i) + i, 0xc2b2ae35) >>> 0);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function canonicalize(state: GameState): string {
  return JSON.stringify(state, (_k, v: unknown) =>
    (v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v));
}

function legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[] {
  if (state.outcome) return [];
  if (state.turnOrder[state.currentIndex] !== seat) return [];
  if (state.phase === "claim") return ["CLAIM"];
  if (state.pendingMoveIn) return ["MOVE_IN"];
  if (state.phase === "draft") {
    if (mustTradeNow(state, seat)) return ["TRADE_CARDS"];
    const out: ActionKind[] = [];
    if (cardSets(state.seats[seat]?.cards ?? []).length) out.push("TRADE_CARDS");
    if (state.troopsToPlace > 0) out.push("DRAFT");
    else out.push("END_PHASE");
    return out;
  }
  if (state.phase === "attack") {
    const canAttack = territoriesOf(state, seat).some((t) => legalAttackTargets(state, map, t).length > 0);
    return canAttack ? ["ATTACK", "END_PHASE"] : ["END_PHASE"];
  }
  if (state.phase === "fortify") return state.fortifyUsed ? ["END_TURN"] : ["FORTIFY", "END_TURN"];
  return [];
}

function diceAugmentFor(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): DiceAugment {
  void map;
  void from;
  const defender = state.territories[to]?.owner;
  const isCapital = state.rules.capitals
    && state.seats.some((s) => s.seat === defender && s.capital === to);
  return { defendDiceBonus: isCapital ? 1 : 0, attackDicePenalty: 0, favourDefenderOnDraw: true };
}

function dicePlan(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId) {
  const aug = diceAugmentFor(state, map, from, to);
  const src = state.territories[from]?.troops ?? 0;
  const dst = state.territories[to]?.troops ?? 0;
  return {
    maxAttackDice: Math.max(1, Math.min(3, src - 1)) as 1 | 2 | 3,
    defendDice: Math.max(1, Math.min(dst, 2 + aug.defendDiceBonus)) as 1 | 2 | 3 | 4,
  };
}

function rollAttack(
  state: GameState, map: MapDef, intent: AttackIntent, rng: Rng, odds: OddsTables, diceMode: unknown,
): Extract<Action, { type: "ATTACK" }> {
  void diceMode;
  const seat = state.turnOrder[state.currentIndex] as Seat;
  const plan = dicePlan(state, map, intent.from, intent.to);
  if (intent.mode === "manual") {
    const n = Math.min(intent.attackerDice, plan.maxAttackDice);
    const attackerDice = Array.from({ length: n }, () => 1 + nextInt(rng, 6));
    const defenderDice = Array.from({ length: plan.defendDice }, () => 1 + nextInt(rng, 6));
    return { type: "ATTACK", seat, from: intent.from, to: intent.to, mode: "manual", attackerDice, defenderDice };
  }
  const a = Math.max(0, (state.territories[intent.from]?.troops ?? 1) - 1);
  const d = state.territories[intent.to]?.troops ?? 0;
  const dist = odds.outcome(a, d, diceAugmentFor(state, map, intent.from, intent.to), intent.stopUntil);
  const u = rng.nextFloat();
  // Inverse CDF over "attacker wins having lost i", then the defender half.
  let cum = 0;
  for (let i = 0; i < a; i += 1) {
    cum += dist.attackLoss[i] ?? 0;
    if (u < cum) {
      return {
        type: "ATTACK", seat, from: intent.from, to: intent.to, mode: "blitz",
        attackerLosses: i, defenderLosses: d, ...(intent.stopUntil !== undefined ? { stopUntil: intent.stopUntil } : {}),
      };
    }
  }
  return {
    type: "ATTACK", seat, from: intent.from, to: intent.to, mode: "blitz",
    attackerLosses: a, defenderLosses: Math.max(0, d - 1),
    ...(intent.stopUntil !== undefined ? { stopUntil: intent.stopUntil } : {}),
  };
}

function drawCard(state: GameState, map: MapDef, seat: Seat, rng: Rng): Extract<Action, { type: "CARD_DRAWN" }> {
  const held = new Set<string>(state.seats.flatMap((s) => s.cards.map((c) => c.id)));
  for (const c of state.discard) held.add(c.id);
  const pool = deckFor(map).filter((c) => !held.has(c.id));
  const deck = pool.length ? pool : deckFor(map);
  return { type: "CARD_DRAWN", seat, card: deck[nextInt(rng, deck.length)] as Card };
}

function movePortals(
  state: GameState, map: MapDef, rng: Rng,
): Extract<Action, { type: "PORTALS_MOVED" }> | null {
  if (state.rules.portals !== "unstable" || state.round % 3 !== 0) return null;
  const pool = shuffle(rng, map.territories.map((t) => t.index)
    .filter((t) => !state.territories[t]?.blizzard));
  const used = new Set<TerritoryId>();
  const portals = state.portals.map((p) => {
    for (let i = 0; i + 1 < pool.length; i += 2) {
      const a = pool[i] as TerritoryId;
      const b = pool[i + 1] as TerritoryId;
      if (used.has(a) || used.has(b) || (map.adjacency[a] ?? []).includes(b)) continue;
      used.add(a);
      used.add(b);
      return { ...p, a, b, activeFrom: state.round + 1 };
    }
    return p;
  });
  return { type: "PORTALS_MOVED", seat: state.turnOrder[state.currentIndex] as Seat, portals };
}

/** The whole scripted port. */
export function createScriptedEngine(): EngineApi {
  return {
    createInitialState,
    apply,
    validate: (state, map, action) => apply(state, map, action).error ?? null,
    legalActions,
    reinforcementsFor,
    legalAttackTargets,
    legalFortifyMoves,
    legalDraftTargets,
    claimOwed,
    legalNeutralClaimTargets,
    legalOwnClaimTargets,
    cardSets,
    cardTradeValue,
    mustTradeNow,
    diceAugmentFor,
    dicePlan,
    territoryCounts: (state) => countsBySeat(state, () => 1),
    troopCounts: (state) => countsBySeat(state, (t) => t.troops),
    territoryCountFor: (state, seat) => territoriesOf(state, seat).length,
    troopCountFor: (state, seat) =>
      territoriesOf(state, seat).reduce((n, t) => n + Math.max(0, state.territories[t]?.troops ?? 0), 0),
    continentsHeldBy,
    isGameOver: (state) => state.outcome !== null,
    viewFor,
    hashState,
    serializeState: (state) => JSON.stringify(state),
    deserializeState: (json) => JSON.parse(json) as GameState,
    dealTerritories,
    rollAttack,
    drawCard,
    movePortals,
    rngFor,
  };
}

export const scriptedEngine: EngineApi = createScriptedEngine();
