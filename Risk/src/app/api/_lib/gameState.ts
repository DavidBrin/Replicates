import "server-only";

import { config } from "@/config/env";
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
 * The next action a timed-out seat takes, or `null` when it cannot move.
 *
 * Candidates are offered in order and the first one `validate` accepts wins,
 * so this needs to know nothing about which transitions the reducer allows —
 * which matters, because §3's phase machine is S1's and `END_TURN` out of
 * `draft` is exactly the sort of thing that is legal in one reading and not
 * in another. §5.6's table is the order: deploy what is undrafted, then end
 * the turn, then fall back to ending the phase.
 */
export function autoSkipAction(
  engine: ServerEngine,
  state: GameState,
  map: MapDef,
  seat: Seat,
): Action | null {
  const candidates: Action[] = [];

  if (state.troopsToPlace > 0) {
    let targets: readonly TerritoryId[] = [];
    try {
      targets = engine.legalDraftTargets(state, seat);
    } catch {
      // The engine cannot answer yet (S1 pending). The END_TURN / END_PHASE
      // candidates below still move the game on.
      targets = [];
    }
    const placements = spreadPlacements(targets, state.troopsToPlace);
    if (placements.length > 0) {
      candidates.push({ type: "AUTO_DEPLOY", seat, placements });
    }
  }

  candidates.push({ type: "END_TURN", seat });
  candidates.push({ type: "END_PHASE", seat });

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
  },
): Action | null {
  const view = engine.makeView(state, map, seat, context.persona, context.grudge);
  const plan = engine.decideTurn(
    view,
    context.odds,
    engine.rngFor(context.seed, `bot:${seat}`, state.turn),
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
          engine.rngFor(context.seed, "battle", state.turn),
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
