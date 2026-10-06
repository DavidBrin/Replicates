/**
 * `validate(state, map, action)` — why an action would be refused, or `null`
 * (R86, and every rule it cites).
 *
 * This is the whole of the rules' *no* side, in one file, so `apply` can be a
 * transformer that has already been told the action is legal. Nothing here
 * throws and nothing here mutates: an illegal action is **data** (R86), and
 * the one door out is a `RuleError` whose `code` the UI maps to copy.
 *
 * Two shapes recur and are deliberate:
 *
 * - every branch re-derives what it needs from `state` and `map` rather than
 *   trusting the action, because an action arrives over the wire (D10);
 * - an unknown `type` falls through to `illegalAction` rather than off the end
 *   of a switch, which is what keeps `apply` total under fast-check (T5).
 */
import { isValidSet, mustTradeDown, mustTradeNow, remainingDeck } from "./cards";
import { areAdjacent, isBlizzard, knownTerritory, reachableOwn } from "./graph";
import { dicePlan, isAttackable, resolveManualRoll, diceAugmentFor } from "./modifiers";
import { currentSeat, isContender, isGameOver, takesTurns, troopCountFor } from "./rules";
import {
  SEAT_NEUTRAL,
  SEAT_NONE,
  type Action,
  type Card,
  type GameState,
  type MapDef,
  type RuleError,
  type RuleErrorCode,
  type Seat,
  type SeatState,
  type TerritoryId,
} from "./types";

function err(code: RuleErrorCode, message: string): RuleError {
  return { code, message };
}

/** The seat row for an index, or null for the neutral sentinel and for nonsense. */
export function seatRow(state: GameState, seat: Seat): SeatState | null {
  if (!Number.isInteger(seat) || seat < 0) return null;
  return state.seats[seat] ?? null;
}

/** It must be `seat`'s turn, and `seat` must still be playing. */
function turnGate(state: GameState, seat: Seat): RuleError | null {
  const row = seatRow(state, seat);
  if (row === null) return err("illegalAction", `seat ${String(seat)} is not a seat`);
  if (!takesTurns(row)) return err("notYourTurn", `seat ${String(seat)} is ${row.standing}`);
  if (currentSeat(state) !== seat) return err("notYourTurn", `it is seat ${String(currentSeat(state))}'s turn`);
  return null;
}

/** A territory index must name a real territory. */
function territoryGate(map: MapDef, t: TerritoryId): RuleError | null {
  return knownTerritory(map, t) ? null : err("unknownTerritory", `territory ${String(t)} is not on this map`);
}

/**
 * The armies the neutral holding still owes during a manual claim phase
 * (R6, F50).
 *
 * R6's alternation is "the acting seat places 2 on its own, then 1 neutral
 * army", and **when a seat's remainder is odd its final step places 1, not 2**
 * (F50) — so the neutral is owed one army per completed pair, plus one for a
 * final odd step. That is derived rather than stored: under Manual Placement
 * every army on a seat's territory arrived through a `CLAIM`, so the seat's
 * troop total *is* its placed count, and `STARTING_ARMIES[2] = 40` never has
 * to be threaded through `GameState`.
 *
 * On the real 2-seat board this comes out exactly right: 40 own armies each
 * means `2 * floor(40 / 2) = 40` neutral armies, which is the variant's third
 * 40-army holding (R2, D64).
 */
export function neutralArmiesOwed(state: GameState): number {
  if (!state.rules.manualPlacement) return 0;
  if (state.seats.length !== 2) return 0;
  let due = 0;
  for (const row of state.seats) {
    const placed = troopCountFor(state, row.seat);
    due += Math.floor(placed / 2);
    if (row.armiesToClaim === 0 && placed % 2 === 1) due += 1;
  }
  let placed = 0;
  for (const t of state.territories) if (t.owner === SEAT_NEUTRAL) placed += t.troops;
  return Math.max(0, due - placed);
}

/** The cards named by an id triple, in the order given, or null if any is not held. */
export function heldCards(row: SeatState, ids: readonly string[]): readonly Card[] | null {
  const out: Card[] = [];
  for (const id of ids) {
    const card = row.cards.find((c) => c.id === id);
    if (card === undefined) return null;
    if (out.some((c) => c.id === id)) return null;
    out.push(card);
  }
  return out;
}

