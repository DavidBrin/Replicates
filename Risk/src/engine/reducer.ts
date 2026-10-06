/**
 * `apply(state, map, action)` — the one door into the rules (SPEC §3, §4.10;
 * R86–R92).
 *
 * Three invariants hold in every branch and are the reason the file is shaped
 * the way it is:
 *
 * - **Never throws** (R86). Every branch calls `validate` first and returns
 *   `{ state: input, events: [], error }` on a refusal. An illegal action is
 *   data, including the 7-card hand of R28/F51.
 * - **Never mutates** (R87). `open` copies the arrays it will write to and
 *   every seat/territory write replaces an object rather than editing one, so
 *   the caller owns both the input and the output.
 * - **No randomness, no clock, no DOM** (R88). Every random outcome arrives
 *   inside the action payload, resolved once by `resolver/**` (D2, D3).
 *
 * The two orderings worth knowing before reading:
 *
 * - **R65** — the continent and win checks run on the *capture*, inside the
 *   `ATTACK` branch. `MOVE_IN` only redistributes troops.
 * - **F41** — the R27 forced-trade-down bounce to `draft` is applied in the
 *   `MOVE_IN` branch, after the troops have moved, because an elimination
 *   always arrives on a capture and a capture always sets `pendingMoveIn`. The
 *   `ATTACK` branch applies it itself only when no move-in is pending, which
 *   is the seizure-without-conquest case R28's hand-size check can still
 *   produce. One site, one order.
 */
import { cardTradeValue, hasSet } from "./cards";
import { continentsHeldBy } from "./continents";
import { diceAugmentFor, resolveManualRoll } from "./modifiers";
import {
  evaluateOutcome,
  pendingAlliancesOf,
  reinforcementsFor,
  takesTurns,
  territoryCountFor,
  troopCountFor,
} from "./rules";
import { neutralArmiesOwed, validate } from "./validate";
import {
  RULESET_VERSION,
  SEAT_NEUTRAL,
  SEAT_NONE,
  TERRITORY_BONUS,
  TERRITORY_BONUS_CAP,
  type Action,
  type ApplyResult,
  type Card,
  type Event,
  type GameState,
  type MapDef,
  type Outcome,
  type Phase,
  type PortalState,
  type RuleError,
  type Seat,
  type SeatState,
  type TerritoryId,
  type TerritoryState,
} from "./types";

/* ------------------------------------------------------------------- draft -- */

/** A mutable working copy. Nothing outside this file ever sees one. */
interface Draft {
  version: number;
  mapSlug: string;
  rules: GameState["rules"];
  seats: SeatState[];
  turnOrder: Seat[];
  territories: TerritoryState[];
  currentIndex: number;
  phase: Phase;
  round: number;
  turn: number;
  troopsToPlace: number;
  territoryBonusLeft: number;
  setsTradedThisTurn: number;
  setsTradedTotal: number;
  conqueredThisTurn: boolean;
  fortifyUsed: boolean;
  pendingMoveIn: GameState["pendingMoveIn"];
  resumePhase: Phase | null;
  pendingAlliances: (readonly [Seat, Seat])[];
  portals: PortalState[];
  discard: Card[];
  outcome: Outcome | null;
  events: Event[];
}

function open(state: GameState): Draft {
  return {
    version: state.version,
    mapSlug: state.mapSlug,
    rules: state.rules,
    seats: state.seats.slice(),
    turnOrder: state.turnOrder.slice(),
    territories: state.territories.slice(),
    currentIndex: state.currentIndex,
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    troopsToPlace: state.troopsToPlace,
    territoryBonusLeft: state.territoryBonusLeft,
    setsTradedThisTurn: state.setsTradedThisTurn,
    setsTradedTotal: state.setsTradedTotal,
    conqueredThisTurn: state.conqueredThisTurn,
    fortifyUsed: state.fortifyUsed,
    pendingMoveIn: state.pendingMoveIn,
    resumePhase: state.resumePhase,
    // `pendingAlliancesOf`, not `state.pendingAlliances`: the draft is built from whatever state
    // `apply` was handed, and a state persisted before the field existed has none (R92, §4.7).
    // `apply` never throws, so the one place that could is the one place that must not.
    pendingAlliances: pendingAlliancesOf(state).slice(),
    portals: state.portals.slice(),
    discard: state.discard.slice(),
    outcome: state.outcome,
    events: [],
  };
}

