import "server-only";

import { config } from "@/config/env";
import { SEAT_NEUTRAL, SEAT_NONE } from "@/engine/types";
import type {
  Action,
  BotPersona,
  GameState,
  MapDef,
  OddsTables,
  Rules,
  Seat,
  TerritoryId,
} from "@/engine/types";
import type { LoggedAction } from "@/ports/sync";

import type { ServerEngine } from "./engine";

/**
 * The pure half of the server's game logic: folding the log, deciding what a
 * timed-out seat does, and turning a bot's `TurnPlan` into the next single
 * action.
 *
 * Nothing here touches the database or the clock, which is what lets the
 * route tests drive all of it against an injected fake engine — a
 * counter-state `apply`, a fixed `hashState`, a `rollAttack` with fixed dice
 * and a one-action `decideTurn`.
 *
 * Two constants from §5.6 live here because both the tick and the submit path
 * read them.
 */

/** Per §5.6: a chain of consecutive bot seats is capped, not unrolled. */
export const MAX_TICK_ACTIONS = 40;
/** How long one poll owns the tick before another may take it over. */
export const TICK_LEASE_SECONDS = 10;
/** The default online turn timer when a lobby did not choose one (R79). */
export const DEFAULT_TURN_SECONDS = 90;
/** `last_seen_at` older than this and the seat is "gone, whatever their turn count". */
export const AWAY_SECONDS = 120;
/** Missed turns before the seat is handed to a bot with `reason: "timeout"`. */
export const MISSED_TURNS_TO_BOT = 2;
/**
 * How far the lagging snapshot may trail `seq` before it is refolded.
 *
 * The snapshot is a **cache of the log's fold**, not a second source of
 * truth, and it deliberately lags: if it were rewritten on every append then
 * `snapshot_seq` would always equal `seq`, every client behind by one action
 * would fall into §6's `since < snapshot_seq` branch, and a one-action change
 * would cost a whole snapshot — which is the single regression that would
 * blow the cost envelope (T12). Lagging keeps `since >= snapshot_seq → delta`
 * the common branch and keeps the `since < snapshot_seq` branch reachable,
 * which is the case §6.3's compaction sweep exists for.
 */
export const COMPACTION_THRESHOLD = 50;

/**
 * The seat whose turn it is, read off the state rather than the `games` row.
 *
 * `games.current_seat` is a denormalised copy for the tick's one-statement
 * fast path; the state is the truth, and the two are written together.
 */
export function currentSeatOf(state: GameState): Seat {
  const order = state.turnOrder;
  const seat = order[state.currentIndex];
  // A state whose `currentIndex` is out of range is a bug in `apply`, not
  // something to paper over — but a 500 from a poll is worse than falling
  // back to the first seat in order, which is what a fresh turn looks like.
  return seat ?? order[0] ?? 0;
}

/** The effective turn timer: `RISK_TURN_SECONDS` wins over the lobby's rules. */
export function turnSecondsFor(rules: Rules): number | null {
  const override = config().online.turnSecondsOverride;
  if (override !== undefined) return override;
  return rules.turnSeconds;
}

/** Fold `actions` into `state`, in `seq` order. Throws on a rule error. */
export function foldActions(
  engine: ServerEngine,
  state: GameState,
  map: MapDef,
  actions: readonly LoggedAction[],
): GameState {
  let current = state;
  for (const logged of actions) {
    const result = engine.apply(current, map, logged.action);
    if (result.error) {
      throw new Error(
        `log is not foldable at seq ${logged.seq}: ${result.error.code} ${result.error.message}`,
      );
    }
    current = result.state;
  }
  return current;
}

/* ------------------------------------------------------------- auto-skip -- */

/**
 * Spread `troops` over `targets` round-robin, lowest territory id first.
 *
 * §5.6 says a timed-out draft's `AUTO_DEPLOY` placements are "chosen by the
 * bot policy". They are chosen here instead, and deliberately: the bot policy
 * needs a `BotPersona`, a human seat has none, and minting one for a seat
 * that is about to be handed back to its owner would put a persona into the
 * log that nothing ever plays. An even spread is deterministic, needs no
 * persona and no RNG, and is a visibly fair "you were not here" move.
 */