/** The dice plan plus the losses a manual roll implies (R31). */
export function manualOutcome(
  state: GameState,
  map: MapDef,
  from: TerritoryId,
  to: TerritoryId,
  attackerDice: readonly number[],
  defenderDice: readonly number[],
): { attackerLosses: number; defenderLosses: number } {
  const aug = diceAugmentFor(state, map, from, to);
  return resolveManualRoll(attackerDice, defenderDice, aug.favourDefenderOnDraw);
}

/* -------------------------------------------------------------------------- */

export function validate(state: GameState, map: MapDef, action: Action): RuleError | null {
  if (typeof action !== "object" || action === null || typeof (action as { type?: unknown }).type !== "string") {
    return err("illegalAction", "not an action");
  }
  // GAME_STARTED re-opens the board rather than changing it, so the game-over
  // gate does not apply to it; every other action is refused once an outcome
  // exists (R83).
  if (action.type !== "GAME_STARTED" && isGameOver(state)) return err("gameOver", "the game is over");

  /*
   * R28 / F51 — a hand of seven or more is a rule violation like any other:
   * `apply` returns `illegalAction` and never asserts or throws. The one way
   * out of such a state is R26's forced trade-down, so `TRADE_CARDS` is the
   * single action still accepted from that seat.
   *
   * The guard stays at SEVEN and is deliberately **not** widened to R26's floor
   * of four. A hand of five mid-trade-down is already refused with the precise
   * `mustTradeCards` code by every action `mustTradeDown` gates — `DRAFT`,
   * `AUTO_DEPLOY`, `END_PHASE`, `END_TURN` — while `ATTACK` and `FORTIFY` are
   * unreachable from the bounced `draft` phase. A blanket gate here would block
   * the bounce itself.
   *
   * **`MOVE_IN` is exempt, not just `TRADE_CARDS`** (F41). A seizure arrives on
   * a capture and a capture always sets `pendingMoveIn`, so the R27 bounce that
   * is the only way *out* of a seven-or-more hand sits behind `MOVE_IN`: the
   * reducer applies it after the troops move. Gating `MOVE_IN` here wedged every
   * elimination that lifted the hand past six — `legalActions` offered
   * `["MOVE_IN"]`, `validate` refused it, and `TRADE_CARDS` is refused outside
   * `draft` — so a 4-card attacker eliminating a 4-card victim could take no
   * action at all (codex round 2, finding 2). `validateMoveIn` still pins the
   * count to `pendingMoveIn`'s own window, so the exemption lets through exactly
   * the one action R63 already demands.
   */
  const actor = (action as { seat?: unknown }).seat;
  if (typeof actor === "number" && action.type !== "TRADE_CARDS" && action.type !== "MOVE_IN") {
    const row = seatRow(state, actor);
    if (row !== null && row.cards.length > 6) {
      return err("illegalAction", "a hand of seven or more cards must be traded down first (R28)");
    }
  }

  switch (action.type) {
    case "GAME_STARTED":
      return validateGameStarted(map, action);
    case "CLAIM":
      return validateClaim(state, map, action);
    case "TRADE_CARDS":
      return validateTrade(state, map, action);
    case "DRAFT":
      return validateDraft(state, map, action);
    case "ATTACK":
      return validateAttack(state, map, action);
    case "MOVE_IN":
      return validateMoveIn(state, action);
    case "FORTIFY":
      return validateFortify(state, map, action);
    case "END_PHASE":
      return validateEndPhase(state, action);
    case "END_TURN":
      return validateEndTurn(state, action);
    case "CARD_DRAWN":
      return validateCardDrawn(state, map, action);
    case "AUTO_DEPLOY":
      return validateAutoDeploy(state, map, action);
    case "SEAT_TO_BOT":
      return validateSeatToBot(state, action);
    case "SEAT_TO_HUMAN":
      return validateSeatToHuman(state, action);
    case "PORTALS_MOVED":
      return validatePortalsMoved(state, map, action);
    case "ALLIANCE_PROPOSE":
    case "ALLIANCE_ACCEPT":
    case "ALLIANCE_BREAK":
      return validateAlliance(state, action);
    default:
      return err("illegalAction", `unknown action type ${String((action as { type: string }).type)}`);
  }
}