/**
 * A snapshot that survives later writes: the arrays are copied, so a `before`
 * taken at the top of a branch still describes the board as it was. `snapshot`
 * shares them, which is what you want for a read-right-now but is a silent
 * aliasing bug if you hold on to it.
 */
function frozenSnapshot(d: Draft): GameState {
  return { ...snapshot(d), seats: d.seats.slice(), territories: d.territories.slice() };
}

/** The state a draft currently describes. Pure construction; safe mid-branch. */
function snapshot(d: Draft): GameState {
  return {
    version: d.version,
    mapSlug: d.mapSlug,
    rules: d.rules,
    seats: d.seats,
    turnOrder: d.turnOrder,
    territories: d.territories,
    currentIndex: d.currentIndex,
    phase: d.phase,
    round: d.round,
    turn: d.turn,
    troopsToPlace: d.troopsToPlace,
    territoryBonusLeft: d.territoryBonusLeft,
    setsTradedThisTurn: d.setsTradedThisTurn,
    setsTradedTotal: d.setsTradedTotal,
    conqueredThisTurn: d.conqueredThisTurn,
    fortifyUsed: d.fortifyUsed,
    pendingMoveIn: d.pendingMoveIn,
    resumePhase: d.resumePhase,
    pendingAlliances: d.pendingAlliances,
    portals: d.portals,
    discard: d.discard,
    outcome: d.outcome,
    fogged: false,
  };
}

function setTerritory(d: Draft, t: TerritoryId, patch: Partial<TerritoryState>): void {
  const current = d.territories[t];
  if (current === undefined) return;
  d.territories[t] = { ...current, ...patch };
}

function setSeat(d: Draft, seat: Seat, patch: Partial<SeatState>): void {
  const current = d.seats[seat];
  if (current === undefined) return;
  d.seats[seat] = { ...current, ...patch };
}

/** Hands are kept sorted by card id, so the canonical digest never depends on draw order (R91, D16). */
function sortedHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function reject(state: GameState, error: RuleError): ApplyResult {
  return { state, events: [], error };
}

/* ------------------------------------------------------------ shared moves -- */

/** R83 — evaluate the win order; `true` when the game just ended. */
function settle(d: Draft, map: MapDef, roundCompleted: number | null): boolean {
  if (d.outcome !== null) return true;
  const outcome = evaluateOutcome(snapshot(d), map, roundCompleted);
  if (outcome === null) return false;
  d.outcome = outcome;
  if (d.phase !== "over") {
    d.events.push({ type: "phaseChanged", from: d.phase, to: "over" });
    d.phase = "over";
  }
  d.pendingMoveIn = null;
  d.events.push({ type: "gameOver", outcome });
  return true;
}

/**
 * R81/R26/R28 — a seat owning nothing is eliminated and its **whole hand**
 * transfers to whoever finished it. The transient hand that leaves is allowed
 * to exceed six; R26's trade-down is what brings it back, and until it does
 * `validate` refuses every action but `TRADE_CARDS` (F51).
 */
function eliminateIfEmpty(d: Draft, victim: Seat, by: Seat): boolean {
  if (victim < 0) return false; // the neutral holding is never eliminated (R7)
  const row = d.seats[victim];
  if (row === undefined || !takesTurns(row)) return false;
  if (territoryCountFor(snapshot(d), victim) > 0) return false;

  const taken = row.cards;
  setSeat(d, victim, { standing: "eliminated", cards: [], cardCount: 0 });
  // R80 — a seat that is out of the game takes its diplomacy with it, offers and pacts (§4.7).
  dropAlliancesFor(d, victim);
  if (taken.length > 0 && by >= 0) {
    const taker = d.seats[by];
    if (taker !== undefined) {
      setSeat(d, by, {
        cards: sortedHand([...taker.cards, ...taken]),
        cardCount: taker.cardCount + taken.length,
      });
      d.events.push({ type: "cardsSeized", seat: by, from: victim, count: taken.length });
    }
  }
  d.events.push({ type: "playerEliminated", seat: victim, by });
  return true;
}

/** Continent gains and losses between two snapshots, for the seats a capture touched. */
function emitContinentDiff(d: Draft, map: MapDef, before: GameState, seats: readonly Seat[]): void {
  const after = snapshot(d);
  for (const seat of [...seats].sort((a, b) => a - b)) {
    if (seat < 0) continue;
    const was = continentsHeldBy(before, map, seat);
    const now = continentsHeldBy(after, map, seat);
    for (const id of now) {
      if (!was.includes(id)) {
        d.events.push({
          type: "continentHeld",
          seat,
          continent: id,
          bonus: (map.continents[id] as { bonus: number }).bonus,
        });
      }
    }
    for (const id of was) {
      if (!now.includes(id)) d.events.push({ type: "continentBroken", seat, continent: id });
    }
  }
}

