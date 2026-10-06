/**
 * `viewFor` — what one seat is allowed to see (R73, F12, F36).
 *
 * Two maskings, one function, and they are independent:
 *
 * 1. **Always**, every *other* seat's `cards` is emptied to `[]` while
 *    `cardCount` keeps the true size (F12). A hand is secret whether or not
 *    fog is on, and `cardCount` is what the roster's card tag renders.
 * 2. **Only when `rules.fogOfWar`**, every territory the viewer cannot see has
 *    its `owner` and `troops` replaced by `SEAT_UNKNOWN` / `TROOPS_UNKNOWN`
 *    (R73). Visible means: you occupy it, or it is directly adjacent to
 *    something you occupy — including through an active portal (R68).
 *
 * The result always carries `fogged: true`, which is what makes it
 * **unhashable** (F36): a masked view is a different byte string per viewer,
 * so `hashState` asserts the flag is false and the desync check only ever runs
 * over authoritative state.
 *
 * Fog is applied here and **never in `apply`** (R73): the reducer always sees
 * the truth.
 */
import { neighbours } from "./graph";
import {
  SEAT_UNKNOWN,
  TROOPS_UNKNOWN,
  type GameState,
  type MapDef,
  type Seat,
  type TerritoryId,
  type TerritoryState,
} from "./types";

/**
 * The territories `seat` can see under fog: its own, plus every direct
 * neighbour of one of its own (R73). Returns a flag per territory index.
 */
export function visibilityFor(state: GameState, map: MapDef, seat: Seat): Uint8Array {
  const visible = new Uint8Array(state.territories.length);
  for (let i = 0; i < state.territories.length; i++) {
    if ((state.territories[i] as TerritoryState).owner !== seat) continue;
    visible[i] = 1;
    for (const n of neighbours(state, map, i)) visible[n] = 1;
  }
  return visible;
}

/** `true` when `seat` may see `t`'s owner and troop count (R73). */
export function canSee(state: GameState, map: MapDef, seat: Seat, t: TerritoryId): boolean {
  if (!state.rules.fogOfWar) return true;
  return visibilityFor(state, map, seat)[t] === 1;
}

/**
 * The view `seat` is allowed to hold (R73, F12). With fog off this is the
 * identity over the territories — but never over the hands.
 */
export function viewFor(state: GameState, map: MapDef, seat: Seat): GameState {
  const seats = state.seats.map((s) =>
    s.seat === seat ? { ...s } : { ...s, cards: [] as const, cardCount: s.cardCount },
  );

  let territories = state.territories;
  if (state.rules.fogOfWar) {
    const visible = visibilityFor(state, map, seat);
    territories = state.territories.map((t, i) =>
      visible[i] === 1 ? t : { owner: SEAT_UNKNOWN, troops: TROOPS_UNKNOWN, blizzard: t.blizzard },
    );
  }

  return { ...state, seats, territories, fogged: true };
}