/* ------------------------------------------------------------ GAME_STARTED -- */

function validateGameStarted(map: MapDef, action: Extract<Action, { type: "GAME_STARTED" }>): RuleError | null {
  if (action.mapSlug !== map.slug) return err("illegalAction", "GAME_STARTED is for a different map");
  if (action.seats.length < 2 || action.seats.length > 6) return err("illegalAction", "a game seats 2 to 6 (R1)");
  if (action.turnOrder.length !== action.seats.length) return err("illegalAction", "turnOrder must list every seat");
  const seen = new Set<Seat>();
  for (const seat of action.turnOrder) {
    if (seat < 0 || seat >= action.seats.length || seen.has(seat)) {
      return err("illegalAction", "turnOrder must be a permutation of the seats (R4)");
    }
    seen.add(seat);
  }
  for (const t of action.blizzards) {
    const bad = territoryGate(map, t);
    if (bad !== null) return bad;
  }
  const blizzards = new Set(action.blizzards);
  for (const entry of action.deal) {
    const bad = territoryGate(map, entry.territory);
    if (bad !== null) return bad;
    if (blizzards.has(entry.territory)) return err("blizzard", "a blizzard tile is never dealt (R10)");
    if (entry.troops < 1) return err("tooFewTroops", "a dealt territory holds at least one army (R3)");
  }
  for (const portal of action.portals) {
    for (const t of [portal.a, portal.b]) {
      const bad = territoryGate(map, t);
      if (bad !== null) return bad;
      if (blizzards.has(t)) return err("blizzard", "a portal never touches a blizzard (R11)");
    }
  }
  for (const capital of action.capitals) {
    if (capital === null) continue;
    const bad = territoryGate(map, capital);
    if (bad !== null) return bad;
    if (blizzards.has(capital)) return err("blizzard", "a capital is never a blizzard (R8, R10)");
  }
  return null;
}

/* -------------------------------------------------------------------- CLAIM -- */

function validateClaim(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "CLAIM" }>,
): RuleError | null {
  if (state.phase !== "claim") return err("wrongPhase", "CLAIM belongs to the claim phase (R9)");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  const bad = territoryGate(map, action.territory);
  if (bad !== null) return bad;
  if (isBlizzard(state, action.territory)) return err("blizzard", "a blizzard is never claimed (R74)");
  const cell = state.territories[action.territory] as { owner: Seat };
  const row = seatRow(state, action.seat) as SeatState;

  if (action.forNeutral === true) {
    if (state.seats.length !== 2) return err("illegalAction", "only the 2-seat variant has a neutral (R6, R7)");
    if (neutralArmiesOwed(state) <= 0) return err("tooManyTroops", "the neutral holding is fully placed (R6)");
    if (cell.owner !== SEAT_NEUTRAL && cell.owner !== SEAT_NONE) {
      return err("notOwned", "a neutral army lands on a neutral territory (R6)");
    }
    return null;
  }

  if (row.armiesToClaim <= 0) return err("tooManyTroops", "this seat has placed every starting army (R9)");
  // R6 — the neutral army owed by the step just completed comes first; the
  // alternation is mandatory, not a courtesy.
  if (neutralArmiesOwed(state) > 0) {
    return err("mustPlaceAllTroops", "place the neutral army this step owes first (R6)");
  }
  const anyUnclaimed = state.territories.some((t) => !t.blizzard && t.owner === SEAT_NONE);
  if (anyUnclaimed) {
    if (cell.owner !== SEAT_NONE) return err("notOwned", "claim an unowned territory while any remain (R9)");
  } else if (cell.owner !== action.seat) {
    return err("notOwned", "once the board is claimed, reinforce your own (R9)");
  }
  return null;
}

/* -------------------------------------------------------------- TRADE_CARDS -- */

