import "server-only";

import { SEAT_UNKNOWN, type Action, type GameState, type Seat } from "@/engine/types";
import type { LoggedAction } from "@/ports/sync";

/**
 * What a **fog** poll is allowed to put in its action log (SPEC §5.5, R73, F36).
 *
 * POLL 3's fog mode hands the caller their own masked snapshot plus the
 * actions since their cursor, and those actions are **for animation only** —
 * a fog client never folds them. That makes the raw log a hole straight
 * through the fog: an `ATTACK { from, to, defenderLosses }` on the far side of
 * the board names territories the viewer cannot see, and `GAME_STARTED`
 * carries the entire deal.
 *
 * So the log is redacted per viewer, by the same visibility the snapshot uses:
 *
 * - **`GAME_STARTED` is omitted entirely.** Its payload *is* the board.
 * - **An action survives intact only when every territory it names is visible**
 *   to the viewer — occupied by them, or adjacent to something they occupy
 *   (R73). Otherwise the payload becomes {@link HiddenAction}, so the client
 *   still learns that *somebody moved* — which is what keeps the roster's
 *   activity and the chat log's cadence honest — without learning where.
 * - **Another seat's `CARD_DRAWN` loses its card.** A hand is secret with or
 *   without fog (F12), and a card names a territory besides.
 *
 * Visibility is read off the **already-masked view** rather than recomputed:
 * `viewFor` is the one definition of what a seat can see, and a second
 * implementation here could disagree with the snapshot in the same response.
 */

/** A payload the viewer may not see. Carries the actor and nothing else. */
export interface HiddenAction {
  readonly type: "HIDDEN";
  readonly seat: Seat;
}

/** Another seat's card award: the event, never the card (F12). */
export interface MaskedCardDrawn {
  readonly type: "CARD_DRAWN";
  readonly seat: Seat;
  readonly card: null;
}

/** A log row as a fog poll serialises it. `LoggedAction` is a subtype of it. */
export interface RedactedAction extends Omit<LoggedAction, "action"> {
  readonly action: Action | HiddenAction | MaskedCardDrawn;
}

/** The caller's masked state, and whose it is. */
export interface SeatView {
  readonly seat: Seat;
  /** `viewFor(state, map, seat)` — `SEAT_UNKNOWN` marks what fog hides. */
  readonly state: GameState;
}

/** Every territory an action names, or `null` for "the whole board". */
function territoriesNamed(action: Action): readonly number[] | null {
  switch (action.type) {
    case "GAME_STARTED":
      return null;
    case "CLAIM":
    case "DRAFT":
      return [action.territory];
    case "TRADE_CARDS":
      return action.bonusTerritory === null ? [] : [action.bonusTerritory];
    case "ATTACK":
    case "FORTIFY":
      return [action.from, action.to];
    case "AUTO_DEPLOY":
      return action.placements.map((placement) => placement.territory);
    case "CARD_DRAWN":
      // A wild card names no territory (`territory: null` iff `suit`
      // is `"wild"`), so there is nothing in it to hide.
      return action.card.territory === null ? [] : [action.card.territory];
    case "PORTALS_MOVED":
      return action.portals.flatMap((portal) => [portal.a, portal.b]);
    // MOVE_IN, END_PHASE, END_TURN, the two seat flips and the alliance
    // actions name no territory at all: they are about a seat, not the board.
    default:
      return [];
  }
}

/**
 * One log row as `view.seat`'s fog client may see it, or `null` to drop it.
 *
 * Only ever called for a game with `rules.fogOfWar`: with fog off the log goes
 * out as stored, because a non-fog client folds it and hash-checks every row.
 */
export function redactForSeat(row: LoggedAction, view: SeatView): RedactedAction | null {
  const action = row.action;
  // The opening *is* the board. There is no partial view of it worth sending.
  if (action.type === "GAME_STARTED") return null;

  if (action.type === "CARD_DRAWN" && action.seat !== view.seat) {
    return { ...row, action: { type: "CARD_DRAWN", seat: action.seat, card: null } };
  }

  const named = territoriesNamed(action);
  const visible =
    named !== null &&
    named.every((territory) => view.state.territories[territory]?.owner !== SEAT_UNKNOWN);

  if (visible) return row;
  return { ...row, action: { type: "HIDDEN", seat: action.seat } };
}

/** {@link redactForSeat} over a whole delta, dropping what it omits. */
export function redactLogForSeat(
  rows: readonly LoggedAction[],
  view: SeatView,
): RedactedAction[] {
  const out: RedactedAction[] = [];
  for (const row of rows) {
    const redacted = redactForSeat(row, view);
    if (redacted !== null) out.push(redacted);
  }
  return out;
}