/**
 * R26/R27 — bounce a forced trade-down back to `draft` and say whether one is owed.
 *
 * `resumePhase` records where the turn was when the seizure landed, so `END_PHASE` puts play back
 * exactly there with every turn flag intact (R27). It is also what `mustTradeDown` reads to tell a
 * trade-down **in progress** (a hand of 5 on the way from 8) from a hand of 5 that arrived by
 * inheritance alone and waits for the next turn — so every route into a trade-down has to set it,
 * which is why this is reached from the `MOVE_IN` branch (the conquest case, F41) *and* from
 * `END_TURN`'s R81 elimination re-check, whatever phase that sweep ran in (codex round 2,
 * finding 10). A sweep that ran in `draft` has no attack to resume, so it resumes at `attack`,
 * which is where `draft` always leads.
 *
 * Returns `true` when the seat now owes a trade-down, so a caller that was about to advance play
 * stops instead: the trade-down is R26's "immediate, same-turn", not the next turn's problem.
 */
function bounceForTradeDown(d: Draft, seat: Seat): boolean {
  if (d.phase === "claim" || d.phase === "over") return false;
  const row = d.seats[seat];
  if (row === undefined) return false;
  if (row.cards.length < 6 || !hasSet(row.cards)) return false;
  if (d.phase === "draft") {
    d.resumePhase ??= "attack";
    return true;
  }
  d.resumePhase = d.phase;
  d.events.push({ type: "phaseChanged", from: d.phase, to: "draft" });
  d.phase = "draft";
  return true;
}

/** R12–R15 — pay a seat for the turn it is about to take, and announce it. */
function beginTurn(d: Draft, map: MapDef, seat: Seat): void {
  const award = reinforcementsFor(snapshot(d), map, seat);
  d.troopsToPlace = award.total;
  d.events.push({ type: "turnStarted", seat, round: d.round });
  for (const id of award.continents) {
    d.events.push({
      type: "continentHeld",
      seat,
      continent: id,
      bonus: (map.continents[id] as { bonus: number }).bonus,
    });
  }
  d.events.push({
    type: "troopsAwarded",
    seat,
    base: award.base,
    continents: award.continents,
    bonus: award.bonus,
    capitals: award.capitals,
    total: award.total,
  });
}

/** The next `turnOrder` index that still takes turns, wrapping (R81, R84). */
function nextTurnIndex(d: Draft, from: number): number {
  const n = d.turnOrder.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    const row = d.seats[d.turnOrder[idx] as Seat];
    if (row !== undefined && takesTurns(row)) return idx;
  }
  return from;
}

/* ------------------------------------------------------- createInitialState -- */

/**
 * Folds `GAME_STARTED` into an empty board (SPEC §4.10, §5.1). The map must
 * already be loaded (F44): `GameState` carries only `mapSlug`, so nothing can
 * be folded without its `MapDef` alongside.
 */
export function createInitialState(
  map: MapDef,
  started: Extract<Action, { type: "GAME_STARTED" }>,
): GameState {
  const blizzards = new Set(started.blizzards);
  const territories: TerritoryState[] = map.territories.map((_t, i) => ({
    owner: SEAT_NONE,
    troops: 0,
    blizzard: blizzards.has(i),
  }));
  for (const entry of started.deal) {
    if (blizzards.has(entry.territory)) continue;
    territories[entry.territory] = { owner: entry.owner, troops: entry.troops, blizzard: false };
  }

  const manual = started.rules.manualPlacement;
  const seats: SeatState[] = started.seats.map((init) => ({
    seat: init.seat,
    kind: init.kind,
    name: init.name,
    colour: init.colour,
    standing: "active",
    cards: [],
    cardCount: 0,
    capital: started.capitals[init.seat] ?? null,
    tier: init.tier,
    persona: init.persona,
    allies: [],
    missedTurns: 0,
    armiesToClaim: manual ? started.startingArmies : 0,
  }));

  const base: GameState = {
    version: RULESET_VERSION,
    mapSlug: started.mapSlug,
    rules: started.rules,
    seats,
    turnOrder: started.turnOrder,
    territories,
    currentIndex: 0,
    phase: manual ? "claim" : "draft",
    round: 1,
    turn: 1,
    troopsToPlace: 0,
    territoryBonusLeft: TERRITORY_BONUS_CAP,
    setsTradedThisTurn: 0,
    setsTradedTotal: 0,
    conqueredThisTurn: false,
    fortifyUsed: false,
    pendingMoveIn: null,
    resumePhase: null,
    pendingAlliances: [],
    portals: started.portals,
    discard: [],
    outcome: null,
    fogged: false,
  };

  if (manual) return base;
  const first = started.turnOrder[0] ?? 0;
  return { ...base, troopsToPlace: reinforcementsFor(base, map, first).total };
}