function validateTrade(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "TRADE_CARDS" }>,
): RuleError | null {
  if (state.phase !== "draft") return err("wrongPhase", "cards are traded in draft (R24, R27)");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  const row = seatRow(state, action.seat) as SeatState;
  if (!Array.isArray(action.cards) || action.cards.length !== 3) {
    return err("invalidSet", "a set is exactly three cards (R21)");
  }
  const cards = heldCards(row, action.cards);
  if (cards === null) return err("notHeld", "you do not hold those three cards");
  if (!isValidSet(cards)) return err("invalidSet", "not a valid set (R21)");
  if (action.bonusTerritory !== null) {
    const bad = territoryGate(map, action.bonusTerritory);
    if (bad !== null) return bad;
    if (state.territoryBonusLeft <= 0) return err("tooManyTroops", "the +2 territory bonus is capped per turn (R23)");
    if (!cards.some((c) => c.territory === action.bonusTerritory)) {
      return err("notHeld", "the bonus territory must be named by a traded card (R23)");
    }
    if (state.territories[action.bonusTerritory]?.owner !== action.seat) {
      return err("notOwned", "the bonus lands on a territory you occupy (R23)");
    }
  }
  return null;
}

/* -------------------------------------------------------------------- DRAFT -- */

function validateDraft(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "DRAFT" }>,
): RuleError | null {
  if (state.phase !== "draft") return err("wrongPhase", "DRAFT belongs to the draft phase");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (mustTradeNow(state, action.seat)) return err("mustTradeCards", "you must trade a set first (R24, R26)");
  const bad = territoryGate(map, action.territory);
  if (bad !== null) return bad;
  if (isBlizzard(state, action.territory)) return err("blizzard", "a blizzard takes no troops (R74)");
  if (state.territories[action.territory]?.owner !== action.seat) {
    return err("notOwned", "draft onto your own territory (R16)");
  }
  if (!Number.isInteger(action.count) || action.count < 1) return err("tooFewTroops", "place at least one troop (R16)");
  if (action.count > state.troopsToPlace) return err("tooManyTroops", "you do not have that many troops (R16)");
  return null;
}

/* ------------------------------------------------------------------- ATTACK -- */

function validateAttack(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "ATTACK" }>,
): RuleError | null {
  if (state.phase !== "attack") return err("wrongPhase", "ATTACK belongs to the attack phase");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (state.pendingMoveIn !== null) return err("moveInPending", "occupy the conquered territory first (R63)");
  for (const t of [action.from, action.to]) {
    const bad = territoryGate(map, t);
    if (bad !== null) return bad;
  }
  if (action.from === action.to) return err("notAdjacent", "a territory cannot attack itself");
  if (state.territories[action.from]?.owner !== action.seat) return err("notOwned", "attack from your own (R29)");
  if (isBlizzard(state, action.to)) return err("blizzard", "a blizzard is unconquerable (R74)");
  if (!isAttackable(state, action.seat, action.to)) return err("notOwned", "that territory is already yours (R29)");
  if (!areAdjacent(state, map, action.from, action.to)) {
    return err("notAdjacent", "attack needs a direct edge, sea link or active portal (R29, R69)");
  }
  const sourceTroops = state.territories[action.from]?.troops ?? 0;
  const targetTroops = state.territories[action.to]?.troops ?? 0;
  if (sourceTroops < 2) return err("tooFewTroops", "attack from at least two troops (R29, R33)");
  const plan = dicePlan(state, map, action.from, action.to);

  if (action.mode === "manual") {
    if (!Array.isArray(action.attackerDice) || !Array.isArray(action.defenderDice)) {
      return err("diceCount", "a manual roll carries both dice arrays (R61)");
    }
    if (action.attackerDice.length < 1 || action.attackerDice.length > plan.maxAttackDice) {
      return err("diceCount", `the attacker may roll 1 to ${String(plan.maxAttackDice)} dice here (R30, R33)`);
    }
    if (action.defenderDice.length !== plan.defendDice) {
      return err("diceCount", `the defender rolls ${String(plan.defendDice)} dice here (R30, R33)`);
    }
    for (const value of [...action.attackerDice, ...action.defenderDice]) {
      if (!Number.isInteger(value) || value < 1 || value > 6) return err("diceCount", "a die shows 1 to 6");
    }
    const losses = manualOutcome(
      state,
      map,
      action.from,
      action.to,
      action.attackerDice,
      action.defenderDice,
    );
    if (losses.defenderLosses >= targetTroops && sourceTroops - losses.attackerLosses < 2) {
      return err("tooFewTroops", "a conquest must leave an army behind and move one in (R62, R63)");
    }
    return null;
  }

  if (action.mode === "blitz") {
    const { attackerLosses, defenderLosses, stopUntil } = action;
    if (!Number.isInteger(attackerLosses) || attackerLosses < 0) return err("illegalAction", "bad attacker losses");
    if (!Number.isInteger(defenderLosses) || defenderLosses < 0) return err("illegalAction", "bad defender losses");
    if (attackerLosses > sourceTroops - 1) return err("tooManyTroops", "an army always stays behind (R30, R38)");
    if (defenderLosses > targetTroops) return err("tooManyTroops", "the defender cannot lose more than it holds");
    if (stopUntil !== undefined) {
      if (!Number.isInteger(stopUntil) || stopUntil < 1) return err("illegalAction", "stopUntil is at least 1 (R48)");
      if (stopUntil >= sourceTroops) return err("tooFewTroops", "stopUntil must commit at least one troop (R48)");
    }
    if (defenderLosses >= targetTroops && sourceTroops - attackerLosses < 2) {
      return err("tooFewTroops", "a conquest must leave an army behind and move one in (R62, R63)");
    }
    return null;
  }

  return err("illegalAction", "an ATTACK is blitz or manual (R46, R61)");
}

