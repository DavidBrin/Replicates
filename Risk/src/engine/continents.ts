/**
 * Continent ownership and the bonus it pays (R13, R14, R74).
 *
 * The one subtlety is R14: a blizzard tile is ownerless for the whole game but
 * **still counts toward its region's bonus** (D35), so "fully owned" means
 * owning every *non-blizzard* territory in the continent. A continent whose
 * every tile is frozen is owned by nobody rather than by everybody.
 *
 * R13 fixes *when* this is read, not just how: ownership is evaluated once, at
 * the start of the owner's turn, and that snapshot is what pays (D18). The
 * reducer calls `reinforcementsFor` at `END_TURN`; nothing re-reads it
 * mid-turn.
 */
import type { ContinentId, GameState, MapDef, Seat } from "./types";

/** `true` when `seat` owns every non-blizzard territory of `continent` (R13, R14). */
export function ownsContinent(state: GameState, map: MapDef, seat: Seat, continent: ContinentId): boolean {
  const def = map.continents[continent];
  if (def === undefined) return false;
  let owned = 0;
  for (const t of def.territories) {
    const cell = state.territories[t];
    if (cell === undefined || cell.blizzard) continue;
    if (cell.owner !== seat) return false;
    owned++;
  }
  return owned > 0;
}

/** Every continent `seat` holds entirely, ascending by id (R91). */
export function continentsHeldBy(state: GameState, map: MapDef, seat: Seat): readonly ContinentId[] {
  const out: ContinentId[] = [];
  for (let i = 0; i < map.continents.length; i++) {
    if (ownsContinent(state, map, seat, i)) out.push(i);
  }
  return out;
}

/** The summed bonus of every continent `seat` holds (R13). */
export function continentBonusFor(state: GameState, map: MapDef, seat: Seat): number {
  let total = 0;
  for (const id of continentsHeldBy(state, map, seat)) {
    total += (map.continents[id] as { bonus: number }).bonus;
  }
  return total;
}