/** The events `createInitialState` would have emitted, for `apply`'s GAME_STARTED branch. */
function openingEvents(state: GameState, map: MapDef): Event[] {
  const seat = state.turnOrder[0] ?? 0;
  const events: Event[] = [{ type: "turnStarted", seat, round: state.round }];
  if (state.phase === "draft") {
    const award = reinforcementsFor(state, map, seat);
    for (const id of award.continents) {
      events.push({
        type: "continentHeld",
        seat,
        continent: id,
        bonus: (map.continents[id] as { bonus: number }).bonus,
      });
    }
    events.push({
      type: "troopsAwarded",
      seat,
      base: award.base,
      continents: award.continents,
      bonus: award.bonus,
      capitals: award.capitals,
      total: award.total,
    });
  }
  return events;
}

/* ------------------------------------------------------------------- apply -- */

/**
 * The one door into the rules. Pure, total, non-mutating (R86–R88).
 *
 * `GAME_STARTED` is accepted and returns the opening board, so a cold client
 * can fold a log straight from `seq = 1` without a separate entry point; every
 * other action is refused once an outcome exists (R83).
 */
export function apply(state: GameState, map: MapDef, action: Action): ApplyResult {
  const error = validate(state, map, action);
  if (error !== null) return reject(state, error);

  if (action.type === "GAME_STARTED") {
    const next = createInitialState(map, action);
    return { state: next, events: openingEvents(next, map) };
  }

  const d = open(state);
  switch (action.type) {
    case "CLAIM":
      applyClaim(d, map, action);
      break;
    case "TRADE_CARDS":
      applyTrade(d, action);
      break;
    case "DRAFT":
      setTerritory(d, action.territory, {
        troops: (d.territories[action.territory] as TerritoryState).troops + action.count,
      });
      d.troopsToPlace -= action.count;
      d.events.push({ type: "troopsPlaced", territory: action.territory, count: action.count });
      break;
    case "AUTO_DEPLOY":
      for (const placement of action.placements) {
        setTerritory(d, placement.territory, {
          troops: (d.territories[placement.territory] as TerritoryState).troops + placement.count,
        });
        d.events.push({ type: "troopsPlaced", territory: placement.territory, count: placement.count });
      }
      d.troopsToPlace = 0;
      break;
    case "ATTACK":
      applyAttack(d, map, action);
      break;
    case "MOVE_IN":
      applyMoveIn(d, action);
      break;
    case "FORTIFY":
      setTerritory(d, action.from, {
        troops: (d.territories[action.from] as TerritoryState).troops - action.count,
      });
      setTerritory(d, action.to, {
        troops: (d.territories[action.to] as TerritoryState).troops + action.count,
      });
      d.fortifyUsed = true;
      d.events.push({ type: "troopsMoved", from: action.from, to: action.to, count: action.count });
      break;
    case "END_PHASE":
      applyEndPhase(d);
      break;
    case "END_TURN":
      applyEndTurn(d, map, action.seat);
      break;
    case "CARD_DRAWN":
      applyCardDrawn(d, action);
      break;
    case "SEAT_TO_BOT":
      setSeat(d, action.seat, {
        kind: "bot",
        tier: action.tier,
        persona: action.persona,
        standing: action.reason === "resigned" ? "resigned" : "active",
        missedTurns: 0,
      });
      // R82 — a resignation takes the seat out of the game, and its diplomacy with it (R80, §4.7).
      if (action.reason === "resigned") dropAlliancesFor(d, action.seat);
      d.events.push({ type: "seatToBot", seat: action.seat, reason: action.reason });
      settle(d, map, null);
      break;
    case "SEAT_TO_HUMAN":
      setSeat(d, action.seat, { kind: "human", standing: "active", missedTurns: 0 });
      d.events.push({ type: "seatToHuman", seat: action.seat });
      break;
    case "PORTALS_MOVED":
      d.portals = action.portals.slice();
      d.events.push({ type: "portalsMoved", portals: d.portals });
      break;
    case "ALLIANCE_PROPOSE":
      // R80 — the offer is recorded so `validateAlliance` can refuse a repeat of it (§4.7).
      addPendingAlliance(d, action.seat, action.to);
      d.events.push({ type: "allianceChanged", a: action.seat, b: action.to, state: "proposed" });
      break;
    case "ALLIANCE_ACCEPT":
      addAlly(d, action.seat, action.from);
      clearPendingAlliance(d, action.seat, action.from);
      d.events.push({ type: "allianceChanged", a: action.seat, b: action.from, state: "accepted" });
      break;
    case "ALLIANCE_BREAK":
      removeAlly(d, action.seat, action.with);
      clearPendingAlliance(d, action.seat, action.with);
      d.events.push({ type: "allianceChanged", a: action.seat, b: action.with, state: "broken" });
      break;
    default:
      // Unreachable: `validate` already refused every other shape (R86).
      return reject(state, { code: "illegalAction", message: "unknown action" });
  }

  return { state: snapshot(d), events: d.events };
}