/* ------------------------------------------------------------------ MOVE_IN -- */

function validateMoveIn(state: GameState, action: Extract<Action, { type: "MOVE_IN" }>): RuleError | null {
  const pending = state.pendingMoveIn;
  if (pending === null) return err("illegalAction", "nothing is waiting to be occupied (R62)");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (!Number.isInteger(action.count)) return err("moveInRange", "a troop count is an integer");
  if (action.count < pending.min || action.count > pending.max) {
    return err("moveInRange", `move ${String(pending.min)} to ${String(pending.max)} troops in (R63)`);
  }
  return null;
}

/* ------------------------------------------------------------------ FORTIFY -- */

function validateFortify(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "FORTIFY" }>,
): RuleError | null {
  if (state.phase !== "fortify") return err("wrongPhase", "FORTIFY belongs to the fortify phase");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (state.fortifyUsed) return err("fortifyUsed", "one fortify move per turn (R66)");
  for (const t of [action.from, action.to]) {
    const bad = territoryGate(map, t);
    if (bad !== null) return bad;
  }
  if (action.from === action.to) return err("noPath", "a fortify needs two different territories");
  if (isBlizzard(state, action.to) || isBlizzard(state, action.from)) {
    return err("blizzard", "a blizzard is never a fortify endpoint (R74)");
  }
  if (state.territories[action.from]?.owner !== action.seat) return err("notOwned", "fortify from your own (R66)");
  if (state.territories[action.to]?.owner !== action.seat) return err("notOwned", "fortify into your own (R66)");
  const sourceTroops = state.territories[action.from]?.troops ?? 0;
  if (sourceTroops < 2) return err("tooFewTroops", "an army must stay behind (R66)");
  if (!Number.isInteger(action.count) || action.count < 1) return err("tooFewTroops", "move at least one troop (R66)");
  if (action.count > sourceTroops - 1) return err("tooManyTroops", "an army must stay behind (R66)");
  if (!reachableOwn(state, map, action.from, action.seat).includes(action.to)) {
    return err("noPath", "no connected path through your own territories (R66, R68)");
  }
  return null;
}

/* --------------------------------------------------------- END_PHASE / TURN -- */

function validateEndPhase(state: GameState, action: Extract<Action, { type: "END_PHASE" }>): RuleError | null {
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (state.phase === "draft") {
    if (mustTradeNow(state, action.seat)) return err("mustTradeCards", "you must trade a set first (R24, R26)");
    if (state.troopsToPlace > 0) {
      return err("mustPlaceAllTroops", "you must draft all of your available troops (R17)");
    }
    return null;
  }
  if (state.phase === "attack") {
    if (state.pendingMoveIn !== null) return err("moveInPending", "occupy the conquered territory first (R63)");
    return null;
  }
  if (state.phase === "fortify") return err("wrongPhase", "END_PHASE is not legal out of fortify (R67)");
  return err("wrongPhase", `END_PHASE is not legal in ${state.phase}`);
}