export function spreadPlacements(
  targets: readonly TerritoryId[],
  troops: number,
): { territory: TerritoryId; count: number }[] {
  if (targets.length === 0 || troops <= 0) return [];
  const sorted = [...targets].sort((a, b) => a - b);
  const counts = new Map<TerritoryId, number>();
  for (let i = 0; i < troops; i += 1) {
    const territory = sorted[i % sorted.length]!;
    counts.set(territory, (counts.get(territory) ?? 0) + 1);
  }
  return [...counts.entries()].map(([territory, count]) => ({ territory, count }));
}

/**
 * The claim-phase candidates a timed-out seat is offered, lowest id first.
 *
 * The claim phase has **no `END_TURN` and no `END_PHASE`** — `validate`
 * refuses both in `claim` — so without a `CLAIM` here a seat that times out
 * during Manual Placement wedges the game: the tick finds no legal action,
 * appends nothing, and every later poll repeats the same no-op.
 *
 * The 2-seat variant's alternation (R6) is not reimplemented: the neutral
 * candidates are simply offered first and `validate` arbitrates. It refuses
 * `forNeutral` when nothing is owed and refuses an own claim while one is, so
 * whichever of the two R6 demands is the one that survives.
 */
function claimCandidates(state: GameState, seat: Seat): Action[] {
  const first = (owner: (value: Seat) => boolean): TerritoryId | null => {
    for (let index = 0; index < state.territories.length; index += 1) {
      const cell = state.territories[index];
      if (cell === undefined || cell.blizzard) continue;
      if (owner(cell.owner)) return index;
    }
    return null;
  };

  const candidates: Action[] = [];
  const push = (territory: TerritoryId | null, forNeutral: boolean): void => {
    if (territory === null) return;
    candidates.push(
      forNeutral
        ? { type: "CLAIM", seat, territory, forNeutral: true }
        : { type: "CLAIM", seat, territory },
    );
  };

  // The neutral army lands on the neutral holding when there is one, and on an
  // unclaimed territory otherwise (R6).
  push(
    first((owner) => owner === SEAT_NEUTRAL),
    true,
  );
  push(
    first((owner) => owner === SEAT_NONE),
    true,
  );
  // The seat's own claim: an unowned territory while any remain, then a
  // reinforcement of its own (R9).
  push(
    first((owner) => owner === SEAT_NONE),
    false,
  );
  push(
    first((owner) => owner === seat),
    false,
  );
  return candidates;
}

/**
 * The next action a timed-out seat takes, or `null` when it cannot move.
 *
 * Candidates are offered in order and the first one `validate` accepts wins,
 * so this needs to know nothing about which transitions the reducer allows —
 * which matters, because §3's phase machine is S1's and `END_TURN` out of
 * `draft` is exactly the sort of thing that is legal in one reading and not
 * in another. §5.6's table is the order — "`END_PHASE` / `END_TURN`" — so:
 * place what is unplaced, then end the **phase**, and only end the turn when
 * no phase exit is legal.
 *
 * **`END_PHASE` before `END_TURN` is load-bearing, not cosmetic.** `END_TURN`
 * is legal out of `attack` (the reducer offers both there), so offering it
 * first sent a timed-out attacking seat straight past `fortify` — and the R20
 * card award is pinned to `fortify` by `owedServerAction` and by
 * `validateCardDrawn`, so a seat that conquered and then ran out of time was
 * silently robbed of the card it had earned. Ending the phase instead walks the
 * seat through `fortify` in the same tick (the timeout stands until the seat
 * changes hands), the award lands there, and `END_TURN` comes out of `fortify`,
 * which is its only legal exit (R67). `nextBotAction` has always ordered the
 * two this way; the timeout path simply disagreed with it.
 *
 * **`TRADE_CARDS` leads the list**, because a forced trade is the one state in
 * which *nothing else* is legal: R24 at turn start and R26's trade-down both
 * refuse `DRAFT`, `AUTO_DEPLOY`, `END_PHASE` and `END_TURN` with
 * `mustTradeCards`. Without the candidate this function answered `null`, the
 * tick appended nothing, and a seat that was **present but idle** — polling,
 * inside or outside its deadline — held the game up for ever, because the
 * takeover counter only climbs on a tick that got somewhere
 * (codex round 3, finding 3).
 */