/* -------------------------------------------------------------------- CLAIM -- */

function applyClaim(d: Draft, map: MapDef, action: Extract<Action, { type: "CLAIM" }>): void {
  const cell = d.territories[action.territory] as TerritoryState;
  if (action.forNeutral === true) {
    setTerritory(d, action.territory, { owner: SEAT_NEUTRAL, troops: cell.troops + 1 });
    d.events.push({ type: "troopsPlaced", territory: action.territory, count: 1 });
    // The neutral step is the acting seat's companion placement (R6), so the
    // turn stays where it is; the seat's own claim is what passes it on.
    advanceClaim(d, map);
    return;
  }
  const row = d.seats[action.seat] as SeatState;
  setTerritory(d, action.territory, { owner: action.seat, troops: cell.troops + 1 });
  setSeat(d, action.seat, { armiesToClaim: row.armiesToClaim - 1 });
  d.events.push({ type: "troopsPlaced", territory: action.territory, count: 1 });
  advanceClaim(d, map);
}

/**
 * R9/R6 — pass the claim on, or open the game.
 *
 * The turn passes once the acting seat has completed a **step**: one army in a
 * 3-to-6-seat game, and in the 2-seat variant R6's "2 of your own, then 1
 * neutral" — so the seat keeps the turn while its pair is half-finished or
 * while the neutral army that pair owes is still outstanding (F50).
 */
function advanceClaim(d: Draft, map: MapDef): void {
  const anySeatOwes = d.seats.some((s) => s.armiesToClaim > 0);
  const neutralOwes = neutralArmiesOwed(snapshot(d)) > 0;
  if (!anySeatOwes && !neutralOwes) {
    finishClaim(d, map);
    return;
  }
  if (neutralOwes) return; // this step's neutral army is still owed
  const acting = d.seats[d.turnOrder[d.currentIndex] as Seat];
  if (acting !== undefined && acting.armiesToClaim > 0 && troopCountFor(snapshot(d), acting.seat) % 2 === 1) {
    // Mid-pair in the 2-seat variant; a 3-to-6-seat game has no pair to be
    // mid-way through, because nothing is ever owed to a neutral there.
    if (d.seats.length === 2) return;
  }
  if (!anySeatOwes) return; // only the neutral is left; the acting seat finishes it
  d.currentIndex = nextTurnIndex(d, d.currentIndex);
  // `nextTurnIndex` skips eliminated seats; during claim it must also skip
  // exhausted ones, so step on until a seat that still owes armies is found.
  for (let step = 0; step < d.turnOrder.length; step++) {
    const row = d.seats[d.turnOrder[d.currentIndex] as Seat];
    if (row !== undefined && row.armiesToClaim > 0) return;
    d.currentIndex = nextTurnIndex(d, d.currentIndex);
  }
}

/**
 * R9/R8 — the claim phase is over. Under Manual Placement no capital could be
 * drawn at setup, because no seat had a territory yet; each seat's capital is
 * therefore **its most-garrisoned owned territory, ties broken by the lowest
 * index**.
 *
 * Deterministic, so `apply` still takes no RNG (R88), and it reads as the
 * choice a player made rather than an accident of territory numbering: the
 * stack a seat spent its claim armies building up *is* the thing it wants
 * fortified by R36's defence die. The lowest index alone handed the capital to
 * whichever tile happened to sort first, which on a real map is a corner nobody
 * reinforced. **[S1 SPEC call]**
 */