function validateEndTurn(state: GameState, action: Extract<Action, { type: "END_TURN" }>): RuleError | null {
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (state.phase === "claim" || state.phase === "over") {
    return err("wrongPhase", `END_TURN is not legal in ${state.phase}`);
  }
  if (state.pendingMoveIn !== null) return err("moveInPending", "occupy the conquered territory first (R63)");
  if (mustTradeDown(state, action.seat)) return err("mustTradeCards", "trade down to four cards first (R26)");
  if (state.phase === "draft" && state.troopsToPlace > 0) {
    return err("mustPlaceAllTroops", "you must draft all of your available troops (R17)");
  }
  return null;
}

/* -------------------------------------------------------------- CARD_DRAWN -- */

function validateCardDrawn(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "CARD_DRAWN" }>,
): RuleError | null {
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  /*
   * R20/R67 — the award is the END OF THE TURN's, and `END_TURN` is the only
   * exit from fortify, so `fortify` is the one phase it lands in (§5.2: the
   * authority resolves `drawCard` and appends `CARD_DRAWN` immediately before
   * `END_TURN`). Pinning the phase is what keeps it to **exactly one** card
   * per capturing turn: `conqueredThisTurn` is cleared by the award, and a
   * later capture in the same turn would otherwise set it again.
   */
  if (state.phase !== "fortify") return err("wrongPhase", "the card is awarded at the end of the turn (R20, R67)");
  if (!state.conqueredThisTurn) return err("illegalAction", "a card is earned by capturing (R20)");
  const row = seatRow(state, action.seat) as SeatState;
  // R28/F51: a hand never legally exceeds six, and a state that would present
  // seven is a rule violation like any other — data, never an exception.
  if (row.cards.length >= 6) return err("illegalAction", "a hand never exceeds six cards (R28)");
  const card = action.card;
  if (typeof card !== "object" || card === null || typeof card.id !== "string") {
    return err("illegalAction", "CARD_DRAWN carries a card");
  }
  const pool = remainingDeck(state, map);
  const inPool = pool.some((c) => c.id === card.id);
  const inDiscard = state.discard.some((c) => c.id === card.id);
  // When the pool is empty the discard is reshuffled and becomes the pool (R19).
  if (!inPool && !(pool.length === 0 && inDiscard)) {
    return err("illegalAction", `card ${card.id} is not in the deck (R19)`);
  }
  return null;
}

/* ------------------------------------------------------------- AUTO_DEPLOY -- */

function validateAutoDeploy(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "AUTO_DEPLOY" }>,
): RuleError | null {
  if (state.phase !== "draft") return err("wrongPhase", "AUTO_DEPLOY places draft troops");
  const gate = turnGate(state, action.seat);
  if (gate !== null) return gate;
  if (mustTradeNow(state, action.seat)) return err("mustTradeCards", "you must trade a set first (R24, R26)");
  if (!Array.isArray(action.placements) || action.placements.length === 0) {
    return err("illegalAction", "AUTO_DEPLOY carries at least one placement");
  }
  let total = 0;
  for (const placement of action.placements) {
    const bad = territoryGate(map, placement.territory);
    if (bad !== null) return bad;
    if (isBlizzard(state, placement.territory)) return err("blizzard", "a blizzard takes no troops (R74)");
    if (state.territories[placement.territory]?.owner !== action.seat) {
      return err("notOwned", "deploy onto your own territory (R16)");
    }
    if (!Number.isInteger(placement.count) || placement.count < 1) {
      return err("tooFewTroops", "a placement is at least one troop");
    }
    total += placement.count;
  }
  if (total !== state.troopsToPlace) return err("mustPlaceAllTroops", "AUTO_DEPLOY places every troop (R17)");
  return null;
}

/* ------------------------------------------------------------ seat handover -- */

function validateSeatToBot(state: GameState, action: Extract<Action, { type: "SEAT_TO_BOT" }>): RuleError | null {
  const row = seatRow(state, action.seat);
  if (row === null) return err("illegalAction", "no such seat");
  if (row.standing === "eliminated") return err("illegalAction", "an eliminated seat is not taken over (R81)");
  if (row.standing === "resigned") return err("illegalAction", "a resigned seat cannot change hands again (R82)");
  if (action.reason !== "away" && action.reason !== "timeout" && action.reason !== "resigned") {
    return err("illegalAction", "SEAT_TO_BOT carries a reason (D76)");
  }
  if (typeof action.persona !== "object" || action.persona === null) {
    return err("illegalAction", "SEAT_TO_BOT carries the persona the bot plays (D28)");
  }
  return null;
}