export function autoSkipAction(
  engine: ServerEngine,
  state: GameState,
  map: MapDef,
  seat: Seat,
): Action | null {
  const candidates: Action[] = [];

  // R24 / R26 — the forced trade, which refuses every other action while it is owed.
  try {
    if (engine.mustTradeNow(state, seat)) {
      const set = engine.cardSets(state.seats[seat]?.cards ?? [])[0];
      // `bonusTerritory: null` declines R23's +2 rather than guessing a tile for an absent player.
      if (set) candidates.push({ type: "TRADE_CARDS", seat, cards: set, bonusTerritory: null });
    }
  } catch {
    // The engine cannot answer yet (S1 pending); the candidates below still move the game on.
  }

  if (state.phase === "claim") candidates.push(...claimCandidates(state, seat));

  if (state.troopsToPlace > 0) {
    let targets: readonly TerritoryId[] = [];
    try {
      targets = engine.legalDraftTargets(state, seat);
    } catch {
      // The engine cannot answer yet (S1 pending). The END_PHASE / END_TURN
      // candidates below still move the game on.
      targets = [];
    }
    const placements = spreadPlacements(targets, state.troopsToPlace);
    if (placements.length > 0) {
      candidates.push({ type: "AUTO_DEPLOY", seat, placements });
    }
  }

  candidates.push({ type: "END_PHASE", seat });
  candidates.push({ type: "END_TURN", seat });

  for (const candidate of candidates) {
    if (engine.validate(state, map, candidate) === null) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------- bot turns -- */

/** Resolve a plan's `moveIn` against the pending range (R63). */
export function resolveMoveIn(
  pending: { min: number; max: number },
  moveIn: "min" | "max" | number,
): number {
  if (moveIn === "min") return pending.min;
  if (moveIn === "max") return pending.max;
  return Math.max(pending.min, Math.min(pending.max, Math.floor(moveIn)));
}

/**
 * The next single action a bot seat takes, or `null` when it is stuck.
 *
 * `decideTurn` is re-entered on every call rather than its plan being walked
 * with a cursor. That is what §4.13 asks for ("re-entered after each
 * battle"), it costs at most `MAX_TICK_ACTIONS` calls per invocation, and it
 * removes the one bug a cursor invites: a plan computed before a battle being
 * replayed against the board after it.
 *
 * As with {@link autoSkipAction}, every candidate is offered to `validate` and
 * the first acceptable one wins, so a plan that disagrees with the reducer
 * degrades into ending the phase rather than wedging the tick.
 *
 * **`context.nextSeq` is the sub-stream index for every draw here** — the
 * `seq` the action being produced will be appended at. Keying on `state.turn`
 * instead (which is what this did) hands every re-entry inside one turn the
 * *same* stream from its start: a bot's second attack of a turn re-rolls the
 * first one's dice, and a chain of `decideTurn` calls re-plans identically
 * forever. `seq` is unique per action by construction, which is exactly the
 * property a sub-stream index needs.
 */
export function nextBotAction(
  engine: ServerEngine,
  state: GameState,
  map: MapDef,
  seat: Seat,
  context: {
    readonly persona: BotPersona;
    readonly grudge: Float32Array | undefined;
    readonly odds: OddsTables;
    readonly seed: string;
    /** The `seq` the action this call produces will be appended at. */
    readonly nextSeq: number;
  },
): Action | null {
  const view = engine.makeView(state, map, seat, context.persona, context.grudge);
  const plan = engine.decideTurn(
    view,
    context.odds,
    engine.rngFor(context.seed, `bot:${seat}`, context.nextSeq),
  );

  const candidates: Action[] = [];

  // A pending move-in blocks every other action (R62), so it goes first.
  if (state.pendingMoveIn) {
    const count = resolveMoveIn(state.pendingMoveIn, plan.attacks[0]?.moveIn ?? "max");
    candidates.push({ type: "MOVE_IN", seat, count });
  }

  if (plan.cardTrade) {
    candidates.push({
      type: "TRADE_CARDS",
      seat,
      cards: plan.cardTrade,
      bonusTerritory: null,
    });
  }

  for (const placement of plan.placements) {
    if (state.phase === "claim") {
      candidates.push({ type: "CLAIM", seat, territory: placement.territory });
    } else {
      const count = Math.max(1, Math.min(placement.count, state.troopsToPlace));
      if (state.troopsToPlace > 0) {
        candidates.push({ type: "DRAFT", seat, territory: placement.territory, count });
      }
    }
  }

  for (const attack of plan.attacks) {
    const intent =
      attack.mode === "manual"
        ? ({
            from: attack.from,
            to: attack.to,
            mode: "manual" as const,
            attackerDice: attack.attackerDice ?? 3,
          } as const)
        : ({
            from: attack.from,
            to: attack.to,
            mode: "blitz" as const,
            ...(attack.stopUntil === undefined ? {} : { stopUntil: attack.stopUntil }),
          } as const);
    try {
      candidates.push(
        engine.rollAttack(
          state,
          map,
          intent,
          engine.rngFor(context.seed, "battle", context.nextSeq),
          context.odds,
          state.rules.diceMode,
        ),
      );
    } catch {
      // A resolver that cannot roll yet must not wedge the tick; the
      // END_PHASE candidate below still moves the game on.
    }
  }

  if (plan.fortify) {
    candidates.push({ type: "FORTIFY", seat, ...plan.fortify });
  }

  candidates.push({ type: "END_PHASE", seat });
  candidates.push({ type: "END_TURN", seat });

  for (const candidate of candidates) {
    if (engine.validate(state, map, candidate) === null) return candidate;
  }
  return null;
}

/* ------------------------------------------- the authority's own actions -- */

/**
 * The action the **authority itself** owes before anybody may act again, or
 * `null` when it owes nothing (§5.7, R20, R76).
 *
 * Two pieces of per-turn work are the runner's online exactly as they are the
 * offline session's (`src/game/session.ts`'s `awardCard` and
 * `roundStartWork`), and neither can be a client's to send: the schema refuses
 * a `CARD_DRAWN` or `PORTALS_MOVED` body outright, because both carry a
 * server-rolled value.
 *
 * - **The card award.** `conqueredThisTurn` is the whole condition: `apply`
 *   *clears* it when it folds `CARD_DRAWN`, so the flag doubles as "and no
 *   card has been awarded yet this turn", which is what keeps it to exactly
 *   one card per capturing turn (R20). `validate` pins the award to the
 *   `fortify` phase (R67), so that is the one phase it is offered in.
 * - **The unstable-portal relocation.** Due at the start of a round, which is
 *   what `portalsOwed` reports; `movePortals` answers `null` unless
 *   `rules.portals === "unstable"` and `round % 3 === 0` (R76), so the caller
 *   asks on every round start without a condition of its own.
 *
 * `nextSeq` is the `seq` the returned action will be appended at, and it is
 * the sub-stream index for both draws — the same rule {@link nextBotAction}
 * follows, and the reason a second card award in one game does not replay the
 * first one's draw.
 *
 * Nothing here throws: a resolver that cannot answer yet must not wedge a
 * turn, and `validate` has the last word on every candidate, so a card that
 * would overfill a hand (R28) or a relocation the board cannot satisfy is
 * simply not offered.
 */
export function owedServerAction(
  engine: ServerEngine,
  seed: string,
  state: GameState,
  map: MapDef,
  nextSeq: number,
  /**
   * What is still outstanding. The caller clears each flag once it has been
   * offered, so neither can be asked twice for the same turn or round — the
   * flag conditions above are the *engine's* bookkeeping, and a reducer that
   * failed to clear `conqueredThisTurn` would otherwise deal a whole hand.
   */
  due: { readonly card: boolean; readonly portals: boolean },
): Action | null {
  if (due.card && state.phase === "fortify" && state.conqueredThisTurn) {
    try {
      const drawn = engine.drawCard(
        state,
        map,
        currentSeatOf(state),
        engine.rngFor(seed, "cardDeck", nextSeq),
      );
      if (engine.validate(state, map, drawn) === null) return drawn;
    } catch {
      /* the resolver cannot draw yet; the turn still ends below */
    }
  }

  if (due.portals) {
    try {
      const moved = engine.movePortals(state, map, engine.rngFor(seed, "portalMove", nextSeq));
      if (moved !== null && engine.validate(state, map, moved) === null) return moved;
    } catch {
      /* ditto */
    }
  }

  return null;
}

/* --------------------------------------------------------- bot memory -- */

/** `games.bot_memory` → the `Float32Array` `makeView` takes (F43). */
export function grudgeFor(
  memory: Record<string, { grudge: number[] }>,
  seat: Seat,
  seats: number,
): Float32Array {
  const stored = memory[String(seat)]?.grudge;
  const out = new Float32Array(seats);
  if (!stored) return out;
  for (let i = 0; i < Math.min(seats, stored.length); i += 1) out[i] = stored[i] ?? 0;
  return out;
}

/** The inverse: a `Float32Array` back into the `jsonb` column's shape. */
export function storeGrudge(
  memory: Record<string, { grudge: number[] }>,
  seat: Seat,
  grudge: Float32Array,
): Record<string, { grudge: number[] }> {
  return { ...memory, [String(seat)]: { grudge: [...grudge] } };
}