function finishClaim(d: Draft, map: MapDef): void {
  if (d.rules.capitals) {
    for (const row of d.seats) {
      if (row.capital !== null) continue;
      let best: TerritoryId | null = null;
      let bestTroops = -1;
      for (let i = 0; i < d.territories.length; i++) {
        const cell = d.territories[i] as TerritoryState;
        if (cell.blizzard || cell.owner !== row.seat) continue;
        // Strictly greater, scanning upwards: the first of a tie keeps it.
        if (cell.troops > bestTroops) {
          best = i as TerritoryId;
          bestTroops = cell.troops;
        }
      }
      if (best !== null) setSeat(d, row.seat, { capital: best });
    }
  }
  d.currentIndex = 0;
  d.events.push({ type: "phaseChanged", from: "claim", to: "draft" });
  d.phase = "draft";
  beginTurn(d, map, d.turnOrder[0] as Seat);
}

/* -------------------------------------------------------------- TRADE_CARDS -- */

function applyTrade(d: Draft, action: Extract<Action, { type: "TRADE_CARDS" }>): void {
  const row = d.seats[action.seat] as SeatState;
  const traded = action.cards.map((id) => row.cards.find((c) => c.id === id) as Card);
  const value = cardTradeValue(traded, d.setsTradedTotal, d.rules.cardBonus);
  const kept = row.cards.filter((c) => !action.cards.includes(c.id));
  setSeat(d, action.seat, { cards: sortedHand(kept), cardCount: kept.length });
  d.discard = [...d.discard, ...traded];
  // R18 — the set's armies land in the same counter the draft spends.
  d.troopsToPlace += value;
  d.setsTradedThisTurn += 1;
  d.setsTradedTotal += 1;
  d.events.push({
    type: "cardsTraded",
    seat: action.seat,
    cards: [...action.cards],
    value,
    territoryBonus: action.bonusTerritory,
  });
  // R23 — the +2 is placed immediately on the named territory and is NOT
  // added to the counter, capped at +2 per turn however many cards match.
  if (action.bonusTerritory !== null && d.territoryBonusLeft > 0) {
    const grant = Math.min(TERRITORY_BONUS, d.territoryBonusLeft);
    setTerritory(d, action.bonusTerritory, {
      troops: (d.territories[action.bonusTerritory] as TerritoryState).troops + grant,
    });
    d.territoryBonusLeft -= grant;
    d.events.push({ type: "troopsPlaced", territory: action.bonusTerritory, count: grant });
  }
}

/* ------------------------------------------------------------------- ATTACK -- */

function applyAttack(d: Draft, map: MapDef, action: Extract<Action, { type: "ATTACK" }>): void {
  const before = frozenSnapshot(d);
  const source = d.territories[action.from] as TerritoryState;
  const target = d.territories[action.to] as TerritoryState;
  const victim = target.owner;

  let attackerLosses: number;
  let defenderLosses: number;
  let diceUsed: number;
  let unresolved = false;

  if (action.mode === "manual") {
    const aug = diceAugmentFor(before, map, action.from, action.to);
    const rolled = resolveManualRoll(action.attackerDice, action.defenderDice, aug.favourDefenderOnDraw);
    attackerLosses = rolled.attackerLosses;
    defenderLosses = rolled.defenderLosses;
    diceUsed = action.attackerDice.length;
    d.events.push({
      type: "diceRolled",
      from: action.from,
      to: action.to,
      attackerDice: [...action.attackerDice].sort((a, b) => b - a),
      defenderDice: [...action.defenderDice].sort((a, b) => b - a),
    });
  } else {
    attackerLosses = action.attackerLosses;
    defenderLosses = action.defenderLosses;
    // R46 — a Blitz always rolls the best available option, so the conquering
    // roll used `min(3, A)` dice and R63's floor follows from what is left.
    diceUsed = Math.min(3, Math.max(1, source.troops - attackerLosses - 1));
    unresolved =
      action.stopUntil !== undefined &&
      defenderLosses < target.troops &&
      source.troops - attackerLosses <= action.stopUntil;
  }

  const sourceAfter = source.troops - attackerLosses;
  const targetAfter = target.troops - defenderLosses;
  setTerritory(d, action.from, { troops: sourceAfter });

  if (targetAfter > 0) {
    setTerritory(d, action.to, { troops: targetAfter });
    d.events.push({
      type: "battleResolved",
      from: action.from,
      to: action.to,
      attackerLosses,
      defenderLosses,
      conquered: false,
      unresolved,
    });
    return;
  }

  // R62 — the defender lost its last army; the territory changes hands and the
  // attacker MUST occupy it immediately (R63).
  setTerritory(d, action.to, { owner: action.seat, troops: 0 });
  d.conqueredThisTurn = true;
  d.pendingMoveIn = {
    from: action.from,
    to: action.to,
    min: Math.max(1, Math.min(diceUsed, sourceAfter - 1)),
    max: sourceAfter - 1,
  };
  d.events.push({
    type: "battleResolved",
    from: action.from,
    to: action.to,
    attackerLosses,
    defenderLosses,
    conquered: true,
    unresolved: false,
  });
  d.events.push({ type: "territoryCaptured", territory: action.to, from: victim, to: action.seat });
  emitContinentDiff(d, map, before, [action.seat, victim]);
  const eliminated = eliminateIfEmpty(d, victim, action.seat);
  // R65 — the continent and win checks run on the capture, not on the move.
  if (settle(d, map, null)) return;
  // F41 — with a move-in pending the bounce belongs to the MOVE_IN branch, which
  // is every capture: R63 pends one unconditionally. The guard is the belt for a
  // capture path that ever stops doing so; the live producer of a seizure with no
  // conquest is `END_TURN`'s R81 re-check, which bounces for itself.
  if (eliminated && d.pendingMoveIn === null) bounceForTradeDown(d, action.seat);
}