function validateSeatToHuman(
  state: GameState,
  action: Extract<Action, { type: "SEAT_TO_HUMAN" }>,
): RuleError | null {
  const row = seatRow(state, action.seat);
  if (row === null) return err("illegalAction", "no such seat");
  if (row.standing === "eliminated") return err("illegalAction", "an eliminated seat is not reclaimed (R81)");
  if (row.standing === "resigned") return err("illegalAction", "a resigned seat cannot be reclaimed (R82, D76)");
  return null;
}

/* ----------------------------------------------------------- PORTALS_MOVED -- */

function validatePortalsMoved(
  state: GameState,
  map: MapDef,
  action: Extract<Action, { type: "PORTALS_MOVED" }>,
): RuleError | null {
  if (state.rules.portals !== "unstable") return err("illegalAction", "only unstable portals relocate (R75, R76)");
  if (!Array.isArray(action.portals)) return err("illegalAction", "PORTALS_MOVED carries the new portals");
  const used = new Set<TerritoryId>();
  for (const portal of action.portals) {
    for (const t of [portal.a, portal.b]) {
      const bad = territoryGate(map, t);
      if (bad !== null) return bad;
      if (isBlizzard(state, t)) return err("blizzard", "a portal never touches a blizzard (R11)");
      if (used.has(t)) return err("illegalAction", "no territory sits in two portals (R11)");
      used.add(t);
    }
    if (portal.a === portal.b) return err("illegalAction", "a portal links two different territories (R11)");
    if ((map.adjacency[portal.a] ?? []).includes(portal.b)) {
      return err("notAdjacent", "a portal links NON-adjacent territories (R11)");
    }
  }
  return null;
}

/* ---------------------------------------------------------------- alliances -- */

function validateAlliance(
  state: GameState,
  action: Extract<Action, { type: "ALLIANCE_PROPOSE" | "ALLIANCE_ACCEPT" | "ALLIANCE_BREAK" }>,
): RuleError | null {
  if (!state.rules.alliances) return err("notAlliable", "alliances are off in this game (R80)");
  const me = seatRow(state, action.seat);
  const otherSeat =
    action.type === "ALLIANCE_PROPOSE" ? action.to : action.type === "ALLIANCE_ACCEPT" ? action.from : action.with;
  const them = seatRow(state, otherSeat);
  if (me === null || them === null) return err("notAlliable", "an alliance is between two seats (R80)");
  if (me.seat === them.seat) return err("notAlliable", "a seat cannot ally with itself");
  if (!isContender(me) || !isContender(them)) {
    return err("notAlliable", "both seats must still be playing (R80)");
  }
  const already = me.allies.includes(them.seat);
  if (action.type === "ALLIANCE_BREAK" && !already) return err("notAlliable", "you are not allied (R80)");
  if (action.type !== "ALLIANCE_BREAK" && already) return err("notAlliable", "you are already allied (R80)");
  /*
   * R80 — one offer at a time per pair.
   *
   * The three alliance actions are the only ones exempt from the online turn fence (an offer you
   * could only accept on your own turn is an offer nobody would take), so with repeats accepted a
   * seated player could append the same `ALLIANCE_PROPOSE` as fast as it could POST: every repeat
   * was a log row, every row bumped `games.seq`, and the poll's `204` fast path went with it
   * (codex round 3, finding 4). The offer is already in the air; re-sending it says nothing new.
   *
   * It is refused in **both** directions, because an alliance is symmetric: when the other seat has
   * already offered, the answer is `ALLIANCE_ACCEPT`, not a counter-offer. `ALLIANCE_ACCEPT`,
   * `ALLIANCE_BREAK`, an elimination and a resignation all clear the pair, so the pair is never a
   * permanent lock-out.
   */
  if (action.type === "ALLIANCE_PROPOSE") {
    const pending = state.pendingAlliances.some(
      ([from, to]) =>
        (from === me.seat && to === them.seat) || (from === them.seat && to === me.seat),
    );
    if (pending) return err("notAlliable", "that proposal is already on the table (R80)");
  }
  return null;
}