/* ------------------------------------------------------------------ MOVE_IN -- */

function applyMoveIn(d: Draft, action: Extract<Action, { type: "MOVE_IN" }>): void {
  const pending = d.pendingMoveIn as NonNullable<GameState["pendingMoveIn"]>;
  setTerritory(d, pending.from, {
    troops: (d.territories[pending.from] as TerritoryState).troops - action.count,
  });
  setTerritory(d, pending.to, {
    troops: (d.territories[pending.to] as TerritoryState).troops + action.count,
  });
  d.pendingMoveIn = null;
  d.events.push({ type: "troopsMoved", from: pending.from, to: pending.to, count: action.count });
  // F41 — this is the one site the R27 bounce is applied from, after the move.
  bounceForTradeDown(d, action.seat);
}

/* --------------------------------------------------------- END_PHASE / TURN -- */

function applyEndPhase(d: Draft): void {
  const from = d.phase;
  if (from === "draft") {
    // R27 — a forced mid-Attack trade-down returns play to attack with every
    // turn flag intact.
    const to = d.resumePhase ?? "attack";
    d.resumePhase = null;
    d.events.push({ type: "phaseChanged", from, to });
    d.phase = to;
    return;
  }
  d.events.push({ type: "phaseChanged", from, to: "fortify" });
  d.phase = "fortify";
}

function applyEndTurn(d: Draft, map: MapDef, seat: Seat): void {
  /*
   * The hand this seat held *before* R81's sweep, so the bounce below can tell a seizure from a
   * hand that was already this size — see the comment on the bounce itself.
   */
  const handBefore = d.seats[seat]?.cards.length ?? 0;
  // R81 — elimination is re-checked at END_TURN as well as on every capture.
  for (const row of d.seats.slice()) {
    if (row.seat === seat) continue;
    eliminateIfEmpty(d, row.seat, seat);
  }
  if (settle(d, map, null)) return;
  /*
   * R26/R28 — the sweep above can hand this seat a whole hand, and that seizure
   * is as much an inheritance as a capture's: it forces an immediate, same-turn
   * trade-down. So the bounce runs here too and, when it fires, the turn does
   * **not** advance — advancing would clear `resumePhase` and carry a hand of
   * seven or more into the next seat's turn, where `validate` refuses every
   * action the holder could take (codex round 2, finding 10). The seat trades
   * down, `END_PHASE` returns it to the phase it was in, and it ends its turn
   * again — by which point the victim is already eliminated and the sweep is a
   * no-op.
   *
   * It is scoped to a hand the **sweep itself grew**, because `bounceForTradeDown` tests the hand
   * and nothing else, and a hand of six reaches `END_TURN` by a second route: R20's reward draw,
   * which `validateCardDrawn` admits at five. R25 defers *that* six to the seat's next turn, so
   * bouncing it here would force the same-turn trade R25 says is not owed — and would do it after
   * `validateEndTurn` had already (correctly, post-fix) accepted the `END_TURN`
   * (codex round 3, finding 1).
   */
  const seized = (d.seats[seat]?.cards.length ?? 0) > handBefore;
  if (seized && bounceForTradeDown(d, seat)) return;

  const previousIndex = d.currentIndex;
  const nextIndex = nextTurnIndex(d, previousIndex);
  const wrapped = nextIndex <= previousIndex;
  const roundCompleted = wrapped ? d.round : null;

  d.events.push({ type: "phaseChanged", from: d.phase, to: "draft" });
  if (wrapped) d.round += 1;
  d.turn += 1;
  d.currentIndex = nextIndex;
  d.phase = "draft";
  d.troopsToPlace = 0;
  d.territoryBonusLeft = TERRITORY_BONUS_CAP;
  d.setsTradedThisTurn = 0;
  d.conqueredThisTurn = false;
  d.fortifyUsed = false;
  d.resumePhase = null;
  d.pendingMoveIn = null;

  // R77 — Max Rounds ends the game the instant END_TURN completes round N.
  if (settle(d, map, roundCompleted)) return;
  beginTurn(d, map, d.turnOrder[nextIndex] as Seat);
}

/* -------------------------------------------------------------- CARD_DRAWN -- */

function applyCardDrawn(d: Draft, action: Extract<Action, { type: "CARD_DRAWN" }>): void {
  const row = d.seats[action.seat] as SeatState;
  // R19 — when the live pool is empty the discard IS the pool, so a draw out of
  // the discard removes it from there. Nothing stores a deck order either way,
  // which is what makes the reshuffle fall out instead of being a special case.
  d.discard = d.discard.filter((c) => c.id !== action.card.id);
  setSeat(d, action.seat, {
    cards: sortedHand([...row.cards, action.card]),
    cardCount: row.cardCount + 1,
  });
  // R20 — exactly one card per turn in which the seat captured something.
  d.conqueredThisTurn = false;
  d.events.push({ type: "cardAwarded", seat: action.seat, card: action.card });
}

/* ---------------------------------------------------------------- alliances -- */

function addAlly(d: Draft, a: Seat, b: Seat): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const row = d.seats[x];
    if (row === undefined || row.allies.includes(y)) continue;
    setSeat(d, x, { allies: [...row.allies, y].sort((p, q) => p - q) });
  }
}

/**
 * Record an unanswered R80 offer (§4.7). Idempotent, so a re-folded log cannot double an entry —
 * `validateAlliance` refuses the repeat before this is reached, and this stays total regardless.
 */
function addPendingAlliance(d: Draft, from: Seat, to: Seat): void {
  if (d.pendingAlliances.some(([a, b]) => a === from && b === to)) return;
  d.pendingAlliances = [...d.pendingAlliances, [from, to] as const];
}

/** Drop the offers between two seats, in **both** directions: an alliance is symmetric (R80). */
function clearPendingAlliance(d: Draft, a: Seat, b: Seat): void {
  d.pendingAlliances = d.pendingAlliances.filter(
    ([from, to]) => !((from === a && to === b) || (from === b && to === a)),
  );
}

/**
 * Take a seat out of R80's diplomacy entirely: every unanswered offer it is party to **and every
 * pact it holds** (R80, R81, R82, §4.7).
 *
 * The pact half was missing (codex round 4, finding 4). An elimination or a resignation dropped the
 * offers and left the pacts standing, so every survivor kept an `allies` entry naming a seat that
 * was out: `legalActions` advertised `ALLIANCE_BREAK` for it and `validateAlliance` refused that
 * same action with `notAlliable` ("both seats must still be playing"), which is a dead entry in the
 * list and a dead button in the UI. R80 is explicit that an elimination and a resignation clear the
 * pair, so the clearing happens here, at the source, and emits the `allianceChanged … "broken"`
 * every other end of a pact emits — the renderer and the dialog have no other way to learn of it.
 */
function dropAlliancesFor(d: Draft, seat: Seat): void {
  d.pendingAlliances = d.pendingAlliances.filter(([from, to]) => from !== seat && to !== seat);
  const row = d.seats[seat];
  if (row === undefined) return;
  // Ascending, so the event order is a function of the state and not of the array's history (R91).
  for (const other of [...row.allies].sort((a, b) => a - b)) {
    removeAlly(d, seat, other);
    d.events.push({ type: "allianceChanged", a: seat, b: other, state: "broken" });
  }
}

function removeAlly(d: Draft, a: Seat, b: Seat): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const row = d.seats[x];
    if (row === undefined) continue;
    setSeat(d, x, { allies: row.allies.filter((s) => s !== y) });
  }
}
